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

function runDefaultSetupWithSafeDoubles() {
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
			log: { dim() {}, error() {}, info() {}, success() {}, warning() {} },
			promptUser: async (message, initial) => {
				events.push({ type: "prompt", message, initial });
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
			configureClaude: record("claude"),
		}));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_gh_stack.js"))}, () => ({ installGhStack: record("gh-stack") }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_claude_stay_awake.js"))}, () => ({ configureClaudeStayAwake: record("stay-awake") }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_claude_remote_control.js"))}, () => ({ configureClaudeRemoteControl: record("remote-control") }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_pr_watch.js"))}, () => ({ configurePrWatch: record("pr-watch") }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_worktree_cleanup.js"))}, () => ({ syncWorktreeCleanup: record("worktree-cleanup") }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_codex.js"))}, () => ({ configureCodex: record("codex") }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_skills.js"))}, () => ({ configureSkills: record("skills", true) }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_t3_code_server.js"))}, () => ({ configureT3CodeServer: record("t3-code-server", true) }));
		mock.module(${JSON.stringify(modulePath("src/helpers/configure_tailscale.js"))}, () => ({ configureTailscale: record("tailscale") }));
		const { runDebianServerSetup } = await import(${JSON.stringify(debianModule)} + "?default-path-test");
		await runDebianServerSetup();
		console.log("DEBIAN_EVENTS=" + JSON.stringify(events));
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
		return JSON.parse(encodedEvents);
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
		const events = runDefaultSetupWithSafeDoubles();
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
		expect(helpers).toEqual([
			"tailscale",
			"t3-code-server",
			"git",
			"claude",
			"gh-stack",
			"stay-awake",
			"remote-control",
			"pr-watch",
			"worktree-cleanup",
			"codex",
			"skills",
		]);
	});
});
