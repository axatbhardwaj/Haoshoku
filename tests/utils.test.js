import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	commandExists,
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
