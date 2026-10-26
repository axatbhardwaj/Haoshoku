import { afterAll, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Run before helpers capture homedir(), even when a test forgets a stub.
const fixtureHome = fs.mkdtempSync(
	path.join(os.tmpdir(), "haoshoku-test-home-"),
);
// Block accidental uploads in every test and inherited subprocess. Tests with
// specific CLI behavior can still prepend their own fixture bin directory.
const guardBin = path.join(fixtureHome, "bin");
const cliCalls = path.join(fixtureHome, "external-cli-calls.jsonl");
fs.mkdirSync(guardBin);
fs.writeFileSync(cliCalls, "");
for (const command of ["tailscale", "gh"]) {
	fs.writeFileSync(
		path.join(guardBin, command),
		`#!${process.execPath}
import fs from "node:fs";
fs.appendFileSync(${JSON.stringify(cliCalls)}, JSON.stringify([${JSON.stringify(command)}, ...process.argv.slice(2)]) + "\\n");
process.exit(1);
`,
		{ mode: 0o755 },
	);
}
process.env.PATH = `${guardBin}${path.delimiter}${process.env.PATH ?? ""}`;
process.env.HAOSHOKU_TEST_CLI_CALLS = cliCalls;
// Bun can retain its startup PATH when env/PATH is omitted. Make its default
// lookups use the guarded environment, while preserving explicit test fixtures.
for (const name of ["spawn", "spawnSync"]) {
	const spawn = Bun[name];
	Bun[name] = (command, options) =>
		Array.isArray(command)
			? spawn(command, { ...options, env: options?.env ?? process.env })
			: spawn({ ...command, env: command.env ?? process.env });
}
const which = Bun.which;
Bun.which = (command, options) =>
	which(command, { PATH: process.env.PATH, ...options });
process.env.HOME = fixtureHome;
// Bun caches os.homedir() at process start; changing HOME alone is insufficient.
mock.module("node:os", () => ({
	...os,
	homedir: () => fixtureHome,
	default: { ...os, homedir: () => fixtureHome },
}));
for (const [key, directory] of [
	["XDG_CONFIG_HOME", ".config"],
	["XDG_STATE_HOME", ".local/state"],
	["XDG_CACHE_HOME", ".cache"],
]) {
	process.env[key] = path.join(fixtureHome, directory);
}
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.CODEX_HOME;

afterAll(() => fs.rmSync(fixtureHome, { recursive: true }));
