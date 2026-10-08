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
