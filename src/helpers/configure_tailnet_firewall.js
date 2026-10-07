import { isIP } from "node:net";
import {
	log,
	promptUser,
	runCommand,
	runCommandCapture,
} from "../common/utils.js";

// Unknown application profiles require operator inspection; guessing could hide SSH.
function includesSshPort(value) {
	const port = value.toLowerCase().replace(/['"]/g, "");
	if (["openssh", "ssh", "any", "anywhere"].includes(port)) return true;
	if (["http", "https"].includes(port) || port.endsWith("/udp")) return false;
	if (!/^\d+(?::\d+)?(?:,\d+(?::\d+)?)*(?:\/tcp)?$/.test(port))
		throw new Error(
			"Cannot verify a UFW application/port rule; operator inspection required",
		);
	return port
		.replace(/\/tcp$/, "")
		.split(",")
		.some((range) => {
			const [start, end = start] = range.split(":").map(Number);
			return start <= 22 && end >= 22;
		});
}

function savedPublicSsh(added) {
	let publicSsh = false;
	const lines = added.trim().split("\n").slice(1);
	if (lines.length === 1 && lines[0] === "(None)") return false;
	for (const line of lines) {
		if (!line.trim()) continue;
		const rule = line.split(/\s+comment\s+/)[0];
		if (!/^ufw (?:route )?(allow|limit|deny|reject)\b/.test(rule))
			throw new Error("Cannot verify UFW saved rules");
		if (
			/^ufw (?:route |deny |reject )/.test(rule) ||
			/\bout\b|\bproto udp\b|\bin on tailscale0\b/.test(rule)
		)
			continue;
		const destination = rule.split(/\bto\s+/)[1];
		const port = destination
			? (destination.match(/\b(?:port|app)\s+(\S+)/)?.[1] ?? "any")
			: (rule.match(
					/^ufw (?:allow|limit)\s+(?!in\b|from\b|proto\b|log\b)(\S+)/,
				)?.[1] ?? "any");
		if (includesSshPort(port)) publicSsh = true;
	}
	return publicSsh;
}

function firewallStatus(output) {
	const states = [...output.matchAll(/^Status: (active|inactive)$/gm)];
	if (states.length !== 1) throw new Error("Ambiguous UFW status");
	const rules = [];
	for (const line of output.split("\n")) {
		const row = line.match(
			/^(.*?)\s+(ALLOW|LIMIT|DENY|REJECT)(?:\s+(IN|OUT|FWD))?\s+(.+)$/,
		);
		if (
			!row ||
			!["ALLOW", "LIMIT"].includes(row[2]) ||
			["OUT", "FWD"].includes(row[3])
		)
			continue;
		const to = row[1].replace(/\(v6\)/g, "").trim();
		const port = to.replace(/\s+on\s+\S+$/, "");
		if (includesSshPort(port))
			rules.push({
				tailnet: /\bon tailscale0$/.test(to),
				ipv6: /\(v6\)/.test(line),
			});
	}
	return { active: states[0][1] === "active", rules };
}

export async function setupFirewall({
	run = runCommand,
	prompt = promptUser,
	capture = runCommandCapture,
} = {}) {
	log.info("Setting up UFW...");
	const incomplete = (reason) => {
		log.error(reason);
		return { ok: false, reason };
	};
	const inspect = async (command) => {
		const result = await capture(command, {
			env: { ...process.env, LC_ALL: "C" },
			stdin: "ignore",
		});
		if (
			result?.exitCode !== 0 ||
			result.failed ||
			typeof result.stdout !== "string"
		)
			throw new Error(`Cannot inspect ${command}`);
		return result.stdout;
	};
	let prerequisite = "Tailscale";
	try {
		const state = JSON.parse(await inspect("tailscale status --json"));
		const ips = state?.Self?.TailscaleIPs;
		if (
			state?.BackendState !== "Running" ||
			state.TUN !== true ||
			state.Self?.Online !== true ||
			typeof state.CurrentTailnet?.Name !== "string" ||
			!state.CurrentTailnet.Name.trim() ||
			!Array.isArray(ips) ||
			!ips.length ||
			new Set(ips).size !== ips.length ||
			!ips.every((ip) => {
				if (typeof ip !== "string") return false;
				if (isIP(ip) === 6)
					return ip.toLowerCase().startsWith("fd7a:115c:a1e0:");
				const [first, second] = ip.split(".").map(Number);
				return isIP(ip) === 4 && first === 100 && second >= 64 && second <= 127;
			})
		)
			throw new Error("tailnet is not ready");
		prerequisite = "tailscale0";
		const interfaces = JSON.parse(
			await inspect("ip -j address show dev tailscale0"),
		);
		if (!Array.isArray(interfaces) || interfaces.length !== 1)
			throw new Error("ambiguous interface");
		const link = interfaces[0];
		if (
			!Number.isInteger(link?.ifindex) ||
			link.ifindex <= 0 ||
			link.ifname !== "tailscale0" ||
			!Array.isArray(link.flags) ||
			!link.flags.includes("UP") ||
			!Array.isArray(link.addr_info) ||
			!ips.every(
				(ip) =>
					link.addr_info.filter(
						(address) =>
							address.local === ip &&
							address.family === (isIP(ip) === 4 ? "inet" : "inet6"),
					).length === 1,
			)
		)
			throw new Error("invalid interface");
	} catch {
		const reason = `${prerequisite} is unavailable or not ready. Install Tailscale, log in, start the tailnet and verify tailscale0 addresses, then retry Debian setup.`;
		return incomplete(reason);
	}
	let active;
	let publicSsh;
	try {
		const status = await inspect("sudo ufw status");
		const current = firewallStatus(status);
		active = current.active;
		publicSsh = current.rules.some((rule) => !rule.tailnet);
		const added = await inspect("sudo ufw show added");
		if (
			!added.startsWith(
				"Added user rules (see 'ufw status' for running firewall):",
			)
		)
			throw new Error("Ambiguous UFW rule report");
		publicSsh = savedPublicSsh(added) || publicSsh;
		const config = await inspect("sudo cat /etc/default/ufw");
		const ipv6 = [...config.matchAll(/^IPV6=(.*)$/gm)];
		if (ipv6.length !== 1 || ipv6[0][1] !== "yes")
			throw new Error("UFW IPv6 support must be enabled by the operator");
	} catch (error) {
		return incomplete(
			`${error.message}. Resolve UFW inspection/IPv6 prerequisites and retry Debian setup.`,
		);
	}
	try {
		// Install the interface rule before changing defaults, even on active UFW.
		for (const command of [
			"sudo ufw allow in on tailscale0 to any app OpenSSH",
			"sudo ufw default deny incoming",
			"sudo ufw default allow outgoing",
			"sudo ufw allow http",
			"sudo ufw allow https",
		]) {
			if ((await run(command)) !== true)
				return incomplete(
					`Failed ${command}. Configuration is incomplete; fix and retry Debian setup.`,
				);
		}
		if (await prompt("Enable UFW now?", true)) {
			if ((await run("sudo ufw enable")) !== true)
				return incomplete(
					"Failed sudo ufw enable. Fix and retry Debian setup.",
				);
		} else if (!active) {
			return incomplete(
				"UFW is inactive and enable was declined. Firewall configuration is incomplete; retry Debian setup and confirm enable when ready.",
			);
		}
		const finalStatus = await inspect("sudo ufw status");
		const verified = firewallStatus(finalStatus);
		if (
			!verified.active ||
			![false, true].every((ipv6) =>
				verified.rules.some((rule) => rule.tailnet && rule.ipv6 === ipv6),
			)
		)
			return incomplete(
				"UFW active IPv4/IPv6 tailnet SSH rules are unverified or inactive. Inspect the firewall and retry Debian setup.",
			);
		if (publicSsh || verified.rules.some((rule) => !rule.tailnet))
			return incomplete(
				"Existing public SSH rules remain. The operator must separately inspect and remove/migrate broad IPv4/IPv6 SSH rules after confirming tailnet access, then retry Debian setup. No existing rules were deleted.",
			);
		return {
			ok: true,
			reason: "UFW is active with tailnet SSH configuration.",
		};
	} catch (error) {
		return incomplete(
			`Firewall configuration is unverified, failed or was skipped (${error.message}). Inspect UFW and retry Debian setup.`,
		);
	}
}
