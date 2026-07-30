import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	commandExists,
	copyDirRecursive,
	promptUser,
	readConfiguredDeviceType,
	readDeviceType,
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

	it("runCommand runs a plain (non-shell) command", async () => {
		const result = await runCommand("true", { check: false });
		expect(result).toBe(true);
	});

	it("runCommand fails when an EARLY pipeline stage fails (pipefail)", async () => {
		// POSIX sh would report only `cat`'s exit (0); pipefail must surface
		// the failing `false`.
		const result = await runCommand("false | cat", { check: false });
		expect(result).toBe(false);
	});

	it("runCommand succeeds when every pipeline stage succeeds", async () => {
		const result = await runCommand("echo ok | cat", { check: false });
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

	it("returns true and the new content lands when overwriting differing dest", () => {
		const src = path.join(tmpDir, "new.conf");
		const dest = path.join(tmpDir, "live.conf");
		fs.writeFileSync(src, "new content");
		fs.writeFileSync(dest, "previous content");

		const result = safeCopyFile(src, dest);

		expect(result).toBe(true);
		expect(fs.readFileSync(dest, "utf-8")).toBe("new content");
	});

	it("returns true when dest does not pre-exist", () => {
		const src = path.join(tmpDir, "new.conf");
		const dest = path.join(tmpDir, "fresh.conf");
		fs.writeFileSync(src, "new content");

		expect(safeCopyFile(src, dest)).toBe(true);
	});

	it("no-ops (no .bak, returns false) when dest already matches src", () => {
		const src = path.join(tmpDir, "new.conf");
		const dest = path.join(tmpDir, "live.conf");
		fs.writeFileSync(src, "identical content");
		fs.writeFileSync(dest, "identical content");

		const result = safeCopyFile(src, dest);

		expect(result).toBe(false);
		expect(fs.readFileSync(dest, "utf-8")).toBe("identical content");
		expect(fs.existsSync(`${dest}.bak`)).toBe(false);
	});

	it("a second run preserves the user's ORIGINAL content in .bak", () => {
		const src = path.join(tmpDir, "new.conf");
		const dest = path.join(tmpDir, "live.conf");
		fs.writeFileSync(src, "managed content");
		fs.writeFileSync(dest, "user original content");

		// First run: backs up the user's original, installs managed content.
		expect(safeCopyFile(src, dest)).toBe(true);
		expect(fs.readFileSync(`${dest}.bak`, "utf-8")).toBe(
			"user original content",
		);

		// Second run: dest now equals src → must be a no-op and must NOT
		// clobber the .bak with the previously-synced managed content.
		expect(safeCopyFile(src, dest)).toBe(false);
		expect(fs.readFileSync(`${dest}.bak`, "utf-8")).toBe(
			"user original content",
		);
	});

	it("keeps the user's original retrievable across changed bundle deploys", () => {
		const src = path.join(tmpDir, "new.conf");
		const dest = path.join(tmpDir, "live.conf");
		fs.writeFileSync(dest, "user original content");

		for (const bundle of ["bundle v1", "bundle v2"]) {
			fs.writeFileSync(src, bundle);
			safeCopyFile(src, dest);
		}

		const recoverableContents = [dest, `${dest}.bak`, `${dest}.orig`]
			.filter((candidate) => fs.existsSync(candidate))
			.map((candidate) => fs.readFileSync(candidate, "utf-8"));
		expect(recoverableContents).toContain("user original content");
	});

	it("captures the live file when migrating an install with an existing .bak", () => {
		const src = path.join(tmpDir, "new.conf");
		const dest = path.join(tmpDir, "live.conf");
		fs.writeFileSync(src, "bundle v2");
		fs.writeFileSync(dest, "[includeIf \"gitdir:~/work/\"]");
		fs.writeFileSync(`${dest}.bak`, "old managed bundle");

		safeCopyFile(src, dest);

		expect(fs.existsSync(`${dest}.orig`)).toBe(true);
		expect(fs.readFileSync(`${dest}.orig`, "utf-8")).toBe(
			"[includeIf \"gitdir:~/work/\"]",
		);
	});

	it("captures the live file when the pre-existing .bak is zero bytes", () => {
		const src = path.join(tmpDir, "new.conf");
		const dest = path.join(tmpDir, "live.conf");
		fs.writeFileSync(src, "bundle v2");
		fs.writeFileSync(dest, "live user content");
		fs.writeFileSync(`${dest}.bak`, "");

		safeCopyFile(src, dest);

		expect(fs.readFileSync(`${dest}.orig`, "utf-8")).toBe("live user content");
		expect(fs.readFileSync(`${dest}.bak`, "utf-8")).toBe("live user content");
	});

	it("keeps a hand-edit recoverable when the next bundle is deployed", () => {
		const src = path.join(tmpDir, "new.conf");
		const dest = path.join(tmpDir, "live.conf");
		fs.writeFileSync(src, "bundle v1");
		fs.writeFileSync(dest, "user original content");
		safeCopyFile(src, dest);

		fs.writeFileSync(dest, "user hand-edit after v1");
		fs.writeFileSync(src, "bundle v2");
		safeCopyFile(src, dest);

		expect(fs.readFileSync(`${dest}.orig`, "utf-8")).toBe(
			"user original content",
		);
		expect(fs.readFileSync(`${dest}.bak`, "utf-8")).toBe(
			"user hand-edit after v1",
		);
	});

	it("keeps the first capture while rolling .bak through a bundle revert", () => {
		const src = path.join(tmpDir, "new.conf");
		const dest = path.join(tmpDir, "live.conf");
		fs.writeFileSync(dest, "user original content");

		for (const bundle of ["bundle v1", "bundle v2", "bundle v1"]) {
			fs.writeFileSync(src, bundle);
			safeCopyFile(src, dest);
		}

		expect(fs.readFileSync(dest, "utf-8")).toBe("bundle v1");
		expect(fs.readFileSync(`${dest}.bak`, "utf-8")).toBe("bundle v2");
		expect(fs.readFileSync(`${dest}.orig`, "utf-8")).toBe(
			"user original content",
		);
	});
});

