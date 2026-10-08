import { afterEach, beforeEach, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const cli = path.resolve(import.meta.dir, "..", "haoshoku.js");
let scratch;
let home;
let env;

beforeEach(() => {
	scratch = fs.mkdtempSync(path.join(os.tmpdir(), "agent-accounts-"));
	home = path.join(scratch, "home");
	fs.mkdirSync(home, { mode: 0o700 });
	env = {
		...process.env,
		HOME: home,
		CLAUDE_CONFIG_DIR: undefined,
		CODEX_HOME: "",
		XDG_STATE_HOME: path.join(scratch, "state"),
		BUN_RUNTIME_TRANSPILER_CACHE_PATH: path.join(scratch, "bun-cache"),
	};
});

afterEach(() => fs.rmSync(scratch, { recursive: true }));

function seed(name, bytes = "fixture\n") {
	const file = path.join(home, name);
	fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	fs.writeFileSync(file, bytes, { mode: 0o600 });
	return file;
}

function run(args = ["--agent-accounts"]) {
	const child = Bun.spawnSync([process.execPath, cli, ...args], { env });
	return {
		code: child.exitCode,
		output: child.stdout.toString() + child.stderr.toString(),
	};
}

it("creates credential overlays sharing all other top-level entries", () => {
	const privateEntries = {
		".claude": [
			".credentials.json",
			".claude.json",
			"history.jsonl",
			"sessions",
			"session-env",
			"shell-snapshots",
			"cache",
			"backups",
			"security",
			"mcp-needs-auth-cache.json",
			".last-cleanup",
		],
		".codex": ["auth.json", "models_cache.json", "log", "memories", "tmp"],
	};
	for (const [primary, names] of Object.entries(privateEntries)) {
		for (const name of names) seed(`${primary}/${name}`);
	}
	const shared = {
		".claude": [
			"CLAUDE.md",
			"settings.json",
			"projects/session",
			"skills/example",
			".git/config",
		],
		".codex": [
			"AGENTS.md",
			"history.jsonl",
			"sessions/session",
			"state.sqlite",
			"state.sqlite-wal",
			"state.sqlite-shm",
			"future-state",
		],
	};
	for (const [primary, names] of Object.entries(shared)) {
		for (const name of names) seed(`${primary}/${name}`);
	}
	const config = '# primary settings\nmodel = "fixture-model"\n';
	seed(".codex/config.toml", config);
	seed(".claude.json", '{"primary":true}\n');
	const result = run();
	expect(result.code, result.output).toBe(0);
	for (const [primary, names] of Object.entries(shared)) {
		for (const name of new Set(names.map((entry) => entry.split("/")[0]))) {
			const dest = path.join(home, `${primary}-alt`, name);
			expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
			expect(fs.realpathSync(dest)).toBe(
				fs.realpathSync(path.join(home, primary, name)),
			);
		}
	}
	for (const [primary, names] of Object.entries(privateEntries)) {
		for (const name of names) {
			expect(fs.existsSync(path.join(home, `${primary}-alt`, name))).toBe(
				false,
			);
			expect(fs.readFileSync(path.join(home, primary, name), "utf8")).toBe(
				"fixture\n",
			);
		}
	}
	const altConfig = path.join(home, ".codex-alt/config.toml");
	expect(fs.lstatSync(altConfig).isFile()).toBe(true);
	expect(fs.readFileSync(altConfig, "utf8")).toBe(config);
	expect(fs.statSync(altConfig).mode & 0o777).toBe(0o600);
	seed(".claude-alt/.credentials.json", "alt-claude-auth\n");
	seed(".codex-alt/auth.json", "alt-codex-auth\n");
	seed(".codex/config.toml", '# changed primary\nmodel = "new-model"\n');
	const before = fs.statSync(altConfig);
	expect(run().code).toBe(0);
	expect(fs.readFileSync(altConfig, "utf8")).toBe(config);
	expect(fs.statSync(altConfig).ino).toBe(before.ino);
	expect(fs.statSync(altConfig).mtimeMs).toBe(before.mtimeMs);
	for (const [name, bytes] of [
		[".claude-alt/.credentials.json", "alt-claude-auth\n"],
		[".codex-alt/auth.json", "alt-codex-auth\n"],
	]) {
		expect(fs.lstatSync(path.join(home, name)).isSymbolicLink()).toBe(false);
		expect(fs.readFileSync(path.join(home, name), "utf8")).toBe(bytes);
	}
});

it("provides an independent Codex config accepted by executor client setup", () => {
	seed(".claude/CLAUDE.md");
	const primaryConfig = '# preserved\nmodel = "fixture"\n';
	seed(".codex/config.toml", primaryConfig);
	expect(run().code).toBe(0);
	env.CLAUDE_CONFIG_DIR = path.join(home, ".claude-alt");
	env.CODEX_HOME = path.join(home, ".codex-alt");
	env.EXECUTOR_AUTHORIZATION = "Bearer disposable-fixture";
	const result = run([
		"--executor-clients",
		"https://executor.example.test/mcp",
	]);
	expect(result.code, result.output).toBe(0);
	expect(
		Bun.TOML.parse(
			fs.readFileSync(path.join(env.CODEX_HOME, "config.toml"), "utf8"),
		).mcp_servers.executor.url,
	).toBe("https://executor.example.test/mcp");
	expect(
		JSON.parse(
			fs.readFileSync(path.join(env.CLAUDE_CONFIG_DIR, ".claude.json"), "utf8"),
		).mcpServers.executor.url,
	).toBe("https://executor.example.test/mcp");
	expect(fs.readFileSync(path.join(home, ".codex/config.toml"), "utf8")).toBe(
		primaryConfig,
	);
	expect(fs.existsSync(path.join(home, ".claude/.claude.json"))).toBe(false);
});

it("preserves and reports shared-entry conflicts while keeping correct links", () => {
	for (const entry of [
		"real-file",
		"real-dir",
		"wrong",
		"dangling",
		"correct",
		"relative",
	]) {
		seed(`.claude/${entry}`, "primary bytes\n");
	}
	seed(".codex/config.toml", 'model = "primary"\n');
	seed(".codex-alt/config.toml", 'model = "alt"\n');
	seed(".claude-alt/real-file", "alt file\n");
	seed(".claude-alt/real-dir/local", "alt dir\n");
	seed("unrelated", "unrelated bytes\n");
	for (const [name, target] of [
		["wrong", path.join(home, "unrelated")],
		["dangling", path.join(home, "absent")],
		["correct", path.join(home, ".claude/correct")],
		["relative", "../.claude/relative"],
	])
		fs.symlinkSync(target, path.join(home, ".claude-alt", name));
	const before = Object.fromEntries(
		["wrong", "dangling", "correct", "relative"].map((name) => [
			name,
			fs.lstatSync(path.join(home, ".claude-alt", name)).ino,
		]),
	);
	for (let n = 0; n < 2; n++) {
		const result = run();
		expect(result.code).toBe(1);
		expect(result.output).toContain("incomplete");
		for (const name of ["real-file", "real-dir", "wrong", "dangling"]) {
			expect(result.output).toContain(path.join(home, ".claude-alt", name));
		}
		for (const [name, inode] of Object.entries(before)) {
			expect(fs.lstatSync(path.join(home, ".claude-alt", name)).ino).toBe(
				inode,
			);
		}
		expect(
			fs.readFileSync(path.join(home, ".claude-alt/real-file"), "utf8"),
		).toBe("alt file\n");
		expect(
			fs.readFileSync(path.join(home, ".claude-alt/real-dir/local"), "utf8"),
		).toBe("alt dir\n");
		expect(
			fs.readFileSync(path.join(home, ".codex-alt/config.toml"), "utf8"),
		).toBe('model = "alt"\n');
	}
});

it("reports every private symlink without altering it, even absent from the primary", () => {
	seed(".claude/CLAUDE.md");
	seed(".codex/AGENTS.md");
	const secret = "disposable-secret-contents\n";
	const target = seed("unrelated-auth", secret);
	const entries = [
		...[
			".credentials.json",
			".claude.json",
			"history.jsonl",
			"sessions",
			"session-env",
			"shell-snapshots",
			"cache",
			"backups",
			"security",
			"mcp-needs-auth-cache.json",
			".last-cleanup",
		].map((name) => `.claude-alt/${name}`),
		...[
			"auth.json",
			"config.toml",
			"models_cache.json",
			"log",
			"memories",
			"tmp",
		].map((name) => `.codex-alt/${name}`),
	];
	for (const alt of [".claude-alt", ".codex-alt"])
		fs.mkdirSync(path.join(home, alt));
	for (const entry of entries) fs.symlinkSync(target, path.join(home, entry));
	const result = run();
	expect(result.code).toBe(1);
	expect(result.output).toContain("incomplete");
	for (const entry of entries) {
		expect(result.output).toContain(path.join(home, entry));
		expect(fs.readlinkSync(path.join(home, entry))).toBe(target);
	}
	expect(fs.readFileSync(target, "utf8")).toBe(secret);
	expect(result.output).not.toContain(secret.trim());
});

it("skips missing primary homes with a message and creates no alt homes", () => {
	const result = run();
	expect(result.code, result.output).toBe(0);
	for (const primary of [".claude", ".codex"]) {
		expect(result.output).toContain(path.join(home, primary));
		expect(result.output).toContain("skipped");
		expect(fs.existsSync(path.join(home, `${primary}-alt`))).toBe(false);
	}
});

it("refuses an alt home that aliases the primary directory", () => {
	seed(".claude/CLAUDE.md");
	seed(".codex/config.toml", 'model = "fixture"\n');
	fs.symlinkSync(path.join(home, ".claude"), path.join(home, ".claude-alt"));
	const result = run();
	expect(result.code).toBe(1);
	expect(result.output).toContain("incomplete");
	expect(result.output).toContain(path.join(home, ".claude-alt"));
	expect(fs.lstatSync(path.join(home, ".claude/CLAUDE.md")).isFile()).toBe(
		true,
	);
	expect(fs.readlinkSync(path.join(home, ".claude-alt"))).toBe(
		path.join(home, ".claude"),
	);
});

it("rejects combining agent accounts with another one-shot mode", () => {
	seed(".claude/CLAUDE.md");
	const result = run(["--agent-accounts", "--agents"]);
	expect(result.code).toBe(2);
	expect(result.output).toContain("mutually exclusive");
	expect(fs.existsSync(path.join(home, ".claude-alt"))).toBe(false);
});
