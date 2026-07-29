import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as claudeConfig from "../src/helpers/configure_claude.js";
import {
	PERSONAL_FILES,
	WIPE_DIRS,
	backupClaudeConfig,
	syncClaudeConfig,
} from "../src/helpers/configure_claude.js";

describe("PERSONAL_FILES manifest", () => {
	it("includes statusline-command.sh (regression — must not be silently dropped)", () => {
		const srcs = PERSONAL_FILES.map((f) => f.src);
		expect(srcs).toContain("statusline-command.sh");
	});

	it("includes the four expected personal files in stable order", () => {
		const srcs = PERSONAL_FILES.map((f) => f.src);
		expect(srcs).toEqual([
			"settings.json",
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
	it("keeps exactly the pre-batch wipe-replace directories", () => {
		expect(WIPE_DIRS).toEqual(["conventions", "output-styles", "hooks"]);
	});

	it("keeps agents and workflows backup-only", () => {
		expect(claudeConfig.BACKUP_ONLY_DIRS).toEqual(["agents", "workflows"]);
	});

	it("does not expose a merge-deploy directory manifest", () => {
		expect("MERGE_DIRS" in claudeConfig).toBe(false);
	});
});

describe("backupClaudeConfig() captures backup-only directories", () => {
	let tmpDir;
	let configsDir;
	let claudeHome;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-backup-only-"));
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
		// Bundle two of the three PERSONAL_FILES (statusline absent).
		fs.writeFileSync(path.join(configsDir, "settings.json"), "{}");
		fs.writeFileSync(path.join(configsDir, "CLAUDE.md"), "# test\n");

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		const merged = warnings.join("\n");
		expect(merged).toContain("statusline-command.sh");
	});

	it("copies statusline-command.sh to ~/.claude/ when present in bundle", async () => {
		const STATUSLINE_BODY = "#!/usr/bin/env bash\necho 'haoshoku statusline'\n";
		fs.writeFileSync(path.join(configsDir, "settings.json"), "{}");
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

describe("syncClaudeConfig() preserves the user's live settings.json via .bak", () => {
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

	it("backs up a differing live settings.json to settings.json.bak before overwriting", async () => {
		// User's live settings.json carries runtime-mutated state (e.g. enabled
		// plugins) that differs from the bundled template.
		const liveSettings = `${JSON.stringify({ enabledPlugins: { "x@y": true } }, null, 2)}\n`;
		fs.writeFileSync(path.join(claudeDir, "settings.json"), liveSettings);

		const bundledSettings = `${JSON.stringify({ permissions: { allow: [] } }, null, 2)}\n`;
		fs.writeFileSync(path.join(configsDir, "settings.json"), bundledSettings);
		fs.writeFileSync(path.join(configsDir, "CLAUDE.md"), "# test\n");
		fs.writeFileSync(path.join(configsDir, "statusline-command.sh"), "#!/bin/sh\n");

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		// Original live config preserved in .bak; bundled config now live.
		expect(
			fs.readFileSync(path.join(claudeDir, "settings.json.bak"), "utf-8"),
		).toBe(liveSettings);
		expect(fs.readFileSync(path.join(claudeDir, "settings.json"), "utf-8")).toBe(
			bundledSettings,
		);
	});

	it("does not clobber the original .bak when settings.json is synced a second time", async () => {
		const originalLive = `${JSON.stringify({ original: true }, null, 2)}\n`;
		fs.writeFileSync(path.join(claudeDir, "settings.json"), originalLive);

		const bundledSettings = `${JSON.stringify({ bundled: true }, null, 2)}\n`;
		fs.writeFileSync(path.join(configsDir, "settings.json"), bundledSettings);
		fs.writeFileSync(path.join(configsDir, "CLAUDE.md"), "# test\n");
		fs.writeFileSync(path.join(configsDir, "statusline-command.sh"), "#!/bin/sh\n");

		// First sync: original → .bak, bundled → live.
		await syncClaudeConfig({ srcDir: configsDir, claudeHome });
		// Second sync: live already equals bundled → no-op, .bak must stay pristine.
		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(
			fs.readFileSync(path.join(claudeDir, "settings.json.bak"), "utf-8"),
		).toBe(originalLive);
	});
});

describe("syncClaudeConfig() replaces WIPE_DIRS (stale entries do not linger)", () => {
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

	it("removes a stale file inside a WIPE_DIR that the new bundle no longer ships", async () => {
		const managed = WIPE_DIRS[0];

		// Bundle ships only keep.md.
		fs.mkdirSync(path.join(configsDir, managed), { recursive: true });
		fs.writeFileSync(path.join(configsDir, managed, "keep.md"), "keep\n");

		// Live dir has a leftover from a previous bundle that was since deleted.
		fs.mkdirSync(path.join(claudeDir, managed), { recursive: true });
		fs.writeFileSync(path.join(claudeDir, managed, "stale.md"), "stale\n");

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		const liveManaged = path.join(claudeDir, managed);
		expect(fs.existsSync(path.join(liveManaged, "stale.md"))).toBe(false);
		expect(fs.existsSync(path.join(liveManaged, "keep.md"))).toBe(true);
	});

	it("wipe-replaces hooks/ specifically", async () => {
		const bundledHooks = path.join(configsDir, "hooks");
		const liveHooks = path.join(claudeDir, "hooks");

		fs.mkdirSync(bundledHooks, { recursive: true });
		fs.writeFileSync(path.join(bundledHooks, "keep.sh"), "keep\n");

		fs.mkdirSync(liveHooks, { recursive: true });
		fs.writeFileSync(path.join(liveHooks, "stale.sh"), "stale\n");

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(fs.existsSync(path.join(liveHooks, "stale.sh"))).toBe(false);
		expect(fs.existsSync(path.join(liveHooks, "keep.sh"))).toBe(true);
	});

	it("deploys bundled conventions and removes live-only conventions", async () => {
		const bundledConventions = path.join(configsDir, "conventions");
		const liveConventions = path.join(claudeDir, "conventions");
		const bundledFile = path.join(bundledConventions, "bundled.md");
		const liveOnlyFile = path.join(liveConventions, "live-only.md");
		fs.mkdirSync(bundledConventions, { recursive: true });
		fs.mkdirSync(liveConventions, { recursive: true });
		fs.writeFileSync(bundledFile, "bundled convention\n");
		fs.writeFileSync(liveOnlyFile, "live-only convention\n");

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(
			fs.readFileSync(path.join(liveConventions, "bundled.md"), "utf-8"),
		).toBe("bundled convention\n");
		expect(fs.existsSync(liveOnlyFile)).toBe(false);
	});
});

describe("syncClaudeConfig() applies directory ownership semantics", () => {
	let tmpDir;
	let configsDir;
	let claudeHome;
	let claudeDir;

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
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("does not create, modify, or delete files or symlinks in agents and workflows", async () => {
		const bundledAgents = path.join(configsDir, "agents");
		const bundledWorkflows = path.join(configsDir, "workflows");
		const liveAgents = path.join(claudeDir, "agents");
		const liveWorkflows = path.join(claudeDir, "workflows");
		const externalFile = path.join(tmpDir, "skill-manager-agent.md");
		const externalLink = path.join(liveAgents, "skill-manager-agent.md");
		fs.mkdirSync(bundledAgents, { recursive: true });
		fs.mkdirSync(bundledWorkflows, { recursive: true });
		fs.mkdirSync(liveAgents, { recursive: true });
		fs.mkdirSync(liveWorkflows, { recursive: true });
		fs.writeFileSync(path.join(bundledAgents, "existing.md"), "bundled agent\n");
		fs.writeFileSync(path.join(bundledAgents, "bundled-only.md"), "new agent\n");
		fs.writeFileSync(
			path.join(bundledWorkflows, "existing.md"),
			"bundled workflow\n",
		);
		fs.writeFileSync(
			path.join(bundledWorkflows, "bundled-only.md"),
			"new workflow\n",
		);
		const liveAgent = path.join(liveAgents, "existing.md");
		const liveWorkflow = path.join(liveWorkflows, "existing.md");
		fs.writeFileSync(liveAgent, "live agent\n");
		fs.writeFileSync(liveWorkflow, "live workflow\n");
		fs.writeFileSync(externalFile, "external agent\n");
		fs.symlinkSync(externalFile, externalLink);

		const agentBefore = fs.readFileSync(liveAgent);
		const workflowBefore = fs.readFileSync(liveWorkflow);

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(fs.readFileSync(liveAgent)).toEqual(agentBefore);
		expect(fs.readFileSync(liveWorkflow)).toEqual(workflowBefore);
		expect(fs.existsSync(path.join(liveAgents, "bundled-only.md"))).toBe(false);
		expect(fs.existsSync(path.join(liveWorkflows, "bundled-only.md"))).toBe(
			false,
		);
		expect(fs.lstatSync(externalLink).isSymbolicLink()).toBe(true);
		expect(fs.readFileSync(externalFile, "utf-8")).toBe("external agent\n");
	});

	it("WIPE dir removes an untracked live file", async () => {
		const bundledConventions = path.join(configsDir, "conventions");
		const liveConventions = path.join(claudeDir, "conventions");
		const liveOnly = path.join(liveConventions, "stale.md");
		fs.mkdirSync(bundledConventions, { recursive: true });
		fs.mkdirSync(liveConventions, { recursive: true });
		fs.writeFileSync(path.join(bundledConventions, "current.md"), "current\n");
		fs.writeFileSync(liveOnly, "stale\n");

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(fs.existsSync(liveOnly)).toBe(false);
	});
});
