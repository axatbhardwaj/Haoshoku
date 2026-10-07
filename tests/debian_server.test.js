import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	buildFail2banJail,
	setupFirewall,
} from "../src/os_scripts/debian_server.js";

// A fake `run` that records every command it sees and returns a configured
// result per command substring. Defaults to `true` (success) for any command
// not explicitly mapped.
function makeFakeRun(overrides = {}) {
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

const tailnetStatus = {
	BackendState: "Running",
	TUN: true,
	Self: {
		Online: true,
		TailscaleIPs: ["100.101.102.103", "fd7a:115c:a1e0::1234"],
	},
	CurrentTailnet: { Name: "example.test", MagicDNSSuffix: "example.ts.net" },
};
const tailnetInterface = [
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
function probeOutput(stdout, exitCode = 0) {
	return { stdout, exitCode, failed: exitCode !== 0, stderr: "" };
}
const activeFirewall = `Status: active

To                         Action      From
--                         ------      ----
OpenSSH on tailscale0       ALLOW IN    Anywhere
80/tcp                     ALLOW IN    Anywhere
443/tcp                    ALLOW IN    Anywhere
OpenSSH (v6) on tailscale0  ALLOW IN    Anywhere (v6)
80/tcp (v6)                ALLOW IN    Anywhere (v6)
443/tcp (v6)               ALLOW IN    Anywhere (v6)
`;
const addedHeader =
	"Added user rules (see 'ufw status' for running firewall):\n";
const sshRule = "sudo ufw allow in on tailscale0 to any app OpenSSH";
function makeFakeCapture(overrides = {}) {
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

function makeFakePrompt(value = true) {
	const calls = [];
	const prompt = async (message) => {
		calls.push(message);
		return value;
	};
	return { prompt, calls };
}

function runDefaultSetupWithSafeDoubles({
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
		path.resolve(import.meta.dir, "..", relativePath);
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
			"Enable automatic git worktree cleanup? This enables a persistent weekly timer that runs cleanup-worktrees.sh --apply and deletes eligible worktrees.",
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

describe("buildFail2banJail", () => {
	const jail = buildFail2banJail();

	it("declares the [sshd] jail block", () => {
		expect(jail).toContain("[sshd]");
	});

	it("uses the systemd backend (Debian 12+ has no rsyslog/auth.log by default)", () => {
		expect(jail).toMatch(/^\s*backend\s*=\s*systemd\s*$/m);
	});

	it("keeps logpath = /var/log/auth.log (systemd backend ignores it)", () => {
		expect(jail).toMatch(/logpath\s*=\s*\/var\/log\/auth\.log/);
	});

	it("enables the jail", () => {
		expect(jail).toMatch(/enabled\s*=\s*true/);
	});

	it("is a pure function — repeated calls return identical content", () => {
		expect(buildFail2banJail()).toBe(jail);
	});
});

describe("setupFirewall (UFW lockout gate)", () => {
	it("does NOT enable UFW when the SSH allow rule fails (remote lockout risk)", async () => {
		const { run, calls } = makeFakeRun({ "to any app OpenSSH": false });
		const { prompt, calls: promptCalls } = makeFakePrompt(true);

		await setupFirewall({ run, prompt, capture: makeFakeCapture().capture });

		expect(calls.some((c) => c.includes("ufw enable"))).toBe(false);
		// It must not even reach the enable prompt.
		expect(promptCalls.length).toBe(0);
	});

	it("enables UFW when all rules succeed and the user confirms", async () => {
		const { run, calls } = makeFakeRun();
		const { prompt, calls: promptCalls } = makeFakePrompt(true);

		await setupFirewall({ run, prompt, capture: makeFakeCapture().capture });

		expect(promptCalls.length).toBe(1);
		expect(calls.some((c) => c.includes("ufw enable"))).toBe(true);
	});

	it("does NOT enable UFW when rules succeed but the user declines", async () => {
		const { run, calls } = makeFakeRun();
		const { prompt } = makeFakePrompt(false);

		await setupFirewall({ run, prompt, capture: makeFakeCapture().capture });

		expect(calls.some((c) => c.includes("ufw enable"))).toBe(false);
	});

	it("runs the SSH allow rule before deciding to enable", async () => {
		const { run, calls } = makeFakeRun();
		const { prompt } = makeFakePrompt(true);

		await setupFirewall({ run, prompt, capture: makeFakeCapture().capture });

		expect(calls.some((c) => c === sshRule)).toBe(true);
	});
});

describe("Debian default path", () => {
	it("runs every server-applicable developer component in deliberate order", () => {
		const { events, result } = runDefaultSetupWithSafeDoubles();
		const prompts = events.filter(({ type }) => type === "prompt");
		const helpers = events
			.filter(({ type }) => type === "helper")
			.map(({ name }) => name);

		expect(prompts).toContainEqual({
			type: "prompt",
			message: "Configure git?",
			initial: true,
		});
		expect(prompts.some(({ message }) => message.includes("gh-stack"))).toBe(
			false,
		);
		expect(
			prompts.filter(({ message }) =>
				/Claude stay-awake|Claude Remote Control|PR watch/.test(message),
			),
		).toEqual([]);
		expect(prompts).toContainEqual({
			type: "prompt",
			message: expect.stringContaining("automatic git worktree cleanup"),
			initial: false,
		});
		expect(prompts.some(({ message }) => message.includes("device"))).toBe(
			false,
		);
		expect(prompts.some(({ message }) => /T3 Code|Hermes/i.test(message))).toBe(
			false,
		);
		expect(helpers).toEqual([
			"git",
			"claude",
			"gh-stack",
			"worktree-cleanup",
			"codex",
			"agents",
			"axstack",
			"hermes-relay",
			"t3-code-server",
		]);
		expect(result).toBe(true);
	});

	it("requires T3 Code without a prompt and runs the same server helper", () => {
		const { events, result } = runDefaultSetupWithSafeDoubles();

		expect(result).toBe(true);
		expect(events).toContainEqual({ type: "helper", name: "t3-code-server" });
		expect(events).not.toContainEqual({ type: "helper", name: "paseo-server" });
	});

	it("reports Axstack failure without failing the remaining default setup", () => {
		const { events, result } = runDefaultSetupWithSafeDoubles({
			axstackResult: false,
		});

		expect(result).toBe(true);
		expect(events).toContainEqual({
			type: "warning",
			message: expect.stringContaining("Axstack setup is incomplete"),
		});
	});

	it("reports Claude and Codex install failures without failing setup", () => {
		const { events, result } = runDefaultSetupWithSafeDoubles({
			claudeResult: { ok: false, reason: "installer unavailable" },
			codexResult: { ok: false, reason: "registry unavailable" },
		});

		expect(result).toBe(true);
		expect(events).toContainEqual({
			type: "warning",
			message: expect.stringContaining(
				"Claude CLI installation failed: installer unavailable",
			),
		});
		expect(events).toContainEqual({
			type: "warning",
			message: expect.stringContaining(
				"Codex CLI installation failed: registry unavailable",
			),
		});
		expect(events).toContainEqual({
			type: "warning",
			message: expect.stringContaining(
				"Claude (installer unavailable); Codex (registry unavailable)",
			),
		});
	});

	it("continues server setup when Codex rejects ambiguous config", () => {
		const { events, result } = runDefaultSetupWithSafeDoubles({
			codexError: "Ambiguous multiline TOML",
		});
		expect(result).toBe(true);
		expect(events).toContainEqual({ type: "helper", name: "agents" });
		expect(events).toContainEqual({ type: "helper", name: "axstack" });
		expect(events).not.toContainEqual({
			type: "helper",
			name: "paseo-profiles",
		});
		expect(events).toContainEqual({
			type: "warning",
			message: expect.stringContaining("Ambiguous multiline TOML"),
		});
	});

	it("propagates required T3 Code setup failure without prompting", () => {
		const { events, result } = runDefaultSetupWithSafeDoubles({
			t3Result: false,
		});

		expect(result).toBe(false);
		expect(
			events.filter(
				({ type, message }) => type === "prompt" && /T3 Code/i.test(message),
			),
		).toEqual([]);
		expect(events.at(-1)).toEqual({
			type: "error",
			message: "Debian Server setup finished, but T3 Code was not configured.",
		});
	});

	it("propagates Hermes failure without prompting for Hermes", () => {
		const { events, result } = runDefaultSetupWithSafeDoubles({
			relayResult: false,
		});
		const helpers = events
			.filter(({ type }) => type === "helper")
			.map(({ name }) => name);

		expect(result).toBe(false);
		expect(helpers).toContain("hermes-relay");
		expect(
			events.filter(
				({ type, message }) => type === "prompt" && /hermes/i.test(message),
			),
		).toEqual([]);
		expect(events.at(-1)).toEqual({
			type: "error",
			message:
				"Debian Server setup finished, but the Hermes relay is incomplete.",
		});
	});
	it("never calls the retired Paseo helper during successful or failed setup", () => {
		for (const options of [{}, { t3Result: false }, { relayResult: false }]) {
			const { events, result } = runDefaultSetupWithSafeDoubles(options);
			expect(result).toBe(!Object.values(options).includes(false));
			expect(events).toContainEqual({ type: "helper", name: "hermes-relay" });
			expect(events).toContainEqual({ type: "helper", name: "t3-code-server" });
			expect(events).not.toContainEqual({
				type: "helper",
				name: "paseo-server",
			});
		}
	});
});

// First Usage slice: exercise the public firewall and whole Debian outcome.
describe("tailnet firewall prerequisites", () => {
	it("refuses fresh Debian without working Tailscale before any UFW mutation", async () => {
		const { run, calls } = makeFakeRun();
		const { prompt, calls: prompts } = makeFakePrompt(true);
		const result = await setupFirewall({
			run,
			prompt,
			capture: async () => ({
				exitCode: 127,
				failed: true,
				stdout: "",
				stderr: "tailscale: command not found",
			}),
		});
		expect(calls).toEqual([]);
		expect(prompts).toEqual([]);
		expect(result).toMatchObject({ ok: false });
		expect(result.reason).toMatch(/Tailscale/i);
	});
	it("reports overall Debian setup incomplete when Tailscale is missing", () => {
		const { events, result } = runDefaultSetupWithSafeDoubles({
			missingTailscale: true,
		});
		expect(result).toBe(false);
		expect(
			events.filter(
				({ type, command }) =>
					type === "command" && command.startsWith("sudo ufw "),
			),
		).toEqual([]);
		expect(events).toContainEqual({
			type: "error",
			message: expect.stringMatching(/firewall.*incomplete.*retry/i),
		});
	});
});

describe("tailnet readiness validation", () => {
	for (const [name, status] of [
		["logged out", { ...tailnetStatus, BackendState: "NeedsLogin" }],
		["stopped", { ...tailnetStatus, BackendState: "Stopped" }],
		[
			"offline",
			{ ...tailnetStatus, Self: { ...tailnetStatus.Self, Online: false } },
		],
		["userspace networking", { ...tailnetStatus, TUN: false }],
		["missing current tailnet", { ...tailnetStatus, CurrentTailnet: null }],
		["missing addresses", { ...tailnetStatus, Self: { Online: true } }],
		[
			"invalid address",
			{ ...tailnetStatus, Self: { Online: true, TailscaleIPs: ["not-an-ip"] } },
		],
		["malformed", "not json"],
		["empty", null],
	])
		it(`refuses ${name} status without mutation`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = makeFakeCapture({
				"tailscale status --json": probeOutput(
					typeof status === "string" ? status : JSON.stringify(status),
				),
			});
			const result = await setupFirewall({
				run,
				capture,
				prompt: async () => true,
			});
			expect(result).toMatchObject({ ok: false });
			expect(result.reason).toMatch(/Tailscale|tailnet/i);
			expect(calls).toEqual([]);
		});
	for (const [name, value] of [
		["absent", []],
		["ambiguous", [...tailnetInterface, ...tailnetInterface]],
		["wrong interface", [{ ...tailnetInterface[0], ifname: "eth0" }]],
		["down", [{ ...tailnetInterface[0], flags: ["POINTOPOINT"] }]],
		["no addresses", [{ ...tailnetInterface[0], addr_info: [] }]],
		[
			"wrong addresses",
			[
				{
					...tailnetInterface[0],
					addr_info: [{ family: "inet", local: "192.0.2.1" }],
				},
			],
		],
		[
			"IPv6 mismatch",
			[
				{
					...tailnetInterface[0],
					addr_info: [tailnetInterface[0].addr_info[0]],
				},
			],
		],
		["malformed", "not json"],
	])
		it(`refuses ${name} tailscale0 without mutation`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = makeFakeCapture({
				"ip -j address show dev tailscale0": probeOutput(
					typeof value === "string" ? value : JSON.stringify(value),
				),
			});
			const result = await setupFirewall({
				run,
				capture,
				prompt: async () => true,
			});
			expect(result).toMatchObject({ ok: false });
			expect(result.reason).toMatch(/tailscale0/i);
			expect(calls).toEqual([]);
		});
	it("refuses failed interface probe before mutation", async () => {
		const { run, calls } = makeFakeRun();
		const { capture } = makeFakeCapture({
			"ip -j address show dev tailscale0": probeOutput("", 1),
		});
		expect(await setupFirewall({ run, capture })).toMatchObject({ ok: false });
		expect(calls).toEqual([]);
	});
});

describe("tailnet firewall command outcomes", () => {
	it("installs interface OpenSSH before defaults, preserves web rules and confirms enable", async () => {
		const { run, calls } = makeFakeRun();
		const { prompt, calls: prompts } = makeFakePrompt(true);
		const result = await setupFirewall({
			run,
			prompt,
			capture: makeFakeCapture().capture,
		});
		expect(result).toMatchObject({ ok: true });
		expect(calls).toEqual([
			sshRule,
			"sudo ufw default deny incoming",
			"sudo ufw default allow outgoing",
			"sudo ufw allow http",
			"sudo ufw allow https",
			"sudo ufw enable",
		]);
		expect(prompts).toEqual(["Enable UFW now?"]);
	});
	it("applies the same rule-first ordering on active UFW without reset", async () => {
		const { run, calls } = makeFakeRun();
		const { prompt, calls: prompts } = makeFakePrompt(false);
		const result = await setupFirewall({
			run,
			prompt,
			capture: makeFakeCapture({
				"sudo ufw status": probeOutput(activeFirewall),
			}).capture,
		});
		expect(result).toMatchObject({ ok: true });
		expect(calls).toEqual([
			sshRule,
			"sudo ufw default deny incoming",
			"sudo ufw default allow outgoing",
			"sudo ufw allow http",
			"sudo ufw allow https",
		]);
		expect(prompts).toEqual(["Enable UFW now?"]);
	});
	it("reports inactive UFW incomplete when enable is declined", async () => {
		const { run, calls } = makeFakeRun();
		const result = await setupFirewall({
			run,
			prompt: async () => false,
			capture: makeFakeCapture().capture,
		});
		expect(result).toMatchObject({ ok: false });
		expect(result.reason).toMatch(/inactive.*retry/i);
		expect(calls).not.toContain("sudo ufw enable");
	});
	for (const command of [
		sshRule,
		"sudo ufw default deny incoming",
		"sudo ufw default allow outgoing",
		"sudo ufw allow http",
		"sudo ufw allow https",
		"sudo ufw enable",
	]) {
		it(`reports failed ${command} and refuses unsafe continuation`, async () => {
			const { run, calls } = makeFakeRun({ [command]: false });
			const { prompt, calls: prompts } = makeFakePrompt(true);
			const result = await setupFirewall({
				run,
				prompt,
				capture: makeFakeCapture().capture,
			});
			expect(result).toMatchObject({ ok: false });
			expect(result.reason).toContain(command);
			expect(calls.at(-1)).toBe(command);
			if (command !== "sudo ufw enable") expect(prompts).toEqual([]);
		});
	}
	for (const command of [
		"sudo ufw status",
		"sudo ufw show added",
		"sudo cat /etc/default/ufw",
	])
		it(`refuses failed ${command} inspection before mutation`, async () => {
			const { run, calls } = makeFakeRun();
			const result = await setupFirewall({
				run,
				capture: makeFakeCapture({ [command]: probeOutput("", 1) }).capture,
			});
			expect(result).toMatchObject({ ok: false });
			expect(calls).toEqual([]);
		});
	for (const [command, output] of [
		["sudo ufw status", ""],
		["sudo ufw status", "Status: active\nStatus: inactive"],
		["sudo ufw show added", "not a report"],
		["sudo cat /etc/default/ufw", "IPV6=no"],
		["sudo cat /etc/default/ufw", "IPV6=yes\nIPV6=no"],
	])
		it(`refuses ambiguous or unsupported inspection: ${output}`, async () => {
			const { run, calls } = makeFakeRun();
			expect(
				await setupFirewall({
					run,
					capture: makeFakeCapture({ [command]: probeOutput(output) }).capture,
				}),
			).toMatchObject({ ok: false });
			expect(calls).toEqual([]);
		});
});

describe("tailnet firewall hardening evidence", () => {
	for (const rule of [
		"ufw allow OpenSSH",
		"ufw allow ssh",
		"ufw allow 22/tcp",
		"ufw limit 22/tcp",
		"ufw allow from 0.0.0.0/0 to any port 22 proto tcp",
		"ufw allow from ::/0 to any port 22 proto tcp",
		"ufw allow in on eth0 to any port 22 proto tcp",
		"ufw allow 20:25/tcp",
		"ufw allow 22,80,443/tcp",
		"ufw allow from any",
	])
		it(`reports preserved public SSH rule: ${rule}`, async () => {
			const { run, calls } = makeFakeRun();
			const result = await setupFirewall({
				run,
				prompt: async () => true,
				capture: makeFakeCapture({
					"sudo ufw show added": probeOutput(addedHeader + rule + "\n"),
				}).capture,
			});
			expect(result).toMatchObject({ ok: false });
			expect(result.reason).toMatch(/public SSH.*operator.*retry/i);
			expect(calls).toContain(sshRule);
			expect(
				calls.some((c) =>
					/delete|reset|sshd|tailscale ssh|authorized_keys/.test(c),
				),
			).toBe(false);
		});
	it("reports IPv6-only existing public SSH in active status", async () => {
		const { run, calls } = makeFakeRun();
		const result = await setupFirewall({
			run,
			prompt: async () => false,
			capture: makeFakeCapture({
				"sudo ufw status": probeOutput(
					activeFirewall +
						"22/tcp (v6)               ALLOW IN    Anywhere (v6)\n",
				),
			}).capture,
		});
		expect(result).toMatchObject({ ok: false });
		expect(result.reason).toMatch(/public SSH/i);
		expect(calls).toContain(sshRule);
	});
	it("does not invent completeness on repeated setup with public rules", async () => {
		const { run, calls } = makeFakeRun();
		const { capture } = makeFakeCapture({
			"sudo ufw status": probeOutput(activeFirewall),
			"sudo ufw show added": probeOutput(
				addedHeader +
					"ufw allow 22/tcp\nufw allow in on tailscale0 to any app OpenSSH\n",
			),
		});
		for (let i = 0; i < 2; i++)
			expect(
				await setupFirewall({ run, capture, prompt: async () => false }),
			).toMatchObject({ ok: false });
		expect(calls.filter((c) => c === sshRule)).toHaveLength(2);
		expect(calls.some((c) => /delete|reset/.test(c))).toBe(false);
	});
	it("propagates public SSH hardening gap to overall Debian result", () => {
		const { result, events } = runDefaultSetupWithSafeDoubles({
			firewall: { rules: "ufw allow from ::/0 to any port 22 proto tcp\n" },
		});
		expect(result).toBe(false);
		expect(events).toContainEqual({
			type: "error",
			message: expect.stringMatching(/firewall.*incomplete/i),
		});
	});
	for (const output of [
		activeFirewall.replace(
			"OpenSSH (v6) on tailscale0  ALLOW IN    Anywhere (v6)\n",
			"",
		),
		activeFirewall.replace(
			"OpenSSH on tailscale0       ALLOW IN    Anywhere\n",
			"",
		),
		"Status: active\n",
		"Status: inactive\n",
		"Status: active\nStatus: inactive\n",
	])
		it(`requires verified active IPv4 and IPv6 tailnet rules: ${output.slice(0, 30)}`, async () => {
			const { run } = makeFakeRun();
			const base = makeFakeCapture();
			let statuses = 0;
			const capture = (command) =>
				command === "sudo ufw status" && ++statuses === 2
					? probeOutput(output)
					: base.capture(command);
			const result = await setupFirewall({
				run,
				capture,
				prompt: async () => true,
			});
			expect(result).toMatchObject({ ok: false });
			expect(result.reason).toMatch(/verif|inactive/i);
		});
	it("refuses unknown saved-rule format before mutation", async () => {
		const { run, calls } = makeFakeRun();
		expect(
			await setupFirewall({
				run,
				capture: makeFakeCapture({
					"sudo ufw show added": probeOutput(addedHeader + "nonsense\n"),
				}).capture,
			}),
		).toMatchObject({ ok: false });
		expect(calls).toEqual([]);
	});
});

describe("tailnet malformed readiness fields", () => {
	for (const state of [
		{ ...tailnetStatus, CurrentTailnet: { Name: true } },
		{ ...tailnetStatus, Self: { Online: true, TailscaleIPs: ["192.0.2.1"] } },
		{ ...tailnetStatus, Self: { Online: true, TailscaleIPs: ["100.1.2.3"] } },
		{ ...tailnetStatus, Self: { Online: true, TailscaleIPs: ["2001:db8::1"] } },
		{
			...tailnetStatus,
			Self: {
				Online: true,
				TailscaleIPs: ["100.101.102.103", "100.101.102.103"],
			},
		},
	])
		it(`refuses malformed tailnet identity ${JSON.stringify(state.Self)}`, async () => {
			const interfaces = [
				{
					...tailnetInterface[0],
					addr_info: state.Self.TailscaleIPs.map((local) => ({
						local,
						family: local.includes(":") ? "inet6" : "inet",
					})),
				},
			];
			const { run, calls } = makeFakeRun();
			const { capture } = makeFakeCapture({
				"tailscale status --json": probeOutput(JSON.stringify(state)),
				"ip -j address show dev tailscale0": probeOutput(
					JSON.stringify(interfaces),
				),
			});
			expect(
				await setupFirewall({ run, capture, prompt: async () => true }),
			).toMatchObject({ ok: false });
			expect(calls).toEqual([]);
		});
	for (const iface of [
		{ ...tailnetInterface[0], ifindex: 0 },
		{ ...tailnetInterface[0], ifindex: "7" },
		{
			...tailnetInterface[0],
			addr_info: [
				...tailnetInterface[0].addr_info,
				tailnetInterface[0].addr_info[0],
			],
		},
	])
		it("refuses malformed or ambiguous interface identity", async () => {
			const { run, calls } = makeFakeRun();
			expect(
				await setupFirewall({
					run,
					capture: makeFakeCapture({
						"ip -j address show dev tailscale0": probeOutput(
							JSON.stringify([iface]),
						),
					}).capture,
					prompt: async () => true,
				}),
			).toMatchObject({ ok: false });
			expect(calls).toEqual([]);
		});
});

describe("tailnet firewall boundary regressions", () => {
	it("keeps complete reruns complete with saved interface/web/outgoing/UDP rules", async () => {
		const { run, calls } = makeFakeRun();
		const { capture } = makeFakeCapture({
			"sudo ufw status": probeOutput(activeFirewall),
			"sudo ufw show added": probeOutput(
				addedHeader +
					"ufw allow in on tailscale0 to any app OpenSSH\nufw allow http\nufw allow https\nufw allow out 22/tcp\nufw allow 22/udp\nufw deny 22/tcp\nufw route allow from any to any port 22\n",
			),
		});
		for (let i = 0; i < 2; i++)
			expect(
				await setupFirewall({ run, capture, prompt: async () => false }),
			).toMatchObject({ ok: true });
		expect(calls.filter((c) => c === sshRule)).toHaveLength(2);
		expect(calls.filter((c) => c === "sudo ufw allow http")).toHaveLength(2);
		expect(calls.filter((c) => c === "sudo ufw allow https")).toHaveLength(2);
	});
	it("reports a thrown rule command and never changes defaults", async () => {
		const calls = [];
		const run = async (command) => {
			calls.push(command);
			throw new Error("fixture denied");
		};
		expect(
			await setupFirewall({ run, capture: makeFakeCapture().capture }),
		).toMatchObject({ ok: false });
		expect(calls).toEqual([sshRule]);
	});
	it("reports skipped confirmation on inactive UFW", async () => {
		const { run, calls } = makeFakeRun();
		const result = await setupFirewall({
			run,
			capture: makeFakeCapture().capture,
			prompt: async () => {
				throw new Error("confirmation unavailable");
			},
		});
		expect(result).toMatchObject({ ok: false });
		expect(result.reason).toMatch(/skipped.*retry/i);
		expect(calls).not.toContain("sudo ufw enable");
	});
	it("cannot treat a failed final status probe as complete", async () => {
		const { run } = makeFakeRun();
		const base = makeFakeCapture();
		let statuses = 0;
		const capture = (command) =>
			command === "sudo ufw status" && ++statuses === 2
				? probeOutput("", 1)
				: base.capture(command);
		expect(
			await setupFirewall({ run, capture, prompt: async () => true }),
		).toMatchObject({ ok: false });
	});
	it("refuses unknown application profiles without guessing SSH exposure", async () => {
		const { run, calls } = makeFakeRun();
		const result = await setupFirewall({
			run,
			capture: makeFakeCapture({
				"sudo ufw show added": probeOutput(
					addedHeader + "ufw allow CustomProfile\n",
				),
			}).capture,
		});
		expect(result).toMatchObject({ ok: false });
		expect(result.reason).toMatch(/operator inspection/i);
		expect(calls).toEqual([]);
	});
	for (const firewall of [
		{ status: "Status: inactive\n", enable: false },
		{ runFailures: [sshRule] },
		{ runFailures: ["sudo ufw enable"] },
	])
		it(`propagates firewall incompleteness through overall setup: ${JSON.stringify(firewall)}`, () => {
			const { result, events } = runDefaultSetupWithSafeDoubles({ firewall });
			expect(result).toBe(false);
			expect(events).toContainEqual({
				type: "error",
				message: expect.stringMatching(/firewall.*incomplete.*retry/i),
			});
			expect(events).not.toContainEqual({
				type: "success",
				message: expect.stringContaining("Debian Server setup finished"),
			});
			expect(events).toContainEqual({
				type: "command",
				command: "sudo systemctl enable ssh",
			});
			expect(events).toContainEqual({
				type: "command",
				command: "sudo systemctl start ssh",
			});
		});
});

it("accepts UFW's genuine empty saved rules report", async () => {
	const { run, calls } = makeFakeRun();
	const result = await setupFirewall({
		run,
		prompt: async () => true,
		capture: makeFakeCapture({
			"sudo ufw show added": probeOutput(`${addedHeader}(None)\n`),
		}).capture,
	});
	expect(result).toMatchObject({ ok: true });
	expect(calls[0]).toBe(sshRule);
});

// UFW's non-verbose get_status formatter: incoming action has no IN suffix.
const ufwRow = (to, from = "Anywhere", action = "ALLOW") =>
	`${to.padEnd(26)} ${action.padEnd(12)}${from}`;
const realTailnetStatus = activeFirewall.replaceAll("ALLOW IN", "ALLOW   ");
const profileInfo = (name, ports) =>
	`Profile: ${name}\nTitle: Fixture application\nDescription: Fixture service ports\n\n${ports.length > 1 || ports[0]?.includes(",") ? "Ports" : "Port"}:\n${ports.map((port) => `  ${port}`).join("\n")}\n`;
function f1Capture({
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

describe("F1 legitimate firewall coexistence", () => {
	for (const [name, ports] of [
		["Nginx Full", ["80,443/tcp"]],
		["Apache Full", ["80/tcp", "443/tcp"]],
		["Postfix", ["25/tcp"]],
	]) {
		for (const active of [true, false])
			it(`completes with ${name} profile on ${active ? "active" : "inactive"} UFW`, async () => {
				const { run, calls } = makeFakeRun();
				const { capture, probes } = f1Capture({
					active,
					rows: active ? [[name], [name + " (v6)", "Anywhere (v6)"]] : [],
					rules: `ufw allow '${name}'\n`,
					profiles: { [name]: probeOutput(profileInfo(name, ports)) },
				});
				const result = await setupFirewall({
					run,
					capture,
					prompt: async () => true,
				});
				expect(result).toMatchObject({ ok: true });
				expect(calls).toEqual([
					sshRule,
					"sudo ufw default deny incoming",
					"sudo ufw default allow outgoing",
					"sudo ufw allow http",
					"sudo ufw allow https",
					"sudo ufw enable",
				]);
				expect(probes.filter(Array.isArray)).toContainEqual([
					"sudo",
					"ufw",
					"app",
					"info",
					name,
				]);
			});
	}
	for (const [destination, ports] of [
		["203.0.113.5", "80/tcp"],
		["2001:db8::5", "443/tcp"],
		["203.0.113.0/24", "80,443/tcp"],
	])
		it(`completes with non-SSH destination ${destination} ${ports}`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = f1Capture({
				rows: [[`${destination} ${ports}`]],
				rules: `ufw allow from any to ${destination} port ${ports.replace("/tcp", "")} proto tcp\n`,
			});
			expect(
				await setupFirewall({ run, capture, prompt: async () => false }),
			).toMatchObject({ ok: true });
			expect(calls[0]).toBe(sshRule);
		});
	it("resolves a destination-address application profile", async () => {
		const { run } = makeFakeRun();
		const { capture } = f1Capture({
			rows: [["203.0.113.5 Nginx Full"]],
			rules: "ufw allow from any to 203.0.113.5 app 'Nginx Full'\n",
			profiles: {
				"Nginx Full": probeOutput(profileInfo("Nginx Full", ["80,443/tcp"])),
			},
		});
		expect(
			await setupFirewall({ run, capture, prompt: async () => true }),
		).toMatchObject({ ok: true });
	});
	for (const logMode of ["log", "log-all"])
		it(`does not label ${logMode} web rules as public SSH`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = f1Capture({
				rows: [["80/tcp", "Anywhere (log) # web to 22"]],
				rules: `ufw allow ${logMode} 80/tcp comment 'SSH stays on tailscale0'\n`,
			});
			expect(
				await setupFirewall({ run, capture, prompt: async () => true }),
			).toMatchObject({ ok: true });
			expect(calls).not.toContain("sudo ufw delete 80/tcp");
		});
	it("propagates legitimate web coexistence to successful overall Debian setup", () => {
		const { result, events } = runDefaultSetupWithSafeDoubles({
			firewall: {
				status:
					realTailnetStatus +
					ufwRow("Nginx Full") +
					"\n" +
					ufwRow("203.0.113.5 80/tcp") +
					"\n",
				rules: "ufw allow 'Nginx Full'\nufw allow log-all 80/tcp\n",
				profiles: { "Nginx Full": profileInfo("Nginx Full", ["80,443/tcp"]) },
			},
		});
		expect(result).toBe(true);
		expect(events).toContainEqual({
			type: "success",
			message: "Debian Server setup finished.",
		});
	});
});

describe("F1 profile inspection safety", () => {
	const name = "Web app.v2+TLS";
	for (const [label, response] of [
		["lookup failure", probeOutput("", 1)],
		["lookup throw", new Error("fixture unavailable")],
		[
			"missing ports",
			probeOutput(`Profile: ${name}\nTitle: Web\nDescription: Web\n`),
		],
		["wrong profile", probeOutput(profileInfo("Other", ["80/tcp"]))],
		[
			"ambiguous profiles",
			probeOutput(
				profileInfo(name, ["80/tcp"]) + profileInfo("OpenSSH", ["22/tcp"]),
			),
		],
		["unparseable ports", probeOutput(profileInfo(name, ["not-ports"]))],
		[
			"SSH then malformed",
			probeOutput(profileInfo(name, ["22/tcp", "bad/udp"])),
		],
		["empty ports", probeOutput(profileInfo(name, []))],
		["zero port", probeOutput(profileInfo(name, ["0/tcp"]))],
		["out-of-range port", probeOutput(profileInfo(name, ["65536/tcp"]))],
		["reversed range", probeOutput(profileInfo(name, ["443:80/tcp"]))],
	])
		it(`fails closed with specific profile guidance on ${label}`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture, probes } = f1Capture({
				active: false,
				rules: `ufw allow '${name}'\n`,
				profiles: { [name]: response },
			});
			const result = await setupFirewall({
				run,
				capture,
				prompt: async () => true,
			});
			expect(probes.filter(Array.isArray)).toEqual([
				["sudo", "ufw", "app", "info", name],
			]);
			expect(result).toMatchObject({ ok: false });
			expect(result.reason).toContain(name);
			expect(result.reason).toMatch(/inspection.*retry/i);
			expect(calls).toEqual([]);
		});
	it("passes a valid spaced profile name as one argument, not shell text", async () => {
		const { run } = makeFakeRun();
		const { capture, probes } = f1Capture({
			rules: `ufw allow '${name}'\n`,
			profiles: {
				[name]: probeOutput(profileInfo(name, ["80/tcp", "443/udp"])),
			},
		});
		expect(
			await setupFirewall({ run, capture, prompt: async () => false }),
		).toMatchObject({ ok: true });
		expect(probes.filter(Array.isArray)).toContainEqual([
			"sudo",
			"ufw",
			"app",
			"info",
			name,
		]);
	});
	for (const malicious of [
		"Web;touch /tmp/escape",
		"Web$(id)",
		"Web`id`",
		"-all",
		"all",
		"Web\nPorts: 80/tcp",
	])
		it(`refuses invalid profile name ${JSON.stringify(malicious)} without a lookup`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture, probes } = f1Capture({
				rules: `ufw allow '${malicious}'\n`,
			});
			expect(
				await setupFirewall({ run, capture, prompt: async () => true }),
			).toMatchObject({ ok: false });
			expect(probes.filter(Array.isArray)).toEqual([]);
			expect(calls).toEqual([]);
		});
});

