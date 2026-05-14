import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { syncSkills } from "../src/helpers/skill_manager.js";

describe("syncSkills()", () => {
	let tmpDir;
	let configPath;
	let cacheDir;
	let exitSpy;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-skill-"));
		configPath = path.join(tmpDir, ".haoshoku.json");
		cacheDir = path.join(tmpDir, "cache");
		// Trap process.exit so a buggy syncSkills can't kill the test runner.
		exitSpy = spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`__unexpected_exit_${code}__`);
		});
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		exitSpy.mockRestore();
	});

	it("returns no-sources status when skillSources is empty (no exit)", () => {
		fs.writeFileSync(configPath, JSON.stringify({ skillSources: [] }));

		const result = syncSkills({ configPath, cacheDir });

		expect(result).toEqual({ status: "no-sources", merged: 0 });
		expect(exitSpy).not.toHaveBeenCalled();
	});

	it("returns all-failed when every configured source is unreachable (no exit)", () => {
		// "not-a-valid-url" fails URL parsing in cloneOrPullRepo before any git call,
		// keeping the test offline and fast.
		fs.writeFileSync(
			configPath,
			JSON.stringify({ skillSources: ["not-a-valid-url"] }),
		);

		const result = syncSkills({ configPath, cacheDir });

		expect(result).toEqual({ status: "all-failed", merged: 0 });
		expect(exitSpy).not.toHaveBeenCalled();
	});
});
