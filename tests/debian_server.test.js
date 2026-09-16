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
	paseoResult = true,
	profileResult = true,
	relayResult = true,
	t3Answer = false,
	t3Result = true,
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
			"Enable Claude stay-awake service?",
			"Install Claude Remote Control services with all permission checks bypassed? This permanently sets bypassPermissionsModeAccepted: true in ~/.claude.json for every Claude Code session on this machine, not only these services. To undo it, edit ~/.claude.json and remove the flag or set it to false.",
			"Enable automatic git worktree cleanup? This enables a persistent weekly timer that runs cleanup-worktrees.sh --apply and deletes eligible worktrees.",
		]);
		const t3Prompt = "Also configure the T3 Code service?";
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
			log: { dim() {}, error(message) { events.push({ type: "error", message }); }, info() {}, success() {}, warning(message) { events.push({ type: "warning", message }); } },
			promptUser: async (message, initial) => {
				events.push({ type: "prompt", message, initial });
				if (message === t3Prompt) return ${JSON.stringify(t3Answer)};
				return promptAnswers.has(message);
			},
			runCommand: async () => true,
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
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_claude_stay_awake.js"))}, () => ({ configureClaudeStayAwake: record("stay-awake") }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_claude_remote_control.js"))}, () => ({ configureClaudeRemoteControl: record("remote-control") }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_pr_watch.js"))}, () => ({ configurePrWatch: record("pr-watch") }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_worktree_cleanup.js"))}, () => ({ syncWorktreeCleanup: record("worktree-cleanup") }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_codex.js"))}, () => ({ configureCodex: record("codex", ${JSON.stringify(codexResult)}) }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_axstack.js"))}, () => ({ configureAxstack: record("axstack", { ok: ${JSON.stringify(axstackResult)} }) }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_skills.js"))}, () => ({ configureSkills: record("skills", true) }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_agent_skills.js"))}, () => ({ syncAgentSkills: record("agent-skills", true) }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_paseo_profiles.js"))}, () => ({ syncPaseoProfiles: record("paseo-profiles", ${JSON.stringify(profileResult)}) }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_hermes_relay.js"))}, () => ({ configureHermesRelay: record("hermes-relay", ${JSON.stringify(relayResult)}) }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_t3_code_server.js"))}, () => ({ configureT3CodeServer: record("t3-code-server", ${JSON.stringify(t3Result)}) }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_paseo_server.js"))}, () => ({ configurePaseoServer: record("paseo-server", ${JSON.stringify(paseoResult)}) }));
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
		fs.rmSync(home, { recursive: true, force: true });
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
		const { run, calls } = makeFakeRun({ "ufw allow ssh": false });
		const { prompt, calls: promptCalls } = makeFakePrompt(true);

		await setupFirewall({ run, prompt });

		expect(calls.some((c) => c.includes("ufw enable"))).toBe(false);
		// It must not even reach the enable prompt.
		expect(promptCalls.length).toBe(0);
	});

	it("enables UFW when all rules succeed and the user confirms", async () => {
		const { run, calls } = makeFakeRun();
		const { prompt, calls: promptCalls } = makeFakePrompt(true);

		await setupFirewall({ run, prompt });

		expect(promptCalls.length).toBe(1);
		expect(calls.some((c) => c.includes("ufw enable"))).toBe(true);
	});

	it("does NOT enable UFW when rules succeed but the user declines", async () => {
		const { run, calls } = makeFakeRun();
		const { prompt } = makeFakePrompt(false);

		await setupFirewall({ run, prompt });

		expect(calls.some((c) => c.includes("ufw enable"))).toBe(false);
	});

	it("runs the SSH allow rule before deciding to enable", async () => {
		const { run, calls } = makeFakeRun();
		const { prompt } = makeFakePrompt(true);

		await setupFirewall({ run, prompt });

		expect(calls.some((c) => c.includes("ufw allow ssh"))).toBe(true);
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
		expect(prompts).toContainEqual({
			type: "prompt",
			message: "Enable Claude stay-awake service?",
			initial: true,
		});
		expect(prompts).toContainEqual({
			type: "prompt",
			message: expect.stringContaining("Claude Remote Control"),
			initial: false,
		});
		expect(prompts).toContainEqual({
			type: "prompt",
			message: expect.stringContaining("automatic git worktree cleanup"),
			initial: false,
		});
		expect(prompts.some(({ message }) => message.includes("device"))).toBe(
			false,
		);
		expect(prompts).toContainEqual({
			type: "prompt",
			message: "Also configure the T3 Code service?",
			initial: false,
		});
		expect(helpers).toEqual([
			"git",
			"claude",
			"gh-stack",
			"stay-awake",
			"remote-control",
			"pr-watch",
			"worktree-cleanup",
			"codex",
			"skills",
			"agent-skills",
			"paseo-server",
			"axstack",
			"paseo-profiles",
			"hermes-relay",
		]);
		expect(result).toBe(true);
	});

	it("configures T3 Code only when its optional prompt is accepted", () => {
		const { events, result } = runDefaultSetupWithSafeDoubles({
			t3Answer: true,
		});

		expect(result).toBe(true);
		expect(events).toContainEqual({ type: "helper", name: "t3-code-server" });
		expect(events).toContainEqual({ type: "helper", name: "paseo-server" });
		expect(
			events.findIndex(({ name }) => name === "paseo-server"),
		).toBeLessThan(events.findIndex(({ name }) => name === "t3-code-server"));
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

	it("propagates a selected T3 Code setup failure", () => {
		const { events, result } = runDefaultSetupWithSafeDoubles({
			t3Answer: true,
			t3Result: false,
		});

		expect(result).toBe(false);
		expect(events.at(-1)).toEqual({
			type: "error",
			message: "Debian Server setup finished, but T3 Code was not configured.",
		});
	});

	it("propagates a selected Paseo setup failure", () => {
		const { events, result } = runDefaultSetupWithSafeDoubles({
			paseoResult: false,
		});

		expect(result).toBe(false);
		expect(events).toContainEqual({ type: "helper", name: "paseo-server" });
		expect(events.at(-1)).toEqual({
			type: "error",
			message:
				"Debian Server setup finished, but Paseo setup or pairing is incomplete.",
		});
	});

	it("propagates a Paseo orchestration policy sync failure", () => {
		const { events, result } = runDefaultSetupWithSafeDoubles({
			profileResult: false,
		});

		expect(result).toBe(false);
		expect(events).toContainEqual({ type: "helper", name: "paseo-profiles" });
		expect(events.at(-1)).toEqual({
			type: "error",
			message:
				"Debian Server setup finished, but the Paseo orchestration policy was not synced.",
		});
	});

	it("runs Hermes relay after Paseo profiles and propagates an incomplete setup", () => {
		const { events, result } = runDefaultSetupWithSafeDoubles({
			relayResult: false,
		});
		const helpers = events
			.filter(({ type }) => type === "helper")
			.map(({ name }) => name);

		expect(result).toBe(false);
		expect(helpers.indexOf("paseo-profiles")).toBeLessThan(
			helpers.indexOf("hermes-relay"),
		);
		expect(events.at(-1)).toEqual({
			type: "error",
			message:
				"Debian Server setup finished, but the Hermes relay is incomplete.",
		});
	});
});