describe("copyDirRecursive symlink handling", () => {
	let tmpDir;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-copydir-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("recreates file and dir symlinks instead of dereferencing/crashing", () => {
		const src = path.join(tmpDir, "src");
		const dest = path.join(tmpDir, "dest");

		// Real file + real dir.
		fs.mkdirSync(path.join(src, "realdir"), { recursive: true });
		fs.writeFileSync(path.join(src, "realfile.txt"), "hello");
		fs.writeFileSync(path.join(src, "realdir", "nested.txt"), "nested");

		// A symlink to the file and a symlink to the dir.
		fs.symlinkSync("realfile.txt", path.join(src, "filelink"));
		fs.symlinkSync("realdir", path.join(src, "dirlink"));

		copyDirRecursive(src, dest);

		// Real entries copied as files/dirs.
		expect(fs.readFileSync(path.join(dest, "realfile.txt"), "utf-8")).toBe(
			"hello",
		);
		expect(
			fs.readFileSync(path.join(dest, "realdir", "nested.txt"), "utf-8"),
		).toBe("nested");

		// File symlink recreated as a symlink (not dereferenced).
		expect(fs.lstatSync(path.join(dest, "filelink")).isSymbolicLink()).toBe(
			true,
		);
		expect(fs.readlinkSync(path.join(dest, "filelink"))).toBe("realfile.txt");

		// Dir symlink recreated as a symlink (would have crashed with EISDIR
		// under copyFileSync before).
		expect(fs.lstatSync(path.join(dest, "dirlink")).isSymbolicLink()).toBe(
			true,
		);
		expect(fs.readlinkSync(path.join(dest, "dirlink"))).toBe("realdir");
	});

	it("replaces an existing destination symlink on a re-run", () => {
		const src = path.join(tmpDir, "src");
		const dest = path.join(tmpDir, "dest");
		fs.mkdirSync(src, { recursive: true });
		fs.writeFileSync(path.join(src, "target.txt"), "x");
		fs.symlinkSync("target.txt", path.join(src, "link"));

		copyDirRecursive(src, dest);
		// Re-run over an already-populated dest must not throw (EEXIST).
		copyDirRecursive(src, dest);

		expect(fs.readlinkSync(path.join(dest, "link"))).toBe("target.txt");
	});
});

