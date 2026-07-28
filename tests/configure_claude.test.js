import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	MERGE_DIRS,
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

	it("includes the three expected personal files in stable order", () => {
		const srcs = PERSONAL_FILES.map((f) => f.src);
		expect(srcs).toEqual([
			"settings.json",
			"CLAUDE.md",
			"statusline-command.sh",
		]);
	});
});

describe("Claude directory ownership manifests", () => {
	it("keeps hooks in WIPE_DIRS (regression — must stay wipe-replace)", () => {
		expect(WIPE_DIRS).toContain("hooks");
	});

	it("includes agents in MERGE_DIRS", () => {
		expect(MERGE_DIRS).toContain("agents");
	});

	it("includes workflows in MERGE_DIRS", () => {
		expect(MERGE_DIRS).toContain("workflows");
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

	it("MERGE dir preserves an untracked live file", async () => {
		const bundledAgents = path.join(configsDir, "agents");
		const liveAgents = path.join(claudeDir, "agents");
		fs.mkdirSync(bundledAgents, { recursive: true });
		fs.mkdirSync(liveAgents, { recursive: true });
		fs.writeFileSync(path.join(bundledAgents, "bundled.md"), "bundled\n");
		const liveOnly = path.join(liveAgents, "external-agent.md");
		fs.writeFileSync(liveOnly, "external\n");

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(fs.existsSync(liveOnly)).toBe(true);
		expect(fs.readFileSync(liveOnly, "utf-8")).toBe("external\n");
	});

	it("MERGE dir preserves an external symlink and its target", async () => {
		const bundledAgents = path.join(configsDir, "agents");
		const liveAgents = path.join(claudeDir, "agents");
		const externalDir = path.join(tmpDir, "skill-manager-cache");
		const externalLink = path.join(liveAgents, "skill-manager-agent");
		fs.mkdirSync(bundledAgents, { recursive: true });
		fs.mkdirSync(liveAgents, { recursive: true });
		fs.mkdirSync(externalDir, { recursive: true });
		fs.symlinkSync(externalDir, externalLink);

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(
			fs.lstatSync(externalLink, { throwIfNoEntry: false })?.isSymbolicLink(),
		).toBe(true);
		expect(fs.realpathSync(externalLink)).toBe(fs.realpathSync(externalDir));
	});

	it("MERGE dir deploys and overwrites bundle-owned files", async () => {
		const bundledAgents = path.join(configsDir, "agents");
		const liveAgents = path.join(claudeDir, "agents");
		const bundledFile = path.join(bundledAgents, "codex-wrapper.md");
		const liveFile = path.join(liveAgents, "codex-wrapper.md");
		fs.mkdirSync(bundledAgents, { recursive: true });
		fs.mkdirSync(liveAgents, { recursive: true });
		fs.writeFileSync(bundledFile, "current bundle content\n");
		fs.writeFileSync(liveFile, "stale live content\n");

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(fs.readFileSync(liveFile, "utf-8")).toBe("current bundle content\n");
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
