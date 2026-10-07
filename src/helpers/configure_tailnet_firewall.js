import { isIP } from "node:net";
import {
	log,
	promptUser,
	runCommand,
	runCommandCapture,
} from "../common/utils.js";

function numericSshPort(value) {
	if (!/^\d+(?::\d+)?(?:,\d+(?::\d+)?)*(?:\/(?:tcp|udp))?$/.test(value))
		return null;
	const ranges = value
		.replace(/\/(?:tcp|udp)$/, "")
		.split(",")
		.map((range) => {
			const [start, end = start] = range.split(":").map(Number);
			if (start < 1 || end > 65535 || start > end)
				throw new Error("Invalid UFW port range");
			return [start, end];
		});
	return (
		!value.endsWith("/udp") &&
		ranges.some(([start, end]) => start <= 22 && end >= 22)
	);
}

async function includesSshPort(value, resolveProfile, serviceName = false) {
	const port = value.toLowerCase();
	if (
		["openssh", "ssh", "any", "anywhere", "any/tcp", "anywhere/tcp"].includes(
			port,
		)
	)
		return true;
	if (["any/udp", "anywhere/udp"].includes(port)) return false;
	if (
		serviceName &&
		value === port &&
		["http", "https", "http/tcp", "https/tcp"].includes(port)
	)
		return false;
	const numeric = numericSshPort(port);
	return numeric ?? resolveProfile(value);
}

function destinationFamily(value, status = false) {
	const [address, suffix, ...extra] = value.split("/");
	const family = isIP(address);
	if (
		family &&
		(extra.length ||
			(suffix !== undefined &&
				!(status && ["tcp", "udp"].includes(suffix)) &&
				(!/^\d+$/.test(suffix) || Number(suffix) > (family === 4 ? 32 : 128))))
	)
		throw new Error("Invalid UFW destination address");
	return family;
}

// Read only UFW's normalized saved-rule syntax, including quoted profile names.
function savedRuleWords(line) {
	const text = line.trim();
	const pattern = /\s*(?:'([^']*)'|"([^"]*)"|([^\s'"]+))(?=\s|$)/gy;
	const words = [];
	while (pattern.lastIndex < text.length) {
		const match = pattern.exec(text);
		if (!match) throw new Error("Cannot verify UFW saved-rule quoting");
		const word = match[1] ?? match[2] ?? match[3];
		if (word === "comment") break;
		words.push(word);
	}
	return words;
}

async function savedPublicSsh(added, resolveProfile) {
	let publicSsh = false;
	const lines = added.trim().split("\n").slice(1);
	if (lines.length === 1 && lines[0] === "(None)") return false;
	for (const line of lines) {
		if (!line.trim()) continue;
		const words = savedRuleWords(line);
		if (words.shift() !== "ufw")
			throw new Error("Cannot verify UFW saved rules");
		const routed = words[0] === "route";
		if (routed) words.shift();
		const action = words.shift();
		if (!["allow", "limit", "deny", "reject"].includes(action))
			throw new Error("Cannot verify UFW saved rules");
		if (routed || ["deny", "reject"].includes(action) || words[0] === "out")
			continue;
		if (words[0] === "in") {
			words.shift();
			if (words[0] === "on") {
				words.shift();
				if (words.shift() === "tailscale0") continue;
			}
		}
		if (["log", "log-all"].includes(words[0])) words.shift();
		let port;
		let profile = false;
		let serviceName = false;
		if (["from", "to", "proto"].includes(words[0])) {
			const proto = words.indexOf("proto");
			if (proto >= 0 && words[proto + 1] === "udp") continue;
			const to = words.indexOf("to");
			if (
				to >= 0 &&
				words[to + 1] !== "any" &&
				!destinationFamily(words[to + 1] ?? "")
			)
				throw new Error("Invalid UFW destination address");
			profile = to >= 0 && words[to + 2] === "app";
			port =
				to >= 0 && ["port", "app"].includes(words[to + 2])
					? words[to + 3]
					: "any";
		} else {
			if (words.length !== 1) throw new Error("Cannot verify UFW short rule");
			port = words[0];
			serviceName = true;
		}
		if (!port) throw new Error("Cannot verify UFW destination port/profile");
		if (
			await (profile
				? resolveProfile(port)
				: includesSshPort(port, resolveProfile, serviceName))
		)
			publicSsh = true;
	}
	return publicSsh;
}

async function firewallStatus(output, resolveProfile) {
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
		let port = to.replace(/\s+on\s+\S+$/, "");
		const [address, ...rest] = port.split(/\s+/);
		const family = destinationFamily(address, true);
		if (family)
			port = rest.join(" ") || (address.endsWith("/udp") ? "any/udp" : "any");
		if (await includesSshPort(port, resolveProfile))
			rules.push({
				tailnet: /\bon tailscale0$/.test(to),
				ipv6: family === 6 || /\(v6\)/.test(line),
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
	const profileCache = new Map();
	const resolveProfile = async (name) => {
		if (name === "all" || !/^[a-zA-Z0-9][a-zA-Z0-9 _\-.+]*$/.test(name))
			throw new Error("Invalid UFW profile name; operator inspection required");
		if (profileCache.has(name)) return profileCache.get(name);
		try {
			// An argv array keeps a spaced name out of shell parsing entirely.
			const output = await inspect(["sudo", "ufw", "app", "info", name]);
			const names = [...output.matchAll(/^Profile: (.+)$/gm)];
			const sections = [...output.matchAll(/^Ports?:\s*$/gm)];
			if (names.length !== 1 || names[0][1] !== name || sections.length !== 1)
				throw new Error("Ambiguous profile report");
			const entries = output
				.slice(sections[0].index + sections[0][0].length)
				.trim()
				.split("\n");
			const ports = entries.map((entry) => numericSshPort(entry.trim()));
			if (!ports.length || ports.some((port) => port === null))
				throw new Error("Invalid profile ports");
			const ssh = ports.some(Boolean);
			profileCache.set(name, ssh);
			return ssh;
		} catch (error) {
			throw new Error(
				`Cannot verify UFW profile ${name}; operator inspection required (${error.message})`,
			);
		}
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
		const current = await firewallStatus(status, resolveProfile);
		active = current.active;
		publicSsh = current.rules.some((rule) => !rule.tailnet);
		const added = await inspect("sudo ufw show added");
		if (
			!added.startsWith(
				"Added user rules (see 'ufw status' for running firewall):",
			)
		)
			throw new Error("Ambiguous UFW rule report");
		publicSsh = (await savedPublicSsh(added, resolveProfile)) || publicSsh;
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
		const verified = await firewallStatus(finalStatus, resolveProfile);
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
