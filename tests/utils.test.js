import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	commandExists,
	runCommand,
	safeCopyFile,
} from "../src/common/utils.js";

describe("Utils", () => {
	it("commandExists returns true for existing command", async () => {
		// We assume 'ls' exists on linux/unix
		const exists = await commandExists("ls");
		expect(exists).toBe(true);
	});

	it("commandExists returns false for non-existing command", async () => {
		const exists = await commandExists("nonexistentcommand_12345");
		expect(exists).toBe(false);
	});

	// Note: runCommand is hard to test directly without mocking spawn,
	// but Bun's test runner can't easily mock native modules like 'bun' import yet in the same way jest does.
	// However, we can test that it runs a simple echo command.
	it("runCommand executes successfully", async () => {
		const result = await runCommand("echo 'test'", { check: false });
		expect(result).toBe(true);
	});
});

describe("safeCopyFile", () => {
	let tmpDir;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("preserves existing dest as <dest>.bak before overwriting", () => {
		const src = path.join(tmpDir, "new.conf");
		const dest = path.join(tmpDir, "live.conf");
		fs.writeFileSync(src, "new content");
		fs.writeFileSync(dest, "previous content");

		safeCopyFile(src, dest);

		expect(fs.readFileSync(dest, "utf-8")).toBe("new content");
		expect(fs.readFileSync(`${dest}.bak`, "utf-8")).toBe("previous content");
	});

	it("does not create a .bak when dest does not pre-exist", () => {
		const src = path.join(tmpDir, "new.conf");
		const dest = path.join(tmpDir, "fresh.conf");
		fs.writeFileSync(src, "new content");

		safeCopyFile(src, dest);

		expect(fs.readFileSync(dest, "utf-8")).toBe("new content");
		expect(fs.existsSync(`${dest}.bak`)).toBe(false);
	});

	it("rolls the backup — overwrites a prior .bak with the latest dest", () => {
		const src = path.join(tmpDir, "new.conf");
		const dest = path.join(tmpDir, "live.conf");
		fs.writeFileSync(src, "v3");
		fs.writeFileSync(dest, "v2");
		fs.writeFileSync(`${dest}.bak`, "v1-old-stale-backup");

		safeCopyFile(src, dest);

		expect(fs.readFileSync(dest, "utf-8")).toBe("v3");
		expect(fs.readFileSync(`${dest}.bak`, "utf-8")).toBe("v2");
	});
});
