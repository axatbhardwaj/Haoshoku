import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { backupClaudeConfig } from "../src/helpers/configure_claude.js";

describe("backupClaudeConfig() guards PERSONAL_FILES", () => {
	let tmpDir;
	let configsDir;
	let claudeHome;
	let liveClaudeMdPath;
	let bundledClaudeMdPath;
	let bundledClaudeMdBefore;
	let bundledStatuslinePath;
	let bundledPolicyPath;
	let bundledPolicyBefore;
	let warnings;
	let warningOriginal;
	let result;

	beforeEach(async () => {
		tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "haoshoku-claude-refusal-"),
		);
		configsDir = path.join(tmpDir, "configs", "claude");
		claudeHome = path.join(tmpDir, "claude-home");
		const liveClaudeDir = path.join(claudeHome, ".claude");
		liveClaudeMdPath = path.join(liveClaudeDir, "CLAUDE.md");
		bundledClaudeMdPath = path.join(configsDir, "CLAUDE.md");
		bundledStatuslinePath = path.join(configsDir, "statusline-command.sh");
		bundledPolicyPath = path.join(configsDir, "agents", "policy.md");
		bundledClaudeMdBefore = Buffer.from("# Sanitised\nrepo=/path/to/repo\n");
		bundledPolicyBefore = Buffer.from("bundled policy\n");

		fs.mkdirSync(path.join(liveClaudeDir, "agents"), { recursive: true });
		fs.mkdirSync(path.join(configsDir, "agents"), { recursive: true });
		fs.writeFileSync(
			liveClaudeMdPath,
			"# Private\nrepo=/home/xzat/private/repo\n",
		);
		fs.writeFileSync(
			path.join(liveClaudeDir, "statusline-command.sh"),
			"clean live\n",
		);
		fs.writeFileSync(
			path.join(liveClaudeDir, "agents", "policy.md"),
			"live policy\n",
		);
		fs.writeFileSync(bundledClaudeMdPath, bundledClaudeMdBefore);
		fs.writeFileSync(bundledStatuslinePath, "clean bundled\n");
		fs.writeFileSync(bundledPolicyPath, bundledPolicyBefore);

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

	it("leaves a leaking CLAUDE.md byte-unchanged without capturing policy files", () => {
		expect({
			claudeMd: fs.readFileSync(bundledClaudeMdPath),
			policy: fs.readFileSync(bundledPolicyPath),
		}).toEqual({
			claudeMd: bundledClaudeMdBefore,
			policy: bundledPolicyBefore,
		});
	});

	it("copies a clean statusline while leaving policy files byte-unchanged", () => {
		expect({
			policy: fs.readFileSync(bundledPolicyPath),
			statusline: fs.readFileSync(bundledStatuslinePath, "utf-8"),
		}).toEqual({
			policy: bundledPolicyBefore,
			statusline: "clean live\n",
		});
	});

	it("warns with the refused PERSONAL_FILES source while ignoring policy files", () => {
		expect({
			policy: fs.readFileSync(bundledPolicyPath),
			warnings,
		}).toEqual({
			policy: bundledPolicyBefore,
			warnings: [
				`REFUSED Claude backup for ${liveClaudeMdPath}: /home/xzat/private/repo on line 2: repo=/home/xzat/private/repo`,
			],
		});
	});

	it("counts one clean PERSONAL_FILES backup and one refusal only", () => {
		expect(result).toEqual({ backedUp: 1, refused: 1 });
	});
});

describe("backupClaudeConfig() guards dest-mapped PERSONAL_FILES", () => {
	let tmpDir;
	let configsDir;
	let claudeHome;
	let liveGitignorePath;
	let bundledGitignorePath;
	let bundledGitignoreBefore;
	let bundledStatuslinePath;
	let bundledPolicyPath;
	let bundledPolicyBefore;
	let warnings;
	let warningOriginal;
	let result;

	beforeEach(async () => {
		tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "haoshoku-claude-mapped-refusal-"),
		);
		configsDir = path.join(tmpDir, "configs", "claude");
		claudeHome = path.join(tmpDir, "claude-home");
		const liveClaudeDir = path.join(claudeHome, ".claude");
		liveGitignorePath = path.join(liveClaudeDir, ".gitignore");
		bundledGitignorePath = path.join(configsDir, "gitignore.template");
		bundledStatuslinePath = path.join(configsDir, "statusline-command.sh");
		bundledPolicyPath = path.join(configsDir, "workflows", "policy.js");
		bundledGitignoreBefore = Buffer.from(
			"# Sanitised\nprivate=/path/to/repo\n",
		);
		bundledPolicyBefore = Buffer.from("bundled workflow\n");

		fs.mkdirSync(path.join(liveClaudeDir, "workflows"), { recursive: true });
		fs.mkdirSync(path.join(configsDir, "workflows"), { recursive: true });
		fs.writeFileSync(
			liveGitignorePath,
			"# Private\nprivate=/Users/alice/private/repo\n",
		);
		fs.writeFileSync(
			path.join(liveClaudeDir, "statusline-command.sh"),
			"clean mapped run\n",
		);
		fs.writeFileSync(
			path.join(liveClaudeDir, "workflows", "policy.js"),
			"live workflow\n",
		);
		fs.writeFileSync(bundledGitignorePath, bundledGitignoreBefore);
		fs.writeFileSync(bundledStatuslinePath, "clean bundled\n");
		fs.writeFileSync(bundledPolicyPath, bundledPolicyBefore);

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

	it("leaves a leaking mapped .gitignore byte-unchanged without capturing policy files", () => {
		expect({
			gitignore: fs.readFileSync(bundledGitignorePath),
			policy: fs.readFileSync(bundledPolicyPath),
		}).toEqual({
			gitignore: bundledGitignoreBefore,
			policy: bundledPolicyBefore,
		});
	});

	it("copies a clean sibling while leaving mapped policy files byte-unchanged", () => {
		expect({
			policy: fs.readFileSync(bundledPolicyPath),
			statusline: fs.readFileSync(bundledStatuslinePath, "utf-8"),
		}).toEqual({
			policy: bundledPolicyBefore,
			statusline: "clean mapped run\n",
		});
	});

	it("warns with the mapped live source while ignoring policy files", () => {
		expect({
			policy: fs.readFileSync(bundledPolicyPath),
			warnings,
		}).toEqual({
			policy: bundledPolicyBefore,
			warnings: [
				`REFUSED Claude backup for ${liveGitignorePath}: /Users/alice/private/repo on line 2: private=/Users/alice/private/repo`,
			],
		});
	});

	it("counts one clean mapped backup and one refusal only", () => {
		expect(result).toEqual({ backedUp: 1, refused: 1 });
	});
});
