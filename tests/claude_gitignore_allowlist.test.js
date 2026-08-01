import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const GITIGNORE_TEMPLATE = path.join(
	PROJECT_ROOT,
	"configs",
	"claude",
	"gitignore.template",
);

describe("Claude first-capture gitignore allowlist", () => {
	let tmpDir;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "haoshoku-claude-gitignore-test-"),
		);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("keeps first captures visible to git", () => {
		fs.copyFileSync(GITIGNORE_TEMPLATE, path.join(tmpDir, ".gitignore"));
		fs.writeFileSync(
			path.join(tmpDir, "test.haoshoku-first-capture"),
			"user content",
		);

		const init = Bun.spawnSync(["git", "init", "--quiet"], { cwd: tmpDir });
		expect(init.exitCode).toBe(0);

		const checkIgnore = Bun.spawnSync(
			[
				"git",
				"check-ignore",
				"--quiet",
				"--",
				"test.haoshoku-first-capture",
			],
			{ cwd: tmpDir },
		);

		expect(checkIgnore.exitCode).toBe(1);
	});
});
