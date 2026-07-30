import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as claudeConfig from "../src/helpers/configure_claude.js";
import {
	PERSONAL_FILES,
	backupClaudeConfig,
	syncClaudeConfig,
} from "../src/helpers/configure_claude.js";
import { mergeAgents } from "../src/helpers/skill_manager.js";

describe("PERSONAL_FILES manifest", () => {
	it("includes statusline-command.sh (regression — must not be silently dropped)", () => {
		const srcs = PERSONAL_FILES.map((f) => f.src);
		expect(srcs).toContain("statusline-command.sh");
	});

	it("includes the three expected personal files in stable order", () => {
		const srcs = PERSONAL_FILES.map((f) => f.src);
		expect(srcs).toEqual([
			"CLAUDE.md",
			"statusline-command.sh",
			"gitignore.template",
		]);
	});

	it("does not contain a real .gitignore that could filter the bundle", () => {
		const bundledGitignore = path.resolve(
			import.meta.dir,
			"..",
			"configs",
			"claude",
			".gitignore",
		);
		expect(fs.existsSync(bundledGitignore)).toBe(false);
	});
});

describe("PERSONAL_FILES dest mapping", () => {
	let tmpDir;
	let configsDir;
	let claudeHome;
	const mappedFile = {
		src: "mapped-file.template",
		dest: ".mapped-file",
	};

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-mapped-file-"));
		configsDir = path.join(tmpDir, "configs", "claude");
		claudeHome = path.join(tmpDir, "claude-home");
		fs.mkdirSync(configsDir, { recursive: true });
		PERSONAL_FILES.push(mappedFile);
	});

	afterEach(() => {
		PERSONAL_FILES.splice(PERSONAL_FILES.indexOf(mappedFile), 1);
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("deploys to dest and backs up from dest while keeping src as the bundle path", async () => {
		const bundledPath = path.join(configsDir, mappedFile.src);
		const liveDestPath = path.join(
			claudeHome,
			".claude",
			mappedFile.dest,
		);
		const liveSrcPath = path.join(claudeHome, ".claude", mappedFile.src);
		fs.writeFileSync(bundledPath, "bundled\n");

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(fs.existsSync(liveDestPath)).toBe(true);
		expect(fs.existsSync(liveSrcPath)).toBe(false);

		fs.writeFileSync(liveDestPath, "live\n");
		await backupClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(fs.readFileSync(bundledPath, "utf-8")).toBe("live\n");
		expect(
			fs.existsSync(path.join(configsDir, mappedFile.dest)),
		).toBe(false);
	});
});

describe("Claude directory ownership manifests", () => {
	it("does not expose a wipe-replace directory manifest", () => {
		expect("WIPE_DIRS" in claudeConfig).toBe(false);
	});

	it("merge-deploys the co-owned agents and workflows directories", () => {
		expect(claudeConfig.MERGE_DEPLOY_DIRS).toEqual(["agents", "workflows"]);
	});

	it("retires the backup-only manifest in favor of merge-deploy ownership", () => {
		expect("BACKUP_ONLY_DIRS" in claudeConfig).toBe(false);
	});
});

describe("backupClaudeConfig() captures co-owned directories", () => {
	let tmpDir;
	let configsDir;
	let claudeHome;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-co-owned-"));
		configsDir = path.join(tmpDir, "configs", "claude");
		claudeHome = path.join(tmpDir, "claude-home");
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("backs up files from live agents and workflows directories", async () => {
		const liveClaudeDir = path.join(claudeHome, ".claude");
		const liveAgent = path.join(liveClaudeDir, "agents", "local-agent.md");
		const liveWorkflow = path.join(
			liveClaudeDir,
			"workflows",
			"local-workflow.md",
		);
		fs.mkdirSync(path.dirname(liveAgent), { recursive: true });
		fs.mkdirSync(path.dirname(liveWorkflow), { recursive: true });
		fs.writeFileSync(liveAgent, "local agent\n");
		fs.writeFileSync(liveWorkflow, "local workflow\n");

		await backupClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(
			fs.readFileSync(path.join(configsDir, "agents", "local-agent.md"), "utf-8"),
		).toBe("local agent\n");
		expect(
			fs.readFileSync(
				path.join(configsDir, "workflows", "local-workflow.md"),
				"utf-8",
			),
		).toBe("local workflow\n");
	});

	it("does not copy symlinks from live agents or workflows", async () => {
		const liveClaudeDir = path.join(claudeHome, ".claude");
		const externalFile = path.join(tmpDir, "external.md");
		const agentLink = path.join(liveClaudeDir, "agents", "external-agent.md");
		const workflowLink = path.join(
			liveClaudeDir,
			"workflows",
			"external-workflow.md",
		);
		fs.mkdirSync(path.dirname(agentLink), { recursive: true });
		fs.mkdirSync(path.dirname(workflowLink), { recursive: true });
		fs.writeFileSync(externalFile, "external\n");
		fs.symlinkSync(externalFile, agentLink);
		fs.symlinkSync(externalFile, workflowLink);

		await backupClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(
			fs.lstatSync(path.join(configsDir, "agents", "external-agent.md"), {
				throwIfNoEntry: false,
			}),
		).toBeUndefined();
		expect(
			fs.lstatSync(
				path.join(configsDir, "workflows", "external-workflow.md"),
				{ throwIfNoEntry: false },
			),
		).toBeUndefined();
	});
});

