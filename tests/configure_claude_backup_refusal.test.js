import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { backupClaudeConfig } from "../src/helpers/configure_claude.js";

describe("backupClaudeConfig() refuses absolute home paths", () => {
	let tmpDir;
	let configsDir;
	let claudeHome;
	let liveUnsafePath;
	let bundledUnsafePath;
	let bundledUnsafeBefore;
	let bundledCleanPath;
	let warnings;
	let warningOriginal;
	let result;

	beforeEach(async () => {
		tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "haoshoku-claude-refusal-"),
		);
		configsDir = path.join(tmpDir, "configs", "claude");
		claudeHome = path.join(tmpDir, "claude-home");
		const liveAgentsDir = path.join(claudeHome, ".claude", "agents");
		const bundledAgentsDir = path.join(configsDir, "agents");
		liveUnsafePath = path.join(liveAgentsDir, "unsafe-agent.md");
		bundledUnsafePath = path.join(bundledAgentsDir, "unsafe-agent.md");
		bundledCleanPath = path.join(bundledAgentsDir, "clean-agent.md");
		bundledUnsafeBefore = Buffer.from("# Sanitised\nrepo=/path/to/repo\n");

		fs.mkdirSync(liveAgentsDir, { recursive: true });
		fs.mkdirSync(bundledAgentsDir, { recursive: true });
		fs.writeFileSync(
			liveUnsafePath,
			"# Private\nrepo=/home/xzat/private/repo\n",
		);
		fs.writeFileSync(path.join(liveAgentsDir, "clean-agent.md"), "clean live\n");
		fs.writeFileSync(bundledUnsafePath, bundledUnsafeBefore);
		fs.writeFileSync(bundledCleanPath, "clean bundled\n");

		warnings = [];
		const utils = require("../src/common/utils.js");
		warningOriginal = utils.log.warning;
		utils.log.warning = (message) => warnings.push(message);

		result = await backupClaudeConfig({ srcDir: configsDir, claudeHome });
	});

	afterEach(() => {
		const utils = require("../src/common/utils.js");
		utils.log.warning = warningOriginal;
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("preserves the sanitised bundle bytes while copying a clean sibling in the same run", () => {
		expect(fs.readFileSync(bundledCleanPath, "utf-8")).toBe("clean live\n");
		expect(fs.readFileSync(bundledUnsafePath)).toEqual(bundledUnsafeBefore);
	});

	it("warns with the refused source file and offending path line", () => {
		const warning = warnings.join("\n");
		expect(warning).toContain(liveUnsafePath);
		expect(warning).toContain("/home/xzat/private/repo");
		expect(warning).toContain("line 2");
	});

	it("returns copied and refused file counts", () => {
		expect(result).toEqual({ backedUp: 1, refused: 1 });
	});
});
