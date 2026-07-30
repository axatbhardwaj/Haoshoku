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

describe("Claude deny-first ignore template", () => {
	let tmpDir;

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("keeps root first-capture backups visible to the policy repository", () => {
		tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "haoshoku-claude-ignore-"),
		);
		const init = Bun.spawnSync(["git", "init"], {
			cwd: tmpDir,
			stderr: "pipe",
			stdout: "pipe",
		});
		expect(init.exitCode).toBe(0);
		fs.copyFileSync(
			path.resolve(
				import.meta.dir,
				"..",
				"configs",
				"claude",
				"gitignore.template",
			),
			path.join(tmpDir, ".gitignore"),
		);
		const firstCapture = "CLAUDE.md.haoshoku-first-capture";
		fs.writeFileSync(path.join(tmpDir, firstCapture), "# Original policy\n");

		const checkIgnore = Bun.spawnSync(
			["git", "check-ignore", "--quiet", "--", firstCapture],
			{
				cwd: tmpDir,
				stderr: "pipe",
				stdout: "pipe",
			},
		);

		expect(checkIgnore.exitCode).toBe(1);
	});
});

describe("syncClaudeConfig() respects the Claude home git index", () => {
	let tmpDir;
	let configsDir;
	let claudeHome;
	let claudeDir;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-claude-git-"));
		configsDir = path.join(tmpDir, "configs", "claude");
		claudeHome = path.join(tmpDir, "claude-home");
		claudeDir = path.join(claudeHome, ".claude");
		fs.mkdirSync(configsDir, { recursive: true });
		fs.mkdirSync(claudeDir, { recursive: true });
		const init = Bun.spawnSync(["git", "init"], {
			cwd: claudeDir,
			stderr: "pipe",
			stdout: "pipe",
		});
		expect(init.exitCode).toBe(0);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function seedBundle() {
		for (const file of PERSONAL_FILES) {
			fs.writeFileSync(
				path.join(configsDir, file.src),
				`Bundled ${file.src}\n`,
			);
		}
	}

	function expectAllBundleFilesDeployed() {
		for (const file of PERSONAL_FILES) {
			const liveFile = file.dest ?? file.src;
			expect(
				fs.readFileSync(path.join(claudeDir, liveFile), "utf-8"),
			).toBe(`Bundled ${file.src}\n`);
		}
	}

	it("does not overwrite tracked CLAUDE.md", async () => {
		const livePath = path.join(claudeDir, "CLAUDE.md");
		fs.writeFileSync(livePath, "# Private policy\n");
		fs.writeFileSync(path.join(configsDir, "CLAUDE.md"), "# Public bundle\n");
		const add = Bun.spawnSync(["git", "add", "--", "CLAUDE.md"], {
			cwd: claudeDir,
			stderr: "pipe",
			stdout: "pipe",
		});
		expect(add.exitCode).toBe(0);

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(fs.readFileSync(livePath, "utf-8")).toBe("# Private policy\n");
	});

	it("uses the destination path when deciding whether .gitignore is tracked", async () => {
		const livePath = path.join(claudeDir, ".gitignore");
		fs.writeFileSync(livePath, "# Private ignore policy\n");
		fs.writeFileSync(
			path.join(configsDir, "gitignore.template"),
			"# Public ignore template\n",
		);
		const add = Bun.spawnSync(["git", "add", "--", ".gitignore"], {
			cwd: claudeDir,
			stderr: "pipe",
			stdout: "pipe",
		});
		expect(add.exitCode).toBe(0);

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(fs.readFileSync(livePath, "utf-8")).toBe(
			"# Private ignore policy\n",
		);
	});

	it("still skips a tracked CLAUDE.md with uncommitted modifications", async () => {
		const livePath = path.join(claudeDir, "CLAUDE.md");
		fs.writeFileSync(livePath, "# Indexed policy\n");
		const add = Bun.spawnSync(["git", "add", "--", "CLAUDE.md"], {
			cwd: claudeDir,
			stderr: "pipe",
			stdout: "pipe",
		});
		expect(add.exitCode).toBe(0);
		fs.writeFileSync(livePath, "# Uncommitted private policy\n");
		fs.writeFileSync(path.join(configsDir, "CLAUDE.md"), "# Public bundle\n");

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(fs.readFileSync(livePath, "utf-8")).toBe(
			"# Uncommitted private policy\n",
		);
	});

	it("logs the tracked destination and policy-repository reason when skipping", async () => {
		const livePath = path.join(claudeDir, "CLAUDE.md");
		fs.writeFileSync(livePath, "# Private policy\n");
		fs.writeFileSync(path.join(configsDir, "CLAUDE.md"), "# Public bundle\n");
		const add = Bun.spawnSync(["git", "add", "--", "CLAUDE.md"], {
			cwd: claudeDir,
			stderr: "pipe",
			stdout: "pipe",
		});
		expect(add.exitCode).toBe(0);
		const utils = require("../src/common/utils.js");
		const originalInfo = utils.log.info;
		const infoLogs = [];
		utils.log.info = (message) => {
			infoLogs.push(message);
			originalInfo(message);
		};

		try {
			await syncClaudeConfig({ srcDir: configsDir, claudeHome });
		} finally {
			utils.log.info = originalInfo;
		}

		expect(infoLogs.join("\n")).toContain(
			"Skipped CLAUDE.md: tracked by the git repository at the Claude home",
		);
	});

	it("fails open and deploys all files when the Claude home is not a git repository", async () => {
		fs.rmSync(path.join(claudeDir, ".git"), {
			recursive: true,
			force: true,
		});
		seedBundle();

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expectAllBundleFilesDeployed();
	});

	it("fails open and deploys all files when the Claude repository tracks nothing", async () => {
		seedBundle();

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expectAllBundleFilesDeployed();
	});

	it("fails open and deploys all files when the git query errors", async () => {
		fs.rmSync(path.join(claudeDir, ".git"), {
			recursive: true,
			force: true,
		});
		fs.writeFileSync(
			path.join(claudeDir, ".git"),
			"gitdir: /tmp/haoshoku-missing-git-dir\n",
		);
		seedBundle();

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expectAllBundleFilesDeployed();
	});

	it("fails open and deploys all files when git is not installed", async () => {
		seedBundle();
		const originalPath = process.env.PATH;
		process.env.PATH = path.join(tmpDir, "missing-bin");

		try {
			await syncClaudeConfig({ srcDir: configsDir, claudeHome });
		} finally {
			process.env.PATH = originalPath;
		}

		expectAllBundleFilesDeployed();
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

	it("does not expose a backup-only directory manifest", () => {
		expect("BACKUP_ONLY_DIRS" in claudeConfig).toBe(false);
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

describe("syncClaudeConfig() preserves differing live personal files via .bak", () => {
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

	it("backs up a differing live CLAUDE.md before overwriting it", async () => {
		const liveClaudeMd = "# Live personal policy\n";
		const bundledClaudeMd = "# Bundled policy\n";
		fs.writeFileSync(path.join(claudeDir, "CLAUDE.md"), liveClaudeMd);
		fs.writeFileSync(path.join(configsDir, "CLAUDE.md"), bundledClaudeMd);

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(
			fs.readFileSync(path.join(claudeDir, "CLAUDE.md.bak"), "utf-8"),
		).toBe(liveClaudeMd);
		expect(fs.readFileSync(path.join(claudeDir, "CLAUDE.md"), "utf-8")).toBe(
			bundledClaudeMd,
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

describe("Claude policy directories remain unmanaged", () => {
	let tmpDir;
	let configsDir;
	let claudeHome;
	let claudeDir;
	let logs;
	let originalLog;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-claudedir-"));
		configsDir = path.join(tmpDir, "configs", "claude");
		claudeHome = path.join(tmpDir, "claude-home");
		claudeDir = path.join(claudeHome, ".claude");
		fs.mkdirSync(configsDir, { recursive: true });
		fs.mkdirSync(claudeDir, { recursive: true });
		for (const file of PERSONAL_FILES) {
			fs.writeFileSync(path.join(configsDir, file.src), "personal\n");
		}
		logs = {
			error: [],
			info: [],
			success: [],
			warning: [],
		};
		const utils = require("../src/common/utils.js");
		originalLog = {
			error: utils.log.error,
			info: utils.log.info,
			success: utils.log.success,
			warning: utils.log.warning,
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

	function bundledPath(directory, relativePath) {
		return path.join(configsDir, directory, relativePath);
	}

	function livePath(directory, relativePath) {
		return path.join(claudeDir, directory, relativePath);
	}

	function writeBundled(directory, relativePath, content, mode) {
		const filePath = bundledPath(directory, relativePath);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content);
		if (mode !== undefined) fs.chmodSync(filePath, mode);
		return filePath;
	}

	function writeLive(directory, relativePath, content, mode) {
		const filePath = livePath(directory, relativePath);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content);
		if (mode !== undefined) fs.chmodSync(filePath, mode);
		return filePath;
	}

	it("does not create live policy directories from bundled files", async () => {
		writeBundled("agents", "policy.md", "bundled agent\n");
		writeBundled("workflows", "review.js", "bundled workflow\n");

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect({
			agents: fs.existsSync(path.join(claudeDir, "agents")),
			workflows: fs.existsSync(path.join(claudeDir, "workflows")),
		}).toEqual({ agents: false, workflows: false });
	});

	it("does not overwrite same-named live policy files", async () => {
		writeBundled("agents", "policy.md", "bundled agent\n");
		writeBundled("workflows", "review.js", "bundled workflow\n");
		const liveAgent = writeLive("agents", "policy.md", "live agent\n");
		const liveWorkflow = writeLive("workflows", "review.js", "live workflow\n");

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect({
			agent: fs.readFileSync(liveAgent, "utf-8"),
			workflow: fs.readFileSync(liveWorkflow, "utf-8"),
		}).toEqual({ agent: "live agent\n", workflow: "live workflow\n" });
	});

	it("does not replace live policy symlinks", async () => {
		writeBundled("agents", "policy.md", "bundled agent\n");
		writeBundled("workflows", "review.js", "bundled workflow\n");
		const agentTarget = path.join(tmpDir, "agent-target.md");
		const workflowTarget = path.join(tmpDir, "workflow-target.js");
		fs.writeFileSync(agentTarget, "agent target\n");
		fs.writeFileSync(workflowTarget, "workflow target\n");
		const agentLink = livePath("agents", "policy.md");
		const workflowLink = livePath("workflows", "review.js");
		fs.mkdirSync(path.dirname(agentLink), { recursive: true });
		fs.mkdirSync(path.dirname(workflowLink), { recursive: true });
		fs.symlinkSync(agentTarget, agentLink);
		fs.symlinkSync(workflowTarget, workflowLink);

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect({
			agent: fs.lstatSync(agentLink).isSymbolicLink(),
			workflow: fs.lstatSync(workflowLink).isSymbolicLink(),
		}).toEqual({ agent: true, workflow: true });
	});

	it("does not mutate external targets referenced by live policy symlinks", async () => {
		writeBundled("agents", "policy.md", "bundled agent\n");
		writeBundled("workflows", "review.js", "bundled workflow\n");
		const agentTarget = path.join(tmpDir, "agent-target.md");
		const workflowTarget = path.join(tmpDir, "workflow-target.js");
		fs.writeFileSync(agentTarget, "agent target\n");
		fs.writeFileSync(workflowTarget, "workflow target\n");
		const agentLink = livePath("agents", "policy.md");
		const workflowLink = livePath("workflows", "review.js");
		fs.mkdirSync(path.dirname(agentLink), { recursive: true });
		fs.mkdirSync(path.dirname(workflowLink), { recursive: true });
		fs.symlinkSync(agentTarget, agentLink);
		fs.symlinkSync(workflowTarget, workflowLink);

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect({
			agentLink: fs.lstatSync(agentLink).isSymbolicLink(),
			agentTarget: fs.readFileSync(agentTarget, "utf-8"),
			workflowLink: fs.lstatSync(workflowLink).isSymbolicLink(),
			workflowTarget: fs.readFileSync(workflowTarget, "utf-8"),
		}).toEqual({
			agentLink: true,
			agentTarget: "agent target\n",
			workflowLink: true,
			workflowTarget: "workflow target\n",
		});
	});

	it("does not create external backups for policy collisions", async () => {
		writeBundled("agents", "policy.md", "bundled agent\n");
		writeLive("agents", "policy.md", "live agent\n");
		const backupBase = path.join(
			claudeHome,
			".local",
			"state",
			"haoshoku",
			"backups",
		);

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(fs.existsSync(backupBase)).toBe(false);
	});

	it("does not change executable modes in live policy directories", async () => {
		writeBundled("agents", "run.sh", "#!/bin/sh\necho bundled\n", 0o755);
		const liveAgent = writeLive(
			"agents",
			"run.sh",
			"#!/bin/sh\necho live\n",
			0o644,
		);

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(fs.statSync(liveAgent).mode & 0o777).toBe(0o644);
	});

	it("does not deploy nested policy trees", async () => {
		writeBundled("agents", path.join("nested", "policy.md"), "agent\n");
		writeBundled("workflows", path.join("nested", "review.js"), "workflow\n");

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect({
			agent: fs.existsSync(livePath("agents", path.join("nested", "policy.md"))),
			workflow: fs.existsSync(
				livePath("workflows", path.join("nested", "review.js")),
			),
		}).toEqual({ agent: false, workflow: false });
	});

	it("does not warn when policy directories are absent from the bundle", async () => {
		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(logs.warning).toEqual([]);
	});

	it("does not emit a merge-deploy summary", async () => {
		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(
			logs.success.some((message) => message.includes("merge-deploy")),
		).toBe(false);
	});

	it("leaves unrelated top-level Claude files untouched", async () => {
		const liveFile = path.join(claudeDir, "local-only.md");
		fs.writeFileSync(liveFile, "local-only content\n");

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(fs.readFileSync(liveFile, "utf-8")).toBe("local-only content\n");
	});

	it("does not create bundled policy directories from live files", async () => {
		writeLive("agents", "policy.md", "live agent\n");
		writeLive("workflows", "review.js", "live workflow\n");

		await backupClaudeConfig({ srcDir: configsDir, claudeHome });

		expect({
			agents: fs.existsSync(path.join(configsDir, "agents")),
			workflows: fs.existsSync(path.join(configsDir, "workflows")),
		}).toEqual({ agents: false, workflows: false });
	});

	it("does not overwrite an existing bundled agent from a live file", async () => {
		const bundledAgent = writeBundled(
			"agents",
			"policy.md",
			"bundled agent\n",
		);
		writeLive("agents", "policy.md", "live agent\n");

		await backupClaudeConfig({ srcDir: configsDir, claudeHome });

		expect({
			contents: fs.existsSync(bundledAgent)
				? fs.readFileSync(bundledAgent, "utf-8")
				: null,
			exists: fs.existsSync(bundledAgent),
		}).toEqual({ contents: "bundled agent\n", exists: true });
	});

	it("does not overwrite an existing bundled workflow from a live file", async () => {
		const bundledWorkflow = writeBundled(
			"workflows",
			"review.js",
			"bundled workflow\n",
		);
		writeLive("workflows", "review.js", "live workflow\n");

		await backupClaudeConfig({ srcDir: configsDir, claudeHome });

		expect(fs.readFileSync(bundledWorkflow, "utf-8")).toBe(
			"bundled workflow\n",
		);
	});

	it("does not scan policy files for backup leaks or count them", async () => {
		writeLive("agents", "policy.md", "repo=/home/xzat/private/repo\n");
		fs.writeFileSync(
			path.join(claudeDir, "statusline-command.sh"),
			"clean statusline\n",
		);

		const result = await backupClaudeConfig({ srcDir: configsDir, claudeHome });

		expect({
			result,
			warnings: logs.warning,
		}).toEqual({
			result: { backedUp: 1, refused: 0 },
			warnings: [],
		});
	});

	it("does not delete a bundled policy file for a live symlink", async () => {
		const bundledAgent = writeBundled(
			"agents",
			"policy.md",
			"bundled agent\n",
		);
		const externalAgent = path.join(tmpDir, "external-agent.md");
		fs.writeFileSync(externalAgent, "external agent\n");
		const liveAgent = livePath("agents", "policy.md");
		fs.mkdirSync(path.dirname(liveAgent), { recursive: true });
		fs.symlinkSync(externalAgent, liveAgent);

		await backupClaudeConfig({ srcDir: configsDir, claudeHome });

		expect({
			contents: fs.existsSync(bundledAgent)
				? fs.readFileSync(bundledAgent, "utf-8")
				: null,
			exists: fs.existsSync(bundledAgent),
		}).toEqual({ contents: "bundled agent\n", exists: true });
	});

	it("leaves every non-personal Claude directory untouched in both directions", async () => {
		const directories = [
			"agents",
			"workflows",
			"conventions",
			"output-styles",
			"hooks",
		];
		for (const directory of directories) {
			writeBundled(directory, "bundled.txt", "bundled\n");
			writeLive(directory, "live.txt", "live\n");
		}

		await syncClaudeConfig({ srcDir: configsDir, claudeHome });
		await backupClaudeConfig({ srcDir: configsDir, claudeHome });

		const state = directories.map((directory) => ({
			bundled: fs.readFileSync(
				bundledPath(directory, "bundled.txt"),
				"utf-8",
			),
			deployed: fs.existsSync(livePath(directory, "bundled.txt")),
			directory,
			live: fs.readFileSync(livePath(directory, "live.txt"), "utf-8"),
		}));
		expect(state).toEqual(
			directories.map((directory) => ({
				bundled: "bundled\n",
				deployed: false,
				directory,
				live: "live\n",
			})),
		);
	});
});
