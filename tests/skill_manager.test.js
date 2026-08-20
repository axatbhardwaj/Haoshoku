import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	cloneOrPullRepo,
	mergeSkills,
	resolveDefaultBranch,
	syncSkills,
} from "../src/helpers/skill_manager.js";
import { log } from "../src/common/utils.js";

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

	it("syncs skills without installing custom Claude agents", () => {
		// Pre-seed the cache so cloneOrPullRepo returns it without a network clone.
		const url = "https://github.com/owner/codextest";
		const skillRoot = path.join(
			cacheDir,
			"owner-codextest",
			"skills",
			"codex-skill",
		);
		fs.mkdirSync(skillRoot, { recursive: true });
		fs.writeFileSync(path.join(skillRoot, "SKILL.md"), "# codex-skill\n");
		// A source may carry agent definitions, but native-only setup ignores them.
		const agentsSrc = path.join(cacheDir, "owner-codextest", "agents");
		fs.mkdirSync(agentsSrc, { recursive: true });
		fs.writeFileSync(path.join(agentsSrc, "sample-agent.md"), "# agent\n");
		fs.writeFileSync(configPath, JSON.stringify({ skillSources: [url] }));

		const claudeDir = path.join(tmpDir, "claude-skills");
		const codexSkillsDir = path.join(tmpDir, "agents-skills");
		const claudeAgentsDir = path.join(tmpDir, "claude-agents");

		const result = syncSkills({
			configPath,
			cacheDir,
			skillsDir: claudeDir,
			agentsSkillsDir: codexSkillsDir,
			agentsDir: claudeAgentsDir,
		});

		const isSymlink = (p) => {
			try {
				return fs.lstatSync(p).isSymbolicLink();
			} catch {
				return false;
			}
		};

		expect(result.status).toBe("ok");
		// Claude skills dir gets the skill (existing behavior, via injected skillsDir)
		expect(isSymlink(path.join(claudeDir, "codex-skill"))).toBe(true);
		// Codex skills dir gets the same skill (~/.agents/skills behavior)
		expect(isSymlink(path.join(codexSkillsDir, "codex-skill"))).toBe(true);
		expect(isSymlink(path.join(claudeAgentsDir, "sample-agent.md"))).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// symlinkSharedResource — tested via mergeSkills
// ---------------------------------------------------------------------------
describe("mergeSkills() — symlinkSharedResource safe-backup", () => {
	let tmpDir;
	let skillsDestDir;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-merge-"));
		skillsDestDir = path.join(tmpDir, "dest-skills");
		fs.mkdirSync(skillsDestDir, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	/**
	 * Build a minimal fake source layout that mergeSkills expects:
	 *   <cacheRoot>/skills/scripts/
	 *   <cacheRoot>/skills/CLAUDE.md
	 *   <cacheRoot>/skills/README.md
	 */
	function buildFakeSource(name) {
		const cacheRoot = path.join(tmpDir, `cache-${name}`);
		const skillsRoot = path.join(cacheRoot, "skills");
		fs.mkdirSync(path.join(skillsRoot, "scripts"), { recursive: true });
		fs.writeFileSync(
			path.join(skillsRoot, "scripts", "helper.sh"),
			"#!/bin/sh\n",
		);
		fs.writeFileSync(path.join(skillsRoot, "CLAUDE.md"), `# ${name}\n`);
		fs.writeFileSync(path.join(skillsRoot, "README.md"), `# readme ${name}\n`);
		return { url: `https://github.com/owner/${name}`, name, cachePath: cacheRoot };
	}

	it("backs up a pre-existing real directory to .bak and replaces with symlink", () => {
		// Put a REAL directory at the scripts destination before mergeSkills runs.
		const destScripts = path.join(skillsDestDir, "scripts");
		fs.mkdirSync(destScripts, { recursive: true });
		fs.writeFileSync(path.join(destScripts, "existing.sh"), "old content\n");

		const source = buildFakeSource("repo-a");

		// Patch CLAUDE_SKILLS_DIR to our tmp directory.
		mergeSkills([source], { skillsDir: skillsDestDir });

		// The original real directory must survive as .bak
		const bakPath = `${destScripts}.bak`;
		expect(fs.existsSync(bakPath)).toBe(true);
		const bakStat = fs.lstatSync(bakPath);
		expect(bakStat.isDirectory()).toBe(true);
		// The file that was inside must still be there
		expect(fs.existsSync(path.join(bakPath, "existing.sh"))).toBe(true);

		// The destination must now be a symlink
		const destStat = fs.lstatSync(destScripts);
		expect(destStat.isSymbolicLink()).toBe(true);
		// Pointing to the cache source
		const srcScripts = path.join(source.cachePath, "skills", "scripts");
		expect(fs.readlinkSync(destScripts)).toBe(srcScripts);
	});

	it("backs up a pre-existing real file to .bak and replaces with symlink", () => {
		// Put a REAL file at the CLAUDE.md destination before mergeSkills runs.
		const destClaudeMd = path.join(skillsDestDir, "CLAUDE.md");
		fs.writeFileSync(destClaudeMd, "old CLAUDE content\n");

		const source = buildFakeSource("repo-b");

		mergeSkills([source], { skillsDir: skillsDestDir });

		const bakPath = `${destClaudeMd}.bak`;
		expect(fs.existsSync(bakPath)).toBe(true);
		const bakStat = fs.lstatSync(bakPath);
		expect(bakStat.isFile()).toBe(true);

		const destStat = fs.lstatSync(destClaudeMd);
		expect(destStat.isSymbolicLink()).toBe(true);
	});

	it("removes a stale .bak before renaming, then renames existing real dir", () => {
		// Pre-existing REAL dir AND stale .bak
		const destScripts = path.join(skillsDestDir, "scripts");
		fs.mkdirSync(destScripts, { recursive: true });
		fs.writeFileSync(path.join(destScripts, "existing.sh"), "content\n");

		const bakPath = `${destScripts}.bak`;
		// Stale .bak is itself a directory
		fs.mkdirSync(bakPath, { recursive: true });
		fs.writeFileSync(path.join(bakPath, "stale.sh"), "stale\n");

		const source = buildFakeSource("repo-c");

		// Should not throw even though .bak already exists
		expect(() => mergeSkills([source], { skillsDir: skillsDestDir })).not.toThrow();

		// .bak now holds the formerly-live directory (stale one wiped)
		expect(fs.existsSync(bakPath)).toBe(true);
		expect(fs.existsSync(path.join(bakPath, "existing.sh"))).toBe(true);

		// dest is symlink
		const destStat = fs.lstatSync(destScripts);
		expect(destStat.isSymbolicLink()).toBe(true);
	});

	it("re-symlinks an existing symlink that points to the wrong target (no .bak)", () => {
		const destScripts = path.join(skillsDestDir, "scripts");
		// Wrong symlink pointing to non-existent path
		fs.symlinkSync("/tmp/wrong-target", destScripts);

		const source = buildFakeSource("repo-d");

		mergeSkills([source], { skillsDir: skillsDestDir });

		// No .bak should be created for a symlink
		expect(fs.existsSync(`${destScripts}.bak`)).toBe(false);

		const destStat = fs.lstatSync(destScripts);
		expect(destStat.isSymbolicLink()).toBe(true);
		const srcScripts = path.join(source.cachePath, "skills", "scripts");
		expect(fs.readlinkSync(destScripts)).toBe(srcScripts);
	});

	it("reports skills already linked on a second run as in place", () => {
		const source = buildFakeSource("repo-e");
		const skillDir = path.join(source.cachePath, "skills", "solo");
		fs.mkdirSync(skillDir, { recursive: true });
		fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# solo\n");
		const utils = require("../src/common/utils.js");
		const successSpy = spyOn(utils.log, "success").mockImplementation(() => {});

		try {
			mergeSkills([source], { skillsDir: skillsDestDir });
			successSpy.mockClear();

			mergeSkills([source], { skillsDir: skillsDestDir });

			expect(successSpy).toHaveBeenCalledWith(
				`1 skill in place at ${skillsDestDir}; 0 local shadows skipped; 0 skills failed`,
			);
		} finally {
			successSpy.mockRestore();
		}
	});
});

describe("mergeSkills() local-skill shadowing", () => {
	let tmpDir;
	let skillsDir;
	let source;
	let infos;
	let successes;
	let warnings;
	let errors;
	let originalInfo;
	let originalSuccess;
	let originalWarning;
	let originalError;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-skill-shadow-"));
		skillsDir = path.join(tmpDir, "live-skills");
		const cachePath = path.join(tmpDir, "skills-source");
		const sourceSkill = path.join(cachePath, "skills", "collision");
		fs.mkdirSync(sourceSkill, { recursive: true });
		fs.writeFileSync(path.join(sourceSkill, "SKILL.md"), "# source skill\n");
		source = {
			name: "fake-skills",
			url: "https://github.com/owner/fake-skills",
			cachePath,
		};
		infos = [];
		successes = [];
		warnings = [];
		errors = [];
		const utils = require("../src/common/utils.js");
		originalInfo = utils.log.info;
		originalSuccess = utils.log.success;
		originalWarning = utils.log.warning;
		originalError = utils.log.error;
		utils.log.info = (message) => infos.push(message);
		utils.log.success = (message) => successes.push(message);
		utils.log.warning = (message) => warnings.push(message);
		utils.log.error = (message) => errors.push(message);
	});

	afterEach(() => {
		const utils = require("../src/common/utils.js");
		utils.log.info = originalInfo;
		utils.log.success = originalSuccess;
		utils.log.warning = originalWarning;
		utils.log.error = originalError;
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("keeps a real local skill and reports it as a local shadow", () => {
		const collision = path.join(skillsDir, "collision");
		const localBytes = Buffer.from("# local skill\n");
		fs.mkdirSync(skillsDir, { recursive: true });
		fs.writeFileSync(collision, localBytes);

		const seenSkills = mergeSkills([source], { skillsDir });

		expect(fs.lstatSync(collision).isSymbolicLink()).toBe(false);
		expect(fs.lstatSync(collision).isFile()).toBe(true);
		expect(fs.readFileSync(collision)).toEqual(localBytes);
		expect({ infos, successes, warnings, errors }).toEqual({
			infos: [`Skipped skill collision: local skill wins at ${collision}`],
			successes: [
				`0 skills in place at ${skillsDir}; 1 local shadow skipped; 0 skills failed`,
			],
			warnings: [],
			errors: [],
		});
		expect(seenSkills).toBeInstanceOf(Set);
		expect(seenSkills.has("collision")).toBe(true);
	});

	it("replaces a stale foreign skill symlink and counts it as in place", () => {
		fs.mkdirSync(skillsDir, { recursive: true });
		const sourceSkill = path.join(source.cachePath, "skills", "collision");
		const foreignTarget = path.join(tmpDir, "foreign-skill");
		const collision = path.join(skillsDir, "collision");
		fs.mkdirSync(foreignTarget);
		fs.writeFileSync(path.join(foreignTarget, "SKILL.md"), "# foreign skill\n");
		fs.symlinkSync(foreignTarget, collision);

		const seenSkills = mergeSkills([source], { skillsDir });

		expect(fs.lstatSync(collision).isSymbolicLink()).toBe(true);
		expect(fs.readlinkSync(collision)).toBe(sourceSkill);
		expect(fs.readFileSync(path.join(foreignTarget, "SKILL.md"), "utf-8")).toBe(
			"# foreign skill\n",
		);
		expect(successes).toEqual([
			`1 skill in place at ${skillsDir}; 0 local shadows skipped; 0 skills failed`,
		]);
		expect(warnings).toEqual([]);
		expect(errors).toEqual([]);
		expect(seenSkills.has("collision")).toBe(true);
	});

	it("reports a genuine permission-denied skill symlink creation as a failure", () => {
		fs.mkdirSync(skillsDir, { recursive: true });
		fs.chmodSync(skillsDir, 0o555);

		let seenSkills;
		try {
			seenSkills = mergeSkills([source], { skillsDir });
		} finally {
			fs.chmodSync(skillsDir, 0o755);
		}

		expect(fs.existsSync(path.join(skillsDir, "collision"))).toBe(false);
		expect(errors.some((message) =>
			message.startsWith("Error creating symlink for collision:"),
		)).toBe(true);
		expect(successes).toEqual([]);
		expect(warnings).toEqual([
			`0 skills in place at ${skillsDir}; 0 local shadows skipped; 1 skill failed`,
		]);
		expect(seenSkills.has("collision")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// resolveDefaultBranch
// ---------------------------------------------------------------------------
describe("resolveDefaultBranch()", () => {
	let tmpDir;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-branch-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	/** Skip the test gracefully if git is not available in this environment. */
	function requireGit() {
		const result = Bun.spawnSync(["git", "--version"]);
		if (result.exitCode !== 0) {
			console.log("SKIP: git not available");
			return false;
		}
		return true;
	}

	it("resolves 'master' from a repo whose default branch is master", async () => {
		if (!requireGit()) return;

		// Create a bare "origin" repo with a master branch
		const originPath = path.join(tmpDir, "origin.git");
		const localPath = path.join(tmpDir, "local");

		// Init bare repo with -b master
		const initResult = Bun.spawnSync(
			["git", "init", "--bare", "-b", "master", originPath],
		);
		if (initResult.exitCode !== 0) {
			// Older git may not support -b; skip
			console.log("SKIP: git init -b not supported");
			return;
		}

		// Create a local clone with an initial commit so origin/HEAD can be set
		Bun.spawnSync(["git", "clone", originPath, localPath]);
		// Need at least one commit for origin/HEAD to be meaningful
		Bun.spawnSync(["git", "-C", localPath, "config", "user.email", "test@test.com"]);
		Bun.spawnSync(["git", "-C", localPath, "config", "user.name", "Test"]);
		Bun.spawnSync(["git", "-C", localPath, "commit", "--allow-empty", "-m", "init"]);
		Bun.spawnSync(["git", "-C", localPath, "push", "origin", "master"]);

		// Set origin/HEAD on the bare repo
		Bun.spawnSync(["git", "-C", originPath, "symbolic-ref", "HEAD", "refs/heads/master"]);

		// Now set remote set-head on local
		Bun.spawnSync(["git", "-C", localPath, "remote", "set-head", "origin", "--auto"]);

		const branch = resolveDefaultBranch(localPath);
		expect(branch).toBe("master");
	});

	it("falls back to 'main' when git is not a repo / branch cannot be resolved", () => {
		// Non-git directory — should not throw, should return 'main'
		const nonRepo = path.join(tmpDir, "not-a-repo");
		fs.mkdirSync(nonRepo);

		const branch = resolveDefaultBranch(nonRepo);
		expect(branch).toBe("main");
	});
});

// ---------------------------------------------------------------------------
// cloneOrPullRepo update safety
// ---------------------------------------------------------------------------
describe("cloneOrPullRepo() cache updates", () => {
	let tmpDir;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-cache-update-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function runGit(args, cwd) {
		const result = Bun.spawnSync(["git", ...args], cwd ? { cwd } : {});
		expect(result.exitCode).toBe(0);
		return new TextDecoder().decode(result.stdout).trim();
	}

	function configureIdentity(repoPath) {
		runGit(["config", "user.email", "test@example.com"], repoPath);
		runGit(["config", "user.name", "Haoshoku Test"], repoPath);
	}

	function createOrigin() {
		const originPath = path.join(tmpDir, "origin.git");
		const publisherPath = path.join(tmpDir, "publisher");
		runGit(["init", "--bare", originPath]);
		runGit(["symbolic-ref", "HEAD", "refs/heads/main"], originPath);
		runGit(["clone", originPath, publisherPath]);
		configureIdentity(publisherPath);
		fs.writeFileSync(path.join(publisherPath, "README.md"), "initial\n");
		runGit(["add", "README.md"], publisherPath);
		runGit(["commit", "-m", "initial"], publisherPath);
		runGit(["push", "origin", "main"], publisherPath);
		return { originPath, publisherPath };
	}

	function cloneCache(originPath, cacheDir) {
		const repoPath = path.join(cacheDir, "owner-origin");
		fs.mkdirSync(cacheDir, { recursive: true });
		runGit(["clone", originPath, repoPath]);
		return repoPath;
	}

	it("keeps a feature cache untouched when checkout of the default branch fails", () => {
		const { originPath, publisherPath } = createOrigin();
		const cacheDir = path.join(tmpDir, "cache");
		const repoPath = cloneCache(originPath, cacheDir);
		const url = "https://github.com/owner/origin";

		configureIdentity(repoPath);
		runGit(["checkout", "-b", "feature-x"], repoPath);
		fs.writeFileSync(path.join(repoPath, "feature-only.txt"), "feature commit\n");
		runGit(["add", "feature-only.txt"], repoPath);
		runGit(["commit", "-m", "feature only"], repoPath);
		const featureCommit = runGit(["rev-parse", "HEAD"], repoPath);
		const featureBranchBefore = runGit(["rev-parse", "feature-x"], repoPath);

		fs.writeFileSync(path.join(publisherPath, "origin-advanced.txt"), "from origin\n");
		runGit(["add", "origin-advanced.txt"], publisherPath);
		runGit(["commit", "-m", "advance origin"], publisherPath);
		runGit(["push", "origin", "main"], publisherPath);
		const cachedOriginMainBefore = runGit(["rev-parse", "origin/main"], repoPath);

		runGit(["checkout", "main"], repoPath);
		fs.writeFileSync(path.join(repoPath, "default-only.txt"), "from main\n");
		runGit(["add", "default-only.txt"], repoPath);
		runGit(["commit", "-m", "default-only"], repoPath);
		runGit(["checkout", "feature-x"], repoPath);
		fs.writeFileSync(path.join(repoPath, "default-only.txt"), "local untracked\n");

		const warningSpy = spyOn(log, "warning").mockImplementation(() => {});
		try {
			const result = cloneOrPullRepo(url, true, cacheDir);

			expect(result).toBe(repoPath);
			expect(warningSpy).toHaveBeenCalledWith(
				"Failed to checkout main in owner-origin, keeping stale cache",
			);
		} finally {
			warningSpy.mockRestore();
		}

		expect(runGit(["rev-parse", "origin/main"], repoPath)).toBe(cachedOriginMainBefore);
		expect(runGit(["branch", "--show-current"], repoPath)).toBe("feature-x");
		expect(runGit(["rev-parse", "HEAD"], repoPath)).toBe(featureCommit);
		expect(runGit(["rev-parse", "feature-x"], repoPath)).toBe(featureBranchBefore);
		expect(runGit(["log", "-1", "--format=%H", "feature-x"], repoPath)).toBe(
			featureCommit,
		);
	});

	it("fetches and resets a default-branch cache when origin advances", () => {
		const { originPath, publisherPath } = createOrigin();
		const cacheDir = path.join(tmpDir, "cache");
		const repoPath = cloneCache(originPath, cacheDir);
		const url = "https://github.com/owner/origin";

		fs.writeFileSync(path.join(publisherPath, "latest.txt"), "latest from origin\n");
		runGit(["add", "latest.txt"], publisherPath);
		runGit(["commit", "-m", "advance main"], publisherPath);
		runGit(["push", "origin", "main"], publisherPath);
		const latestCommit = runGit(["rev-parse", "HEAD"], publisherPath);

		const warningSpy = spyOn(log, "warning").mockImplementation(() => {});
		let result;
		try {
			result = cloneOrPullRepo(url, true, cacheDir);
			expect(warningSpy).not.toHaveBeenCalled();
		} finally {
			warningSpy.mockRestore();
		}

		expect(result).toBe(repoPath);
		expect(runGit(["branch", "--show-current"], repoPath)).toBe("main");
		expect(runGit(["rev-parse", "HEAD"], repoPath)).toBe(latestCommit);
		expect(fs.readFileSync(path.join(repoPath, "latest.txt"), "utf-8")).toBe(
			"latest from origin\n",
		);
	});
});