describe("F1 destination grammar validation", () => {
	for (const address of [
		"203.0.113.5/33",
		"2001:db8::5/129",
		"203.0.113.5/garbage",
		"2001:db8::5/64/extra",
	])
		it(`refuses malformed status destination ${address} before mutation`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = f1Capture({ rows: [[`${address} 80/tcp`]] });
			expect(
				await setupFirewall({ run, capture, prompt: async () => true }),
			).toMatchObject({ ok: false });
			expect(calls).toEqual([]);
		});
	for (const address of ["banana", "203.0.113.5/33", "2001:db8::5/129"])
		it(`refuses malformed saved destination ${address} before mutation`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = f1Capture({
				rules: `ufw allow from any to ${address} port 80 proto tcp\n`,
			});
			expect(
				await setupFirewall({ run, capture, prompt: async () => true }),
			).toMatchObject({ ok: false });
			expect(calls).toEqual([]);
		});
});

describe("F1 SSH-bearing profile detection", () => {
	for (const [name, rule, rows] of [
		["HTTP", "ufw allow HTTP\n", [["HTTP"], ["HTTP (v6)", "Anywhere (v6)"]]],
		["https", "ufw allow to any app https\n", []],
	])
		it(`does not guess an application called ${name} is a safe web alias`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture, probes } = f1Capture({
				rows,
				rules: rule,
				profiles: {
					[name]: probeOutput(profileInfo(name, ["80/tcp", "22/tcp"])),
				},
			});
			const result = await setupFirewall({
				run,
				capture,
				prompt: async () => true,
			});
			expect(result).toMatchObject({ ok: false });
			expect(result.reason).toMatch(/public SSH/i);
			expect(probes.filter(Array.isArray)).toContainEqual([
				"sudo",
				"ufw",
				"app",
				"info",
				name,
			]);
			expect(calls[0]).toBe(sshRule);
		});
	for (const ports of [
		["22/tcp"],
		["80,22,443/tcp"],
		["20:25/tcp"],
		["22/udp", "20:25/tcp"],
	])
		it(`preserves and reports actual SSH-bearing profile ports ${ports}`, async () => {
			const name = "SSH out of band";
			const { run, calls } = makeFakeRun();
			const { capture } = f1Capture({
				active: false,
				rules: `ufw allow log-all '${name}'\n`,
				profiles: { [name]: probeOutput(profileInfo(name, ports)) },
			});
			for (let i = 0; i < 2; i++) {
				const result = await setupFirewall({
					run,
					capture,
					prompt: async () => true,
				});
				expect(result).toMatchObject({ ok: false });
				expect(result.reason).toMatch(/public SSH.*operator.*retry/i);
			}
			expect(calls.filter((c) => c === sshRule)).toHaveLength(2);
			expect(calls.some((c) => /delete|reset/.test(c))).toBe(false);
		});
	it("keeps profile UDP 22 separate from TCP SSH", async () => {
		const name = "UDP and web";
		const { run } = makeFakeRun();
		const { capture } = f1Capture({
			rules: `ufw allow log "${name}"\n`,
			profiles: {
				[name]: probeOutput(profileInfo(name, ["22/udp", "80,443/tcp"])),
			},
		});
		expect(
			await setupFirewall({ run, capture, prompt: async () => false }),
		).toMatchObject({ ok: true });
	});
	for (const [address, port] of [
		["203.0.113.5", "22/tcp"],
		["2001:db8::5", "20:25/tcp"],
	])
		it(`reports existing SSH at ${address}`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = f1Capture({
				rows: [[`${address} ${port}`]],
				rules: `ufw allow log-all from any to ${address} port ${port.replace("/tcp", "")} proto tcp\n`,
			});
			const result = await setupFirewall({
				run,
				capture,
				prompt: async () => true,
			});
			expect(result).toMatchObject({ ok: false });
			expect(result.reason).toMatch(/public SSH/i);
			expect(calls.some((c) => /delete|reset/.test(c))).toBe(false);
		});
	it("propagates profile lookup failure into overall incomplete setup", () => {
		const { result, events } = runDefaultSetupWithSafeDoubles({
			firewall: { rules: "ufw allow 'Nginx Full'\n" },
		});
		expect(result).toBe(false);
		expect(events).toContainEqual({
			type: "error",
			message: expect.stringMatching(
				/firewall.*incomplete.*Nginx Full.*retry/i,
			),
		});
	});
});

