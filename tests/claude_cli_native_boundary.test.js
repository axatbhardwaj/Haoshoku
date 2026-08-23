import { expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const decoder = new TextDecoder();
const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const CLI_PATH = path.join(PROJECT_ROOT, "haoshoku.js");
const CLAUDE_HELPER_PATH = path.join(
	PROJECT_ROOT,
	"src",
	"helpers",
	"configure_claude.js",
);
const SKILLS_HELPER_PATH = path.join(
	PROJECT_ROOT,
	"src",
	"helpers",
	"configure_skills.js",
);
const CLI_UTILS_PATH = path.join(PROJECT_ROOT, "src", "common", "cli_utils.js");
const ARCH_SETUP_PATH = path.join(
	PROJECT_ROOT,
	"src",
	"os_scripts",
	"cachyos.js",
);

function runCli(args, { defaultSetup = false } = {}) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-native-cli-"));
	const setupMocks = defaultSetup
		? `
			mock.module("prompts", () => ({ default: async () => ({ value: true }) }));
			mock.module(${JSON.stringify(CLI_UTILS_PATH)}, () => ({
				detectOS: () => "arch",
				findActiveModeFlags: () => [],
			}));
			mock.module(${JSON.stringify(ARCH_SETUP_PATH)}, () => ({
				runCachyOSSetup: async () => {
					calls.push("setup");
					return true;
				},
			}));
			Object.defineProperty(process.stdin, "isTTY", { value: true });
		`
		: "";
	const script = `
		import { mock } from "bun:test";
		const calls = [];
		${setupMocks}
		mock.module(${JSON.stringify(CLAUDE_HELPER_PATH)}, () => ({
			backupClaudeConfig: async () => {},
			configureClaude: async () => {},
			syncClaudeConfig: async () => calls.push("claude"),
		}));
		mock.module(${JSON.stringify(SKILLS_HELPER_PATH)}, () => ({
			configureSkills: async () => {
				calls.push("skills");
				return true;
			},
			listSkills: async () => true,
		}));
		process.argv = [process.execPath, ${JSON.stringify(CLI_PATH)}, ...${JSON.stringify(args)}];
		await import(${JSON.stringify(CLI_PATH)});
		const expected = ${JSON.stringify(defaultSetup ? "setup" : "claude")};
		const deadline = Date.now() + 3000;
		while (!calls.includes(expected)) {
			if (Date.now() >= deadline) throw new Error("timed out waiting for " + expected);
			await Bun.sleep(10);
		}
		await Bun.sleep(${defaultSetup ? 450 : 50});
		console.log("NATIVE_CALLS=" + JSON.stringify(calls));
	`;

	try {
		const child = Bun.spawnSync(
			["timeout", "5", process.execPath, "--eval", script],
			{
				env: { ...process.env, HOME: home, TMPDIR: home },
				stderr: "pipe",
				stdin: "ignore",
				stdout: "pipe",
			},
		);
		const output = `${decoder.decode(child.stdout)}\n${decoder.decode(child.stderr)}`;
		expect(child.exitCode, output).toBe(0);
		const encoded = output.match(/NATIVE_CALLS=(.*)/)?.[1];
		expect(encoded, output).toBeDefined();
		return JSON.parse(encoded);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
}

it("keeps --claude on the portable baseline even when the skill cache is absent", () => {
	expect(runCli(["--claude"])).toEqual(["claude"]);
});

it("keeps --claude-update on the portable baseline", () => {
	expect(runCli(["--claude-update"])).toEqual(["claude"]);
});

it("does not add external skills implicitly after a full setup", () => {
	expect(runCli([], { defaultSetup: true })).toEqual(["setup"]);
});

it("keeps the retained statusline free of the retired cross-engine rescue agent", () => {
	const statusline = fs.readFileSync(
		path.join(PROJECT_ROOT, "configs", "claude", "statusline-command.sh"),
		"utf8",
	);
	expect(statusline).not.toContain(["codex", "rescue"].join("-"));
});
