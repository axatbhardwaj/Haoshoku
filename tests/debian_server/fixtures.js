import { expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	buildFail2banJail,
} from "../../src/os_scripts/debian_server.js";

// A fake `run` that records every command it sees and returns a configured
// result per command substring. Defaults to `true` (success) for any command
// not explicitly mapped.
export function makeFakeRun(overrides = {}) {
	const calls = [];
	const run = async (command) => {
		calls.push(command);
		for (const [needle, result] of Object.entries(overrides)) {
			if (command.includes(needle)) return result;
		}
		return true;
	};
	return { run, calls };
}

export const tailnetStatus = {
	BackendState: "Running",
	TUN: true,
	Self: {
		Online: true,
		TailscaleIPs: ["100.101.102.103", "fd7a:115c:a1e0::1234"],
	},
	CurrentTailnet: { Name: "example.test", MagicDNSSuffix: "example.ts.net" },
};
export const tailnetInterface = [
	{
		ifindex: 7,
		ifname: "tailscale0",
		flags: ["POINTOPOINT", "MULTICAST", "NOARP", "UP", "LOWER_UP"],
		mtu: 1280,
		operstate: "UNKNOWN",
		link_type: "none",
		addr_info: [
			{
				family: "inet",
				local: "100.101.102.103",
				prefixlen: 32,
				scope: "global",
			},
			{
				family: "inet6",
				local: "fd7a:115c:a1e0::1234",
				prefixlen: 128,
				scope: "global",
			},
		],
	},
];
export function probeOutput(stdout, exitCode = 0) {
	return { stdout, exitCode, failed: exitCode !== 0, stderr: "" };
}
export const activeFirewall = `Status: active

To                         Action      From
--                         ------      ----
OpenSSH on tailscale0       ALLOW IN    Anywhere
80/tcp                     ALLOW IN    Anywhere
443/tcp                    ALLOW IN    Anywhere
OpenSSH (v6) on tailscale0  ALLOW IN    Anywhere (v6)
80/tcp (v6)                ALLOW IN    Anywhere (v6)
443/tcp (v6)               ALLOW IN    Anywhere (v6)
`;
export const addedHeader =
	"Added user rules (see 'ufw status' for running firewall):\n";
export const sshRule = "sudo ufw allow in on tailscale0 to any app OpenSSH";
export function makeFakeCapture(overrides = {}) {
	const calls = [];
	const capture = async (command) => {
		calls.push(command);
		if (Object.hasOwn(overrides, command)) return overrides[command];
		if (command === "tailscale status --json")
			return probeOutput(JSON.stringify(tailnetStatus));
		if (command === "ip -j address show dev tailscale0")
			return probeOutput(JSON.stringify(tailnetInterface));
		if (command === "sudo ufw status")
			return probeOutput(
				calls.filter((c) => c === command).length === 1
					? "Status: inactive\n"
					: activeFirewall,
			);
		if (command === "sudo ufw show added")
			return probeOutput(`${addedHeader}(None)\n`);
		if (command === "sudo cat /etc/default/ufw")
			return probeOutput(
				"# Set to yes to apply rules to support IPv6\nIPV6=yes\n",
			);
		throw new Error("Unexpected fixture probe: " + command);
	};
	return { capture, calls };
}

export function makeFakePrompt(value = true) {
	const calls = [];
	const prompt = async (message) => {
		calls.push(message);
		return value;
	};
	return { prompt, calls };
}