describe("F5 native UFW protocol grammar", () => {
	// util.py's supported protocols; ipv6 and igmp are IPv4-only, all but UDP
	// here are portless. Strings follow backend_iptables.py's status renderer.
	for (const protocol of ["udp", "esp", "ah", "gre", "ipv6", "igmp", "vrrp"]) {
		const destinations = ["Anywhere", "203.0.113.5", "203.0.113.0/24"];
		if (!["ipv6", "igmp"].includes(protocol))
			destinations.push(
				"Anywhere (v6)",
				"2001:db8::5",
				"2001:db8::/32",
				"2001:db8::/64",
			);
		for (const destination of destinations) {
			const address = destination.replace(" (v6)", "");
			const to = `${address}/${protocol}${destination.endsWith("(v6)") ? " (v6)" : ""}`;
			for (const active of [true, false])
				it(`completes ${active ? "active status" : "inactive saved"} ${to}`, async () => {
					const { run, calls } = makeFakeRun();
					const { capture, probes } = f1Capture({
						active,
						rows: active
							? [
									[
										to,
										address === "Anywhere"
											? to
											: destination.includes("v6") || address.includes(":")
												? "Anywhere (v6)"
												: "Anywhere",
									],
								]
							: [],
						rules: `ufw allow log-all from any to ${address === "Anywhere" ? "any" : address} proto ${protocol} comment 'TCP SSH stays on tailscale0'\n`,
					});
					const result = await setupFirewall({
						run,
						capture,
						prompt: async () => true,
					});
					expect(result).toMatchObject({ ok: true });
					expect(calls).toEqual([
						sshRule,
						"sudo ufw default deny incoming",
						"sudo ufw default allow outgoing",
						"sudo ufw allow http",
						"sudo ufw allow https",
						"sudo ufw enable",
					]);
					expect(probes.filter(Array.isArray)).toEqual([]);
				});
		}
		it(`accepts native source-address-only ${protocol} protocol display`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = f1Capture({
				rows: [["Anywhere", `203.0.113.0/24/${protocol}`]],
				rules: `ufw allow from 203.0.113.0/24 to any proto ${protocol}\n`,
			});
			expect(
				await setupFirewall({ run, capture, prompt: async () => true }),
			).toMatchObject({ ok: true });
			expect(calls[0]).toBe(sshRule);
		});
	}
	for (const [to, from, saved] of [
		["22/udp", "Anywhere", "ufw allow 22/udp"],
		[
			"2001:db8::/64 20:25/udp",
			"Anywhere (v6)",
			"ufw allow to 2001:db8::/64 port 20:25 proto udp",
		],
		[
			"203.0.113.0/24 80,443/udp",
			"Anywhere",
			"ufw allow to 203.0.113.0/24 port 80,443 proto udp",
		],
		["Anywhere", "53/udp", "ufw allow from any port 53 to any proto udp"],
		[
			"2001:db8::/64",
			"2001:db8:1::/64 53/udp",
			"ufw allow from 2001:db8:1::/64 port 53 to 2001:db8::/64 proto udp",
		],
	])
		it(`keeps native UDP port variant ${to} from ${from} non-SSH`, async () => {
			const { run } = makeFakeRun();
			const { capture } = f1Capture({
				rows: [[to, from]],
				rules: `${saved}\n`,
			});
			expect(
				await setupFirewall({ run, capture, prompt: async () => true }),
			).toMatchObject({ ok: true });
		});
	for (const [to, saved] of [
		["203.0.113.0/24/tcp", "ufw allow to 203.0.113.0/24 proto tcp"],
		["2001:db8::/64/tcp", "ufw allow to 2001:db8::/64 proto tcp"],
		["Anywhere/tcp", "ufw allow to any proto tcp"],
		["Anywhere (v6)", "ufw allow to any"],
		["2001:db8::/64", "ufw allow to 2001:db8::/64"],
		[
			"203.0.113.0/24 20:25/tcp",
			"ufw allow to 203.0.113.0/24 port 20:25 proto tcp",
		],
	])
		it(`preserves truthful public SSH guidance for ${to}`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = f1Capture({ rows: [[to]], rules: `${saved}\n` });
			for (let repeat = 0; repeat < 2; repeat++) {
				const result = await setupFirewall({
					run,
					capture,
					prompt: async () => true,
				});
				expect(result).toMatchObject({ ok: false });
				expect(result.reason).toMatch(/public SSH.*operator.*retry/i);
			}
			expect(calls[0]).toBe(sshRule);
			expect(calls.some((c) => /delete|reset/.test(c))).toBe(false);
		});
	for (const [to, from, saved] of [
		["203.0.113.0/33/udp", "Anywhere", "ufw allow to 203.0.113.0/33 proto udp"],
		[
			"2001:db8::/129/esp",
			"Anywhere (v6)",
			"ufw allow to 2001:db8::/129 proto esp",
		],
		[
			"2001:db8::/64/extra",
			"Anywhere (v6)",
			"ufw allow to 2001:db8::/64 proto extra",
		],
		[
			"2001:db8::/64/udp/extra",
			"Anywhere (v6)",
			"ufw allow to 2001:db8::/64 proto udp proto extra",
		],
		["Anywhere/icmp", "Anywhere", "ufw allow to any proto icmp"],
		["Anywhere/UDP", "Anywhere", "ufw allow to any proto UDP"],
		["Anywhere/", "Anywhere", "ufw allow to any proto"],
		[
			"Anywhere/esp (v6)",
			"Anywhere (v6)",
			"ufw allow to any proto esp proto udp",
		],
		[
			"Anywhere/ipv6 (v6)",
			"Anywhere (v6)",
			"ufw allow to 2001:db8::/64 proto ipv6",
		],
		[
			"2001:db8::/64/igmp",
			"Anywhere (v6)",
			"ufw allow to 2001:db8::/64 proto igmp",
		],
		["22/esp", "Anywhere", "ufw allow to any port 22 proto esp"],
		["Anywhere/gre", "22/gre", "ufw allow from any port 22 to any proto gre"],
		["Anywhere", "53/extra", "ufw allow from any port 53 to any proto extra"],
		["22/tcp", "53/udp", "ufw allow to any port 22 proto tcp proto udp"],
	])
		for (const active of [true, false])
			it(`refuses malformed ${active ? "status" : "saved"} protocol ${to} / ${saved}`, async () => {
				const { run, calls } = makeFakeRun();
				const { capture } = f1Capture({
					active,
					rows: active ? [[to, from]] : [],
					rules: `${saved}\n`,
				});
				expect(
					await setupFirewall({ run, capture, prompt: async () => true }),
				).toMatchObject({ ok: false });
				expect(calls).toEqual([]);
			});
	for (const saved of [
		"ufw allow to any port 22/udp proto tcp",
		"ufw allow to any port 22/tcp proto udp",
		"ufw allow from any port 53/tcp to any proto udp",
	])
		it(`refuses malformed full saved port/protocol syntax ${saved}`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = f1Capture({ active: false, rules: `${saved}\n` });
			expect(
				await setupFirewall({ run, capture, prompt: async () => true }),
			).toMatchObject({ ok: false });
			expect(calls).toEqual([]);
		});
	it("propagates valid CIDR/protocol coexistence into overall Debian success", () => {
		const { result, events } = runDefaultSetupWithSafeDoubles({
			firewall: {
				status:
					realTailnetStatus +
					ufwRow("203.0.113.0/24/udp") +
					"\n" +
					ufwRow("Anywhere/esp") +
					"\n",
				rules:
					"ufw allow to 203.0.113.0/24 proto udp\nufw allow to any proto esp\n",
			},
		});
		expect(result).toBe(true);
		expect(events).toContainEqual({
			type: "success",
			message: "Debian Server setup finished.",
		});
	});
	it("propagates CIDR TCP public SSH guidance into overall incomplete", () => {
		const { result, events } = runDefaultSetupWithSafeDoubles({
			firewall: {
				status:
					realTailnetStatus +
					ufwRow("2001:db8::/64/tcp", "Anywhere (v6)") +
					"\n",
				rules: "ufw allow to 2001:db8::/64 proto tcp\n",
			},
		});
		expect(result).toBe(false);
		expect(events).toContainEqual({
			type: "error",
			message: expect.stringMatching(
				/firewall.*incomplete.*public SSH.*retry/i,
			),
		});
	});
});