describe("backupClaudeConfig() skips symlinked entries", () => {
	let tmpDir;
	let configsDir;
	let claudeHome;
	let warnings;
	let warnOrig;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-backup-"));
		configsDir = path.join(tmpDir, "configs", "claude");
		claudeHome = path.join(tmpDir, "claude-home");
		warnings = [];
		const utils = require("../src/common/utils.js");
		warnOrig = utils.log.warning;
		utils.log.warning = (msg) => warnings.push(msg);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		const utils = require("../src/common/utils.js");
		utils.log.warning = warnOrig;
	});

	it("backs up real files but omits top-level and nested symlinks with warnings", async () => {
		const liveAgents = path.join(claudeHome, ".claude", "agents");
		const nestedDir = path.join(liveAgents, "nested");
		const externalFile = path.join(tmpDir, "external-agent.md");
		fs.mkdirSync(nestedDir, { recursive: true });
		fs.writeFileSync(path.join(liveAgents, "local-agent.md"), "local\n");
		fs.writeFileSync(path.join(nestedDir, "local-nested.md"), "nested\n");
		fs.writeFileSync(externalFile, "external\n");
		fs.symlinkSync(externalFile, path.join(liveAgents, "external-agent.md"));
		fs.symlinkSync(externalFile, path.join(nestedDir, "external-nested.md"));

		await backupClaudeConfig({ srcDir: configsDir, claudeHome });

		const backedUpAgents = path.join(configsDir, "agents");
		expect(
			fs.readFileSync(path.join(backedUpAgents, "local-agent.md"), "utf-8"),
		).toBe("local\n");
		expect(
			fs.readFileSync(
				path.join(backedUpAgents, "nested", "local-nested.md"),
				"utf-8",
			),
		).toBe("nested\n");
		expect(
			fs.lstatSync(path.join(backedUpAgents, "external-agent.md"), {
				throwIfNoEntry: false,
			}),
		).toBeUndefined();
		expect(
			fs.lstatSync(path.join(backedUpAgents, "nested", "external-nested.md"), {
				throwIfNoEntry: false,
			}),
		).toBeUndefined();
		const merged = warnings.join("\n");
		expect(merged).toContain(path.join(liveAgents, "external-agent.md"));
		expect(merged).toContain(path.join(nestedDir, "external-nested.md"));
	});
});

describe("syncClaudeConfig() warns on missing sources", () => {
	let tmpDir;
	let configsDir;
	let claudeHome;
	let warnings;
	let warnOrig;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-sync-"));
		configsDir = path.join(tmpDir, "configs", "claude");
		claudeHome = path.join(tmpDir, "claude-home");
		fs.mkdirSync(configsDir, { recursive: true });
		warnings = [];
		// Capture log.warning calls without disturbing the rest of the logger.
		const utils = require("../src/common/utils.js");
		warnOrig = utils.log.warning;
		utils.log.warning = (msg) => warnings.push(msg);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		const utils = require("../src/common/utils.js");
		utils.log.warning = warnOrig;
	});

	it("emits a warning when statusline-command.sh is missing from the source bundle", async () => {
		// Bundle CLAUDE.md only (statusline absent).
		fs.writeFileSync(path.join(configsDir, "CLAUDE.md"), "# test\n");

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		const merged = warnings.join("\n");
		expect(merged).toContain("statusline-command.sh");
	});

	it("copies statusline-command.sh to ~/.claude/ when present in bundle", async () => {
		const STATUSLINE_BODY = "#!/usr/bin/env bash\necho 'haoshoku statusline'\n";
		fs.writeFileSync(path.join(configsDir, "CLAUDE.md"), "# test\n");
		fs.writeFileSync(
			path.join(configsDir, "statusline-command.sh"),
			STATUSLINE_BODY,
		);

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		const deployed = path.join(claudeHome, ".claude", "statusline-command.sh");
		expect(fs.existsSync(deployed)).toBe(true);
		expect(fs.readFileSync(deployed, "utf-8")).toBe(STATUSLINE_BODY);
		expect(warnings.some((w) => w.includes("statusline-command.sh"))).toBe(
			false,
		);
	});
});