describe("promptUser cancellation", () => {
	it("returns the resolved value for a normal yes answer", async () => {
		const value = await promptUser("Proceed?", false, {
			promptFn: async () => ({ value: true }),
		});
		expect(value).toBe(true);
	});

	it("returns the resolved value for a normal no answer", async () => {
		const value = await promptUser("Proceed?", true, {
			promptFn: async () => ({ value: false }),
		});
		expect(value).toBe(false);
	});

	it("aborts with exit(130) when the prompt is cancelled (Ctrl+C)", async () => {
		const exitCalls = [];
		// Simulate prompts' cancel path: the injected promptFn invokes the
		// onCancel handler it was given, exactly like the real lib on Ctrl+C.
		const promptFn = async (_question, opts) => {
			await opts.onCancel();
			return {};
		};
		await promptUser("Destructive?", false, {
			promptFn,
			exit: (code) => {
				exitCalls.push(code);
			},
		});
		expect(exitCalls).toEqual([130]);
	});
});

describe("readDeviceType", () => {
	let tmpHome;

	beforeEach(() => {
		tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-utils-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	it("returns 'pc' when ~/.haoshoku.json is missing", () => {
		expect(readDeviceType(tmpHome)).toBe("pc");
	});

	it("returns 'laptop' when deviceType is 'laptop'", () => {
		fs.writeFileSync(
			path.join(tmpHome, ".haoshoku.json"),
			JSON.stringify({ deviceType: "laptop" }),
		);
		expect(readDeviceType(tmpHome)).toBe("laptop");
	});

	it("returns 'pc' when ~/.haoshoku.json contains malformed JSON", () => {
		fs.writeFileSync(path.join(tmpHome, ".haoshoku.json"), "{ not valid json");
		expect(readDeviceType(tmpHome)).toBe("pc");
	});

	it("returns 'pc' when deviceType is an unknown value", () => {
		fs.writeFileSync(
			path.join(tmpHome, ".haoshoku.json"),
			JSON.stringify({ deviceType: "server" }),
		);
		expect(readDeviceType(tmpHome)).toBe("pc");
	});
});

describe("readConfiguredDeviceType", () => {
	let tmpHome;

	beforeEach(() => {
		tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-utils-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	it("returns null when ~/.haoshoku.json is missing", () => {
		expect(readConfiguredDeviceType(tmpHome)).toBeNull();
	});

	it("returns known explicit deviceType values", () => {
		fs.writeFileSync(
			path.join(tmpHome, ".haoshoku.json"),
			JSON.stringify({ deviceType: "pc" }),
		);
		expect(readConfiguredDeviceType(tmpHome)).toBe("pc");
	});

	it("returns null for malformed or unknown deviceType values", () => {
		fs.writeFileSync(path.join(tmpHome, ".haoshoku.json"), "{ not valid json");
		expect(readConfiguredDeviceType(tmpHome)).toBeNull();

		fs.writeFileSync(
			path.join(tmpHome, ".haoshoku.json"),
			JSON.stringify({ deviceType: "other" }),
		);
		expect(readConfiguredDeviceType(tmpHome)).toBeNull();
	});

	it("warns when ~/.haoshoku.json contains malformed JSON", () => {
		fs.writeFileSync(path.join(tmpHome, ".haoshoku.json"), "{ not valid json");
		const messages = [];
		const originalLog = console.log;
		console.log = (...args) => messages.push(args.join(" "));
		try {
			expect(readConfiguredDeviceType(tmpHome)).toBeNull();
		} finally {
			console.log = originalLog;
		}

		expect(messages.join("\n")).toMatch(/Malformed .*\.haoshoku\.json/i);
	});
});