describe("F6 native interface-only rules", () => {
	for (const iface of ["wg0", "tailscale0"])
		for (const action of ["allow", "limit"])
			for (const logging of ["", " log", " log-all"])
				for (const comment of [
					"",
					" comment 'vpc # proto udp in on tailscale0'",
				])
					for (const active of [true, false])
						it(`${active ? "active" : "inactive"}: ${action} in on ${iface}${logging}${comment}`, async () => {
							const { run, calls } = makeFakeRun();
							const { capture } = f1Capture({
								active,
								rows: [
									[`Anywhere on ${iface}`, "Anywhere", action.toUpperCase()],
									[
										`Anywhere (v6) on ${iface}`,
										"Anywhere (v6)",
										action.toUpperCase(),
									],
								],
								rules: `ufw ${action} in on ${iface}${logging}${comment}\n`,
							});
							for (let repeat = 0; repeat < 2; repeat++) {
								const result = await setupFirewall({
									run,
									capture,
									prompt: async () => true,
								});
								expect(result).toMatchObject({ ok: iface === "tailscale0" });
								if (iface !== "tailscale0")
									expect(result.reason).toMatch(/public SSH.*operator.*retry/i);
							}
							const expected = [
								sshRule,
								"sudo ufw default deny incoming",
								"sudo ufw default allow outgoing",
								"sudo ufw allow http",
								"sudo ufw allow https",
								"sudo ufw enable",
							];
							for (const start of [0, expected.length])
								expect(calls.slice(start, start + expected.length)).toEqual(
									expected,
								);
							expect(
								calls.some((c) => /delete|reset|tailscale ssh|sshd/.test(c)),
							).toBe(false);
						});
	for (const iface of ["eth1", "br-vpc.10", "wg+"])
		it(`recognizes valid UFW interface ${iface}`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = f1Capture({
				active: false,
				rules: `ufw allow in on ${iface}\n`,
			});
			const result = await setupFirewall({
				run,
				capture,
				prompt: async () => true,
			});
			expect(result).toMatchObject({ ok: false });
			expect(result.reason).toMatch(/public SSH.*operator.*retry/i);
			expect(calls[0]).toBe(sshRule);
		});
	for (const rule of [
		"ufw allow",
		"ufw allow log",
		"ufw allow in",
		"ufw allow in on",
		"ufw allow in on ''",
		"ufw allow in on .",
		"ufw allow in on ..",
		"ufw allow in on eth0:1",
		"ufw allow in on wg/0",
		"ufw allow in on 1234567890123456",
		"ufw allow in on 'wg 0'",
		"ufw allow in on 'wg;id'",
		"ufw allow in on wg0 nonsense",
		"ufw allow in on wg0 log log-all",
		"ufw allow in on wg0 proto",
		"ufw allow in on tailscale0 proto extra",
		"ufw allow in on tailscale0 nonsense",
	])
		it(`refuses malformed/truncated interface syntax ${rule}`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = f1Capture({ active: false, rules: `${rule}\n` });
			expect(
				await setupFirewall({ run, capture, prompt: async () => true }),
			).toMatchObject({ ok: false });
			expect(calls).toEqual([]);
		});
	for (const active of [true, false])
		it(`keeps interface-qualified UDP eligible on ${active ? "active" : "inactive"} UFW`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = f1Capture({
				active,
				rows: [
					["Anywhere/udp on wg0", "Anywhere/udp"],
					["Anywhere/udp (v6) on wg0", "Anywhere/udp (v6)"],
				],
				rules: "ufw allow in on wg0 log-all proto udp\n",
			});
			expect(
				await setupFirewall({ run, capture, prompt: async () => true }),
			).toMatchObject({ ok: true });
			expect(calls[0]).toBe(sshRule);
		});
	it("propagates truthful interface-only migration guidance and ordering through overall Debian setup", () => {
		const { result, events } = runDefaultSetupWithSafeDoubles({
			firewall: { rules: "ufw allow in on wg0\n" },
		});
		expect(result).toBe(false);
		expect(events).toContainEqual({
			type: "error",
			message: expect.stringMatching(
				/firewall.*incomplete.*public SSH.*operator.*retry/i,
			),
		});
		const commands = events
			.filter((e) => e.type === "command" && e.command.startsWith("sudo ufw "))
			.map((e) => e.command);
		expect(commands).toEqual([
			sshRule,
			"sudo ufw default deny incoming",
			"sudo ufw default allow outgoing",
			"sudo ufw allow http",
			"sudo ufw allow https",
			"sudo ufw enable",
		]);
	});
});
