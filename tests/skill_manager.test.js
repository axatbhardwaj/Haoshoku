import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	mergeAgents,
	mergeSkills,
	resolveDefaultBranch,
	syncSkills,
} from "../src/helpers/skill_manager.js";

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

	it("symlinks skills into the Codex agents-skills dir and isolates agents", () => {
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
		// An agent .md in the source so we can assert agents land in the injected dir.
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
		// Agents merge respects the injected dir — never touches the real ~/.claude/agents
		expect(isSymlink(path.join(claudeAgentsDir, "sample-agent.md"))).toBe(true);
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
});

describe("mergeAgents() local-file shadowing", () => {
	let tmpDir;
	let agentsDir;
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
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-agents-"));
		agentsDir = path.join(tmpDir, "live-agents");
		const cachePath = path.join(tmpDir, "skills-source");
		const sourceAgents = path.join(cachePath, "agents");
		fs.mkdirSync(sourceAgents, { recursive: true });
		fs.writeFileSync(path.join(sourceAgents, "collision.md"), "skills agent\n");
		source = { name: "fake-skills", cachePath };
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

	it("reports a real local agent shadow as skipped instead of merged or failed", () => {
		fs.mkdirSync(agentsDir, { recursive: true });
		const collision = path.join(agentsDir, "collision.md");
		const localBytes = Buffer.from("local agent\n");
		fs.writeFileSync(collision, localBytes);

		const seenAgents = mergeAgents([source], { agentsDir });

		expect(fs.lstatSync(collision).isSymbolicLink()).toBe(false);
		expect(fs.readFileSync(collision)).toEqual(localBytes);
		expect({ infos, successes, warnings, errors }).toEqual({
			infos: [`Skipped agent collision.md: local file wins at ${collision}`],
			successes: [
				`Merged 0 agents to ${agentsDir}; skipped 1 local shadow; failed 0`,
			],
			warnings: [],
			errors: [],
		});
		expect(seenAgents).toBeInstanceOf(Set);
		expect(seenAgents.has("collision.md")).toBe(true);
	});

	it("still reports a genuine symlink failure as an error", () => {
		fs.mkdirSync(agentsDir, { recursive: true });
		fs.chmodSync(agentsDir, 0o555);

		let seenAgents;
		try {
			seenAgents = mergeAgents([source], { agentsDir });
		} finally {
			fs.chmodSync(agentsDir, 0o755);
		}

		expect(fs.existsSync(path.join(agentsDir, "collision.md"))).toBe(false);
		expect(errors.some((message) =>
			message.startsWith("Failed to symlink agent collision.md:"),
		)).toBe(true);
		expect(seenAgents.has("collision.md")).toBe(false);
	});

	it("replaces a stale agent symlink instead of treating it as a local shadow", () => {
		fs.mkdirSync(agentsDir, { recursive: true });
		const sourceAgent = path.join(source.cachePath, "agents", "collision.md");
		const foreignTarget = path.join(tmpDir, "foreign-agent.md");
		const collision = path.join(agentsDir, "collision.md");
		fs.writeFileSync(foreignTarget, "foreign agent\n");
		fs.symlinkSync(foreignTarget, collision);

		const seenAgents = mergeAgents([source], { agentsDir });

		expect(fs.lstatSync(collision).isSymbolicLink()).toBe(true);
		expect(fs.readlinkSync(collision)).toBe(sourceAgent);
		expect(fs.readFileSync(foreignTarget, "utf-8")).toBe("foreign agent\n");
		expect(warnings).toEqual([]);
		expect(errors).toEqual([]);
		expect(seenAgents.has("collision.md")).toBe(true);
	});

	it("T11 keeps an already-correct symlink unchanged and counted as seen", () => {
		fs.mkdirSync(agentsDir, { recursive: true });
		const sourceAgent = path.join(source.cachePath, "agents", "collision.md");
		const collision = path.join(agentsDir, "collision.md");
		fs.symlinkSync(sourceAgent, collision);
		const linkBefore = fs.readlinkSync(collision);

		const seenAgents = mergeAgents([source], { agentsDir });

		expect(fs.lstatSync(collision).isSymbolicLink()).toBe(true);
		expect(fs.readlinkSync(collision)).toBe(linkBefore);
		expect(warnings).toEqual([]);
		expect(errors).toEqual([]);
		expect(seenAgents).toBeInstanceOf(Set);
		expect(seenAgents.has("collision.md")).toBe(true);
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
