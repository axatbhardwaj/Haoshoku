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