describe("Claude settings.json remains unmanaged", () => {
	let tmpDir;
	let configsDir;
	let claudeHome;
	let claudeDir;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-claudebak-"));
		configsDir = path.join(tmpDir, "configs", "claude");
		claudeHome = path.join(tmpDir, "claude-home");
		claudeDir = path.join(claudeHome, ".claude");
		fs.mkdirSync(configsDir, { recursive: true });
		fs.mkdirSync(claudeDir, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("does not deploy a stale bundled settings.json or create a backup", async () => {
		const liveSettings = `${JSON.stringify({ enabledPlugins: { "x@y": true } }, null, 2)}\n`;
		fs.writeFileSync(path.join(claudeDir, "settings.json"), liveSettings);

		const bundledSettings = `${JSON.stringify({ stale: true }, null, 2)}\n`;
		fs.writeFileSync(path.join(configsDir, "settings.json"), bundledSettings);
		fs.writeFileSync(path.join(configsDir, "CLAUDE.md"), "# test\n");
		fs.writeFileSync(path.join(configsDir, "statusline-command.sh"), "#!/bin/sh\n");

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(fs.readFileSync(path.join(claudeDir, "settings.json"), "utf-8")).toBe(
			liveSettings,
		);
		expect(fs.existsSync(path.join(claudeDir, "settings.json.bak"))).toBe(false);
	});

	it("does not back up live settings.json into the bundle", async () => {
		fs.writeFileSync(path.join(claudeDir, "settings.json"), '{"live":true}\n');

		await backupClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(fs.existsSync(path.join(configsDir, "settings.json"))).toBe(false);
	});
});

describe("dropped Claude directories remain unmanaged", () => {
	let tmpDir;
	let configsDir;
	let claudeHome;
	let claudeDir;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-claudedir-"));
		configsDir = path.join(tmpDir, "configs", "claude");
		claudeHome = path.join(tmpDir, "claude-home");
		claudeDir = path.join(claudeHome, ".claude");
		fs.mkdirSync(configsDir, { recursive: true });
		fs.mkdirSync(claudeDir, { recursive: true });
		// PERSONAL_FILES are required so the loop doesn't warn; content is irrelevant here.
		for (const f of PERSONAL_FILES) {
			fs.writeFileSync(path.join(configsDir, f.src), "x");
		}
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("does not deploy or remove files in dropped directories", async () => {
		const droppedDirs = ["conventions", "output-styles", "hooks"];
		for (const directory of droppedDirs) {
			const bundledDir = path.join(configsDir, directory);
			const liveDir = path.join(claudeDir, directory);
			fs.mkdirSync(bundledDir, { recursive: true });
			fs.mkdirSync(liveDir, { recursive: true });
			fs.writeFileSync(path.join(bundledDir, "bundled.txt"), "bundled\n");
			fs.writeFileSync(path.join(liveDir, "live.txt"), "live\n");
		}

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		for (const directory of droppedDirs) {
			const liveDir = path.join(claudeDir, directory);
			expect(fs.readFileSync(path.join(liveDir, "live.txt"), "utf-8")).toBe(
				"live\n",
			);
			expect(fs.existsSync(path.join(liveDir, "bundled.txt"))).toBe(false);
		}
	});

	it("does not back up live files from dropped directories", async () => {
		for (const directory of ["conventions", "output-styles", "hooks"]) {
			const liveDir = path.join(claudeDir, directory);
			fs.mkdirSync(liveDir, { recursive: true });
			fs.writeFileSync(path.join(liveDir, "live.txt"), "live\n");
		}

		await backupClaudeConfig({ srcDir: configsDir, claudeHome });

		for (const directory of ["conventions", "output-styles", "hooks"]) {
			expect(fs.existsSync(path.join(configsDir, directory))).toBe(false);
		}
	});
});

describe("syncClaudeConfig() merge-deploys co-owned directories", () => {
	let tmpDir;
	let configsDir;
	let claudeHome;
	let claudeDir;
	let logs;
	let originalLog;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-claudeownership-"));
		configsDir = path.join(tmpDir, "configs", "claude");
		claudeHome = path.join(tmpDir, "claude-home");
		claudeDir = path.join(claudeHome, ".claude");
		fs.mkdirSync(configsDir, { recursive: true });
		fs.mkdirSync(claudeDir, { recursive: true });
		for (const f of PERSONAL_FILES) {
			fs.writeFileSync(path.join(configsDir, f.src), "x");
		}
		logs = {
			info: [],
			success: [],
			warning: [],
			error: [],
		};
		const utils = require("../src/common/utils.js");
		originalLog = {
			info: utils.log.info,
			success: utils.log.success,
			warning: utils.log.warning,
			error: utils.log.error,
		};
		for (const level of Object.keys(logs)) {
			utils.log[level] = (message) => logs[level].push(message);
		}
	});

	afterEach(() => {
		const utils = require("../src/common/utils.js");
		Object.assign(utils.log, originalLog);
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function bundlePath(directory, relativePath) {
		return path.join(configsDir, directory, relativePath);
	}

	function livePath(directory, relativePath) {
		return path.join(claudeDir, directory, relativePath);
	}

	function writeBundle(directory, relativePath, content, mode) {
		const filePath = bundlePath(directory, relativePath);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content);
		if (mode !== undefined) {
			fs.chmodSync(filePath, mode);
		}
		return filePath;
	}

	function listTree(root) {
		if (!fs.existsSync(root)) return [];
		const entries = [];
		const walk = (current, relative = "") => {
			for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
				const entryRelative = path.join(relative, entry.name);
				const entryPath = path.join(current, entry.name);
				const stat = fs.lstatSync(entryPath);
				entries.push({
					path: entryRelative,
					type: stat.isSymbolicLink()
						? "symlink"
						: stat.isDirectory()
							? "directory"
							: "file",
				});
				if (stat.isDirectory()) {
					walk(entryPath, entryRelative);
				}
			}
		};
		walk(root);
		return entries.sort((a, b) => a.path.localeCompare(b.path));
	}

	function backupBase() {
		return path.join(
			claudeHome,
			".local",
			"state",
			"haoshoku",
			"backups",
		);
	}

	it("T1 basic deploy copies agents and workflows byte-exact and preserves executable mode", async () => {
		const agentBody = Buffer.from("# bundled agent\n");
		const workflowBody = Buffer.from("# bundled workflow\n");
		const executableBody = Buffer.from("#!/bin/sh\necho task\n");
		writeBundle("agents", "bundled.md", agentBody);
		writeBundle("workflows", "review.md", workflowBody);
		writeBundle("agents", "run-codex-task.sh", executableBody, 0o755);

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(fs.existsSync(livePath("agents", "bundled.md"))).toBe(true);
		expect(fs.existsSync(livePath("workflows", "review.md"))).toBe(true);
		expect(fs.existsSync(livePath("agents", "run-codex-task.sh"))).toBe(true);
		expect(fs.readFileSync(livePath("agents", "bundled.md"))).toEqual(agentBody);
		expect(fs.readFileSync(livePath("workflows", "review.md"))).toEqual(
			workflowBody,
		);
		const executable = livePath("agents", "run-codex-task.sh");
		expect(fs.readFileSync(executable)).toEqual(executableBody);
		expect(fs.statSync(executable).mode & 0o111).toBe(0o111);
		expect(logs.info.some((message) => message.includes("deployed agents/"))).toBe(
			true,
		);
		expect(
			logs.success.some(
				(message) =>
					message.includes("deployed=3") &&
					message.includes("unchanged=0") &&
					message.includes("backed-up=0") &&
					message.includes("refused=0"),
			),
		).toBe(true);
	});

	it("T2 preserves every foreign path absent from the bundle", async () => {
		writeBundle("agents", "owned.md", "bundled agent\n");
		writeBundle("workflows", "owned.js", "bundled workflow\n");
		const foreignFile = livePath("agents", "foreign.md");
		const foreignTarget = path.join(tmpDir, "foreign-target.md");
		const foreignLink = livePath("agents", "foreign-link.md");
		const foreignNested = livePath("workflows", "user", "script.sh");
		fs.mkdirSync(path.dirname(foreignFile), { recursive: true });
		fs.mkdirSync(path.dirname(foreignNested), { recursive: true });
		fs.writeFileSync(foreignFile, "foreign real\n");
		fs.writeFileSync(foreignTarget, "foreign target\n");
		fs.symlinkSync(foreignTarget, foreignLink);
		fs.writeFileSync(foreignNested, "foreign nested\n");
		const fileTypeBefore = fs.lstatSync(foreignFile).mode & 0o170000;
		const nestedTypeBefore =
			fs.lstatSync(path.dirname(foreignNested)).mode & 0o170000;
		const linkTargetBefore = fs.readlinkSync(foreignLink);

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(fs.lstatSync(foreignFile).mode & 0o170000).toBe(fileTypeBefore);
		expect(fs.readFileSync(foreignFile, "utf-8")).toBe("foreign real\n");
		expect(fs.lstatSync(foreignLink).isSymbolicLink()).toBe(true);
		expect(fs.readlinkSync(foreignLink)).toBe(linkTargetBefore);
		expect(fs.readFileSync(foreignTarget, "utf-8")).toBe("foreign target\n");
		expect(
			fs.lstatSync(path.dirname(foreignNested)).mode & 0o170000,
		).toBe(nestedTypeBefore);
		expect(fs.readFileSync(foreignNested, "utf-8")).toBe("foreign nested\n");
		expect(fs.existsSync(livePath("agents", "owned.md"))).toBe(true);
		expect(fs.existsSync(livePath("workflows", "owned.js"))).toBe(true);
		expect(fs.readFileSync(livePath("agents", "owned.md"), "utf-8")).toBe(
			"bundled agent\n",
		);
		expect(fs.readFileSync(livePath("workflows", "owned.js"), "utf-8")).toBe(
			"bundled workflow\n",
		);
	});

	it("T3 replaces a bundle-owned foreign symlink without writing through it", async () => {
		const bundled = Buffer.from("bundled replacement\n");
		const externalOriginal = Buffer.from("skills repository content\n");
		writeBundle("agents", "collision.md", bundled);
		const externalTarget = path.join(tmpDir, "skills-repo-agent.md");
		const collision = livePath("agents", "collision.md");
		fs.mkdirSync(path.dirname(collision), { recursive: true });
		fs.writeFileSync(externalTarget, externalOriginal);
		fs.symlinkSync(externalTarget, collision);

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(fs.readFileSync(externalTarget)).toEqual(externalOriginal);
		expect(fs.lstatSync(collision).isSymbolicLink()).toBe(false);
		expect(fs.readFileSync(collision)).toEqual(bundled);
	});

	it("T4 creates no in-tree backup artifacts or copies of foreign target content", async () => {
		const bundledAgent = "bundled agent\n";
		const bundledWorkflow = "bundled workflow\n";
		const foreignOriginal = "unique foreign target bytes\n";
		writeBundle("agents", "collision.md", bundledAgent);
		writeBundle("workflows", "review.js", bundledWorkflow);
		const externalTarget = path.join(tmpDir, "external-workflow.js");
		const collision = livePath("agents", "collision.md");
		fs.mkdirSync(path.dirname(collision), { recursive: true });
		fs.writeFileSync(externalTarget, foreignOriginal);
		fs.symlinkSync(externalTarget, collision);

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		const agentsTree = listTree(path.join(claudeDir, "agents"));
		const workflowsTree = listTree(path.join(claudeDir, "workflows"));
		expect(agentsTree).toEqual([{ path: "collision.md", type: "file" }]);
		expect(workflowsTree).toEqual([{ path: "review.js", type: "file" }]);
		expect(
			[...agentsTree, ...workflowsTree].some((entry) =>
				entry.path.endsWith(".bak"),
			),
		).toBe(false);
		for (const directory of ["agents", "workflows"]) {
			for (const entry of listTree(path.join(claudeDir, directory))) {
				if (entry.type === "file") {
					expect(
						fs.readFileSync(path.join(claudeDir, directory, entry.path), "utf-8"),
					).not.toBe(foreignOriginal);
				}
			}
		}
		expect(fs.readFileSync(externalTarget, "utf-8")).toBe(foreignOriginal);
	});

	it("T5 externally backs up a differing real file byte-exact before overwrite", async () => {
		const original = Buffer.from([0x00, 0xff, 0x10, 0x0a, 0x42]);
		const bundled = Buffer.from([0x42, 0x0a, 0x10, 0xff, 0x00]);
		writeBundle("agents", path.join("nested", "collision.bin"), bundled);
		const collision = livePath("agents", path.join("nested", "collision.bin"));
		fs.mkdirSync(path.dirname(collision), { recursive: true });
		fs.writeFileSync(collision, original);

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(fs.existsSync(backupBase())).toBe(true);
		const backupRoots = fs.readdirSync(backupBase());
		expect(backupRoots).toHaveLength(1);
		const backupRoot = path.join(backupBase(), backupRoots[0]);
		const backedUpFile = path.join(
			backupRoot,
			"agents",
			"nested",
			"collision.bin",
		);
		expect(path.relative(path.join(claudeDir, "agents"), backupRoot).startsWith("..")).toBe(
			true,
		);
		expect(
			path.relative(path.join(claudeDir, "workflows"), backupRoot).startsWith(
				"..",
			),
		).toBe(true);
		expect(fs.readFileSync(backedUpFile)).toEqual(original);
		expect(fs.readFileSync(collision)).toEqual(bundled);
		fs.copyFileSync(backedUpFile, collision);
		expect(fs.readFileSync(collision)).toEqual(original);
		expect(
			logs.success.some(
				(message) =>
					message.includes(backupRoot) &&
					message.includes("deployed=1") &&
					message.includes("backed-up=1"),
			),
		).toBe(true);
	});

	it("T6 replaces a dangling bundle-owned symlink without materializing its target", async () => {
		writeBundle("agents", "dangling.md", "bundled\n");
		const missingTarget = path.join(tmpDir, "missing", "target.md");
		const dangling = livePath("agents", "dangling.md");
		fs.mkdirSync(path.dirname(dangling), { recursive: true });
		fs.symlinkSync(missingTarget, dangling);
		expect(fs.existsSync(dangling)).toBe(false);
		expect(fs.lstatSync(dangling).isSymbolicLink()).toBe(true);

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(fs.existsSync(missingTarget)).toBe(false);
		expect(fs.lstatSync(dangling).isSymbolicLink()).toBe(false);
		expect(fs.readFileSync(dangling, "utf-8")).toBe("bundled\n");
		const backupRoots = fs.readdirSync(backupBase());
		expect(backupRoots).toHaveLength(1);
		const backedUpLink = path.join(
			backupBase(),
			backupRoots[0],
			"agents",
			"dangling.md",
		);
		expect(fs.lstatSync(backedUpLink).isSymbolicLink()).toBe(true);
		expect(fs.readlinkSync(backedUpLink)).toBe(missingTarget);
	});

	it("T7 refuses a live directory where the bundle has a file and continues", async () => {
		writeBundle("agents", "collision.md", "bundle file\n");
		writeBundle("agents", "sibling.md", "bundle sibling\n");
		const collision = livePath("agents", "collision.md");
		const nested = path.join(collision, "user-file.md");
		fs.mkdirSync(collision, { recursive: true });
		fs.writeFileSync(nested, "user bytes\n");

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(fs.lstatSync(collision).isDirectory()).toBe(true);
		expect(fs.readFileSync(nested, "utf-8")).toBe("user bytes\n");
		expect(fs.existsSync(livePath("agents", "sibling.md"))).toBe(true);
		expect(fs.readFileSync(livePath("agents", "sibling.md"), "utf-8")).toBe(
			"bundle sibling\n",
		);
		expect(
			logs.error.some(
				(message) =>
					message.includes("refused") && message.includes("agents/collision.md"),
			),
		).toBe(true);
		expect(
			logs.success.some(
				(message) =>
					message.includes("deployed=1") && message.includes("refused=1"),
			),
		).toBe(true);
	});

	it("refuses a live file where the bundle has a directory and continues", async () => {
		writeBundle("workflows", path.join("nested", "bundle.js"), "bundle nested\n");
		writeBundle("workflows", "sibling.js", "bundle sibling\n");
		const collision = livePath("workflows", "nested");
		fs.mkdirSync(path.dirname(collision), { recursive: true });
		fs.writeFileSync(collision, "user file\n");

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(fs.lstatSync(collision).isFile()).toBe(true);
		expect(fs.readFileSync(collision, "utf-8")).toBe("user file\n");
		expect(fs.existsSync(livePath("workflows", "sibling.js"))).toBe(true);
		expect(fs.readFileSync(livePath("workflows", "sibling.js"), "utf-8")).toBe(
			"bundle sibling\n",
		);
		expect(
			logs.error.some(
				(message) =>
					message.includes("refused") && message.includes("workflows/nested"),
			),
		).toBe(true);
	});

	it("T8 makes an identical second deploy a write-free no-op with no new backup root", async () => {
		writeBundle("agents", "stable.md", "stable bytes\n");

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		const deployed = livePath("agents", "stable.md");
		expect(fs.existsSync(deployed)).toBe(true);
		const oldTime = new Date("2000-01-01T00:00:00.000Z");
		fs.utimesSync(deployed, oldTime, oldTime);
		const beforeMtime = fs.statSync(deployed).mtimeMs;
		const beforeBackupCount = fs.existsSync(backupBase())
			? fs.readdirSync(backupBase()).length
			: 0;
		for (const level of Object.keys(logs)) logs[level].length = 0;

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		const afterBackupCount = fs.existsSync(backupBase())
			? fs.readdirSync(backupBase()).length
			: 0;
		expect(fs.readFileSync(deployed, "utf-8")).toBe("stable bytes\n");
		expect(fs.statSync(deployed).mtimeMs).toBe(beforeMtime);
		expect(afterBackupCount).toBe(beforeBackupCount);
		expect(
			logs.info.some(
				(message) =>
					message.includes("unchanged") && message.includes("agents/stable.md"),
			),
		).toBe(true);
		expect(
			logs.success.some(
				(message) =>
					message.includes("unchanged=1") && message.includes("backed-up=0"),
			),
		).toBe(true);
	});

	it("T9 converges regardless of whether mergeAgents or config deploy runs first", async () => {
		async function runOrder(order, rootName) {
			const root = path.join(tmpDir, rootName);
			const treeConfigs = path.join(root, "configs", "claude");
			const treeHome = path.join(root, "home");
			const treeAgents = path.join(treeHome, ".claude", "agents");
			const skillsRoot = path.join(root, "skills-source");
			const skillsAgents = path.join(skillsRoot, "agents");
			fs.mkdirSync(treeConfigs, { recursive: true });
			for (const file of PERSONAL_FILES) {
				fs.writeFileSync(path.join(treeConfigs, file.src), "x");
			}
			fs.mkdirSync(path.join(treeConfigs, "agents"), { recursive: true });
			fs.writeFileSync(
				path.join(treeConfigs, "agents", "collision.md"),
				"bundle wins\n",
			);
			fs.mkdirSync(skillsAgents, { recursive: true });
			fs.writeFileSync(
				path.join(skillsAgents, "collision.md"),
				"skills collision\n",
			);
			fs.writeFileSync(
				path.join(skillsAgents, "skills-only.md"),
				"skills only\n",
			);
			const source = {
				name: "fake-skills",
				cachePath: skillsRoot,
			};
			const deploy = () =>
				syncClaudeConfig({ srcDir: treeConfigs, claudeHome: treeHome });
			const merge = () => mergeAgents([source], { agentsDir: treeAgents });
			if (order === "merge-first") {
				merge();
				await deploy();
			} else {
				await deploy();
				merge();
			}
			return treeAgents;
		}

		const mergeFirst = await runOrder("merge-first", "merge-first");
		const deployFirst = await runOrder("deploy-first", "deploy-first");

		for (const agentsDir of [mergeFirst, deployFirst]) {
			const collision = path.join(agentsDir, "collision.md");
			const skillsOnly = path.join(agentsDir, "skills-only.md");
			expect(fs.lstatSync(collision).isSymbolicLink()).toBe(false);
			expect(fs.readFileSync(collision, "utf-8")).toBe("bundle wins\n");
			expect(fs.lstatSync(skillsOnly).isSymbolicLink()).toBe(true);
		}
		expect(listTree(mergeFirst)).toEqual(listTree(deployFirst));
		expect(logs.error).toEqual([]);
	});

	it("T12 refuses backup placement inside a co-owned live directory and continues", async () => {
		writeBundle("agents", "collision.md", "bundle collision\n");
		writeBundle("agents", "sibling.md", "bundle sibling\n");
		const collision = livePath("agents", "collision.md");
		fs.mkdirSync(path.dirname(collision), { recursive: true });
		fs.writeFileSync(collision, "local collision\n");
		const stateHome = path.join(claudeDir, "agents");

		await syncClaudeConfig({ srcDir: configsDir, claudeHome, stateHome });

		expect(fs.readFileSync(collision, "utf-8")).toBe("local collision\n");
		expect(fs.readFileSync(livePath("agents", "sibling.md"), "utf-8")).toBe(
			"bundle sibling\n",
		);
		expect(fs.existsSync(path.join(stateHome, "haoshoku"))).toBe(false);
		expect(
			logs.error.some(
				(message) =>
					message.includes("refused") &&
					message.includes("external backup root"),
			),
		).toBe(true);
	});

	it("T13 refuses a multiply-linked real file without mutating either alias and continues", async () => {
		writeBundle("workflows", "collision.js", "bundle collision\n");
		writeBundle("workflows", "sibling.js", "bundle sibling\n");
		const collision = livePath("workflows", "collision.js");
		const externalAlias = path.join(tmpDir, "external-workflow.js");
		fs.mkdirSync(path.dirname(collision), { recursive: true });
		fs.writeFileSync(collision, "shared local bytes\n");
		fs.linkSync(collision, externalAlias);
		expect(fs.lstatSync(collision).nlink).toBe(2);

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(fs.readFileSync(collision, "utf-8")).toBe("shared local bytes\n");
		expect(fs.readFileSync(externalAlias, "utf-8")).toBe("shared local bytes\n");
		expect(fs.readFileSync(livePath("workflows", "sibling.js"), "utf-8")).toBe(
			"bundle sibling\n",
		);
		expect(
			logs.error.some(
				(message) =>
					message.includes("refused") &&
					message.includes("multiple hard links"),
			),
		).toBe(true);
		expect(fs.existsSync(backupBase())).toBe(false);
		expect(
			logs.success.some(
				(message) =>
					message.includes("deployed=1") &&
					message.includes("backed-up=0") &&
					message.includes("refused=1"),
			),
		).toBe(true);
	});

	it("T14 refuses a symlinked state root that resolves inside a co-owned directory", async () => {
		writeBundle("agents", "collision.md", "bundle collision\n");
		writeBundle("agents", "sibling.md", "bundle sibling\n");
		const collision = livePath("agents", "collision.md");
		fs.mkdirSync(path.dirname(collision), { recursive: true });
		fs.writeFileSync(collision, "local collision\n");
		const stateHome = path.join(tmpDir, "state-link");
		fs.symlinkSync(path.join(claudeDir, "agents"), stateHome);

		await syncClaudeConfig({ srcDir: configsDir, claudeHome, stateHome });

		expect(fs.readFileSync(collision, "utf-8")).toBe("local collision\n");
		expect(fs.readFileSync(livePath("agents", "sibling.md"), "utf-8")).toBe(
			"bundle sibling\n",
		);
		expect(fs.existsSync(path.join(claudeDir, "agents", "haoshoku"))).toBe(
			false,
		);
		expect(fs.lstatSync(stateHome).isSymbolicLink()).toBe(true);
		expect(
			logs.error.some(
				(message) =>
					message.includes("refused") &&
					message.includes("external backup root"),
			),
		).toBe(true);
	});

	it("T15 leaves unowned conventions content untouched", async () => {
		const bundledConventions = path.join(configsDir, "conventions");
		const liveConventions = path.join(claudeDir, "conventions");
		const liveOnly = path.join(liveConventions, "stale.md");
		const bundledOnly = path.join(liveConventions, "current.md");
		fs.mkdirSync(bundledConventions, { recursive: true });
		fs.mkdirSync(liveConventions, { recursive: true });
		fs.writeFileSync(path.join(bundledConventions, "current.md"), "current\n");
		fs.writeFileSync(liveOnly, "stale\n");

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(fs.readFileSync(liveOnly, "utf-8")).toBe("stale\n");
		expect(fs.existsSync(bundledOnly)).toBe(false);
	});
});
