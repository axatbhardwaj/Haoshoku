import { afterAll, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Run before helpers capture homedir(), even when a test forgets a stub.
const fixtureHome = fs.mkdtempSync(
	path.join(os.tmpdir(), "haoshoku-test-home-"),
);
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