export function runDefaultSetupWithSafeDoubles({
	axstackResult = true,
	claudeResult = { ok: true, reason: "installed" },
	codexResult = { ok: true, reason: "installed" },
	codexError = null,
	relayResult = true,
	t3Result = true,
	missingTailscale = false,
	firewall = {},
} = {}) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-debian-path-"));
	const modulePath = (relativePath) =>
		path.resolve(import.meta.dir, "..", "..", relativePath);
	const debianModule = modulePath("src/os_scripts/debian_server.js");
	const childScript = `
		import { mock } from "bun:test";
		import actualFs from "node:fs";
		import path from "node:path";
		const events = [];
		const record = (name, result) => async () => {
			events.push({ type: "helper", name });
			return result;
		};
		const promptAnswers = new Set([
			"Configure git?",
			"Enable UFW now?",
			"Enable daily disk cleanup? This enables a persistent timer that removes eligible idle worktrees, branches, build caches and temporary files.",
		]);
		const writeFileSync = actualFs.writeFileSync.bind(actualFs);
		actualFs.writeFileSync = (target, ...args) => {
			const tempRoot = path.resolve(process.env.TMPDIR);
			const resolvedTarget = path.resolve(target);
			if (!resolvedTarget.startsWith(tempRoot + path.sep)) {
				throw new Error("test attempted a write outside its temp directory: " + resolvedTarget);
			}
			return writeFileSync(target, ...args);
		};
		mock.module(${JSON.stringify(modulePath("src/common/utils.js"))}, () => ({
			commandExists: async () => false,
			log: { dim() {}, error(message) { events.push({ type: "error", message }); }, info() {}, success(message) { events.push({ type: "success", message }); }, warning(message) { events.push({ type: "warning", message }); } },
			promptUser: async (message, initial) => {
				events.push({ type: "prompt", message, initial });
				return message === "Enable UFW now?" ? ${JSON.stringify(firewall.enable ?? true)} : promptAnswers.has(message);
			},
			runCommand: async (command) => { events.push({ type: "command", command }); return !${JSON.stringify(firewall.runFailures ?? [])}.includes(command); },
			runCommandCapture: async (command) => {
				events.push({ type: "probe", command });
				if (${JSON.stringify(missingTailscale)}) return { exitCode: 127, failed: true, stdout: "", stderr: "tailscale: command not found" };
				if (Array.isArray(command)) {
					const profiles = ${JSON.stringify(firewall.profiles ?? {})};
					if (command.slice(0, 4).join(" ") !== "sudo ufw app info") throw new Error("Unexpected argv probe");
					const stdout = profiles[command[4]];
					return { exitCode: stdout === undefined ? 1 : 0, failed: stdout === undefined, stdout: stdout ?? "", stderr: "" };
				}
				const stdout = {
					"tailscale status --json": ${JSON.stringify(JSON.stringify(tailnetStatus))},
					"ip -j address show dev tailscale0": ${JSON.stringify(JSON.stringify(tailnetInterface))},
					"sudo ufw status": ${JSON.stringify(firewall.status ?? activeFirewall)},
					"sudo ufw show added": ${JSON.stringify(addedHeader + (firewall.rules ?? "(None)\n"))},
					"sudo cat /etc/default/ufw": ${JSON.stringify("IPV6=yes\n")},
				}[command];
				if (stdout === undefined) throw new Error("Unexpected probe: " + command);
				return { exitCode: 0, failed: false, stdout, stderr: "" };
			},
			portabilizeHome: (content) => content,
			safeCopyFile() {},
		}));
		mock.module(${JSON.stringify(modulePath("src/common/ui.js"))}, () => ({
			withSpinner: async (_message, action) => action(),
		}));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_git.js"))}, () => ({ configureGit: record("git") }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_claude.js"))}, () => ({
			configureClaude: record("claude", ${JSON.stringify(claudeResult)}),
		}));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_gh_stack.js"))}, () => ({ installGhStack: record("gh-stack") }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_worktree_cleanup.js"))}, () => ({ syncWorktreeCleanup: record("worktree-cleanup") }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_codex.js"))}, () => ({ configureCodex: async () => {
			events.push({ type: "helper", name: "codex" });
			if (${JSON.stringify(codexError)} !== null) throw new Error(${JSON.stringify(codexError)});
			return ${JSON.stringify(codexResult)};
		} }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_agents.js"))}, () => ({ syncAgentsConfig: record("agents", true) }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_axstack.js"))}, () => ({ configureAxstack: record("axstack", { ok: ${JSON.stringify(axstackResult)} }) }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_hermes_relay.js"))}, () => ({ configureHermesRelay: record("hermes-relay", ${JSON.stringify(relayResult)}) }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_t3_code_server.js"))}, () => ({ configureT3CodeServer: record("t3-code-server", ${JSON.stringify(t3Result)}) }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_paseo_server.js"))}, () => ({ configurePaseoServer: record("paseo-server", false) }));
		const { runDebianServerSetup } = await import(${JSON.stringify(debianModule)} + "?default-path-test");
		const result = await runDebianServerSetup();
		console.log("DEBIAN_EVENTS=" + JSON.stringify(events));
		console.log("DEBIAN_RESULT=" + JSON.stringify(result));
	`;

	try {
		const child = Bun.spawnSync([process.execPath, "--eval", childScript], {
			env: {
				...process.env,
				HOME: home,
				TMPDIR: home,
				USER: "haoshoku-test",
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		const output = `${new TextDecoder().decode(child.stdout)}\n${new TextDecoder().decode(child.stderr)}`;
		expect(child.exitCode, output).toBe(0);
		const encodedEvents = output.match(/DEBIAN_EVENTS=(.*)/)?.[1];
		expect(encodedEvents).toBeDefined();
		expect(fs.readFileSync(path.join(home, "jail.local"), "utf8")).toBe(
			buildFail2banJail(),
		);
		return {
			events: JSON.parse(encodedEvents),
			result: JSON.parse(output.match(/DEBIAN_RESULT=(.*)/)?.[1] ?? "null"),
		};
	} finally {
		fs.rmSync(home, { recursive: true });
	}
}

export const ufwRow = (to, from = "Anywhere", action = "ALLOW") =>
	`${to.padEnd(26)} ${action.padEnd(12)}${from}`;
export const realTailnetStatus = activeFirewall.replaceAll("ALLOW IN", "ALLOW   ");
export const profileInfo = (name, ports) =>
	`Profile: ${name}\nTitle: Fixture application\nDescription: Fixture service ports\n\n${ports.length > 1 || ports[0]?.includes(",") ? "Ports" : "Port"}:\n${ports.map((port) => `  ${port}`).join("\n")}\n`;
export function f1Capture({
	rows = [],
	rules = "(None)\n",
	profiles = {},
	active = true,
} = {}) {
	const status =
		realTailnetStatus +
		rows.map(([to, from, action]) => ufwRow(to, from, action)).join("\n") +
		"\n";
	const base = makeFakeCapture({
		"sudo ufw show added": probeOutput(addedHeader + rules),
	});
	const probes = [];
	let statuses = 0;
	const capture = async (command, options) => {
		probes.push(command);
		if (Array.isArray(command)) {
			expect(command.slice(0, 4)).toEqual(["sudo", "ufw", "app", "info"]);
			expect(command).toHaveLength(5);
			const response = profiles[command[4]];
			if (response instanceof Error) throw response;
			return response ?? probeOutput("", 1);
		}
		if (command === "sudo ufw status")
			return probeOutput(
				++statuses === 1 && !active ? "Status: inactive\n" : status,
			);
		return base.capture(command, options);
	};
	return { capture, probes };
}
