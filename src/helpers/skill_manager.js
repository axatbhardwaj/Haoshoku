/**
 * Skill Manager - Runtime git cloning for Claude skills
 *
 * Manages skill sources via runtime git clone to support npm global install.
 * npm packages don't include git submodules, so skills must be cloned at
 * runtime. Clones skills to XDG cache and symlinks to ~/.claude/skills/
 * with user skills taking priority over community skills.
 *
 * Flow:
 * 1. Read ~/.haoshoku.json for skill sources
 * 2. Clone/pull each source to cache (XDG_CACHE_HOME/haoshoku/)
 * 3. Merge skills to ~/.claude/skills/ (user source first = priority)
 * 4. Log sources and any conflicts
 */
import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { log } from "../common/utils.js";

const HOME = homedir();
const XDG_CACHE_HOME = process.env.XDG_CACHE_HOME || path.join(HOME, ".cache");
export const CACHE_DIR = path.join(XDG_CACHE_HOME, "haoshoku");
const CLAUDE_SKILLS_DIR = path.join(HOME, ".claude", "skills");
const CLAUDE_AGENTS_DIR = path.join(HOME, ".claude", "agents");
const AGENTS_SKILLS_DIR = path.join(HOME, ".agents", "skills");
const CONFIG_PATH = path.join(HOME, ".haoshoku.json");

const DEFAULT_CONFIG = {
	skillSources: [],
};

/**
 * Check if path exists (works for broken symlinks).
 * lstatSync detects broken symlinks (existsSync returns false for them).
 * Broken symlinks must be detected for cleanup.
 */
function pathExists(p) {
	try {
		fs.lstatSync(p);
		return true;
	} catch {
		return false;
	}
}

/** Check if git is installed on the system. */
function checkGitInstalled() {
	try {
		const result = Bun.spawnSync(["git", "--version"]);
		return result.exitCode === 0;
	} catch {
		return false;
	}
}

/** Parse git URL into {owner, repo} or null if invalid. */
function parseGitUrl(url) {
	if (url.startsWith("http://") || url.startsWith("https://")) {
		try {
			const parsed = new URL(url);
			const parts = parsed.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
			if (parts.length >= 2) {
				return { owner: parts[parts.length - 2], repo: parts[parts.length - 1] };
			}
		} catch {
			return null;
		}
	} else if (url.startsWith("git@")) {
		const match = url.match(/git@[^:]+:([^/]+)\/(.+?)(\.git)?$/);
		if (match) {
			return { owner: match[1], repo: match[2] };
		}
	}
	return null;
}

/**
 * Extract repo name from git URL for cache directory naming.
 * Returns format: owner-repo (e.g., axatbhardwaj-claude-skills).
 */
export function getRepoName(url) {
	const parsed = parseGitUrl(url);
	if (!parsed) {
		return null;
	}
	return `${parsed.owner}-${parsed.repo}`;
}

/** Create default config with empty skill sources. */
function createDefaultConfig(configPath = CONFIG_PATH) {
	log.info("Creating default skill configuration...");
	log.info(`Config file: ${configPath}`);
	log.info(
		`To add skill sources: edit ${configPath} and add git repo URLs to skillSources array`
	);

	fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
	return DEFAULT_CONFIG;
}

/**
 * Handle config loading errors with specific recovery strategies.
 * Catches only SyntaxError (malformed JSON) - filesystem errors propagate
 * naturally for actionable error messages.
 */
function handleConfigError(error, configPath = CONFIG_PATH) {
	if (error instanceof SyntaxError) {
		log.warning(`Invalid JSON in ${configPath}, using defaults`);
		return DEFAULT_CONFIG;
	}
	if (error.code === "EACCES" || error.code === "ENOENT") {
		log.error(`Cannot read config file at ${configPath}: ${error.message}`);
		return DEFAULT_CONFIG;
	}
	throw error;
}

/**
 * Read config file, return default config if missing/invalid.
 * configPath defaults to ~/.haoshoku.json; tests inject a tmp path.
 * Soft validation: if schema is wrong (missing skillSources array), fallback
 * to defaults for forward compatibility.
 */
export function loadConfig(configPath = CONFIG_PATH) {
	if (!fs.existsSync(configPath)) {
		return createDefaultConfig(configPath);
	}

	try {
		const content = fs.readFileSync(configPath, "utf-8");
		const config = JSON.parse(content);

		if (!Array.isArray(config.skillSources)) {
			log.warning(`Config schema invalid in ${configPath}, using defaults`);
			return DEFAULT_CONFIG;
		}

		return config;
	} catch (error) {
		return handleConfigError(error, configPath);
	}
}

/**
 * Create cache directory with user-only permissions.
 * Mode 0o700: cached skills may contain sensitive paths (principle of least privilege).
 * Exits on fatal errors (cache dir is prerequisite for all operations).
 */
export function ensureCacheDir(cacheDir = CACHE_DIR) {
	if (!fs.existsSync(cacheDir)) {
		try {
			fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
		} catch (error) {
			if (error.code === "ENOTDIR") {
				log.error(
					`Cannot create cache directory at ${cacheDir}: path exists as regular file. Remove the file or set XDG_CACHE_HOME to a different location.`
				);
				process.exit(1);
			}
			throw error;
		}
	}
}

/**
 * Clone repo to cache directory.
 * Uses --depth 1 (shallow clone) to reduce bandwidth and disk usage - full
 * history not needed for skills.
 */
function cloneRepo(url, repoPath) {
	log.info(`Cloning ${url}...`);
	const cloneResult = Bun.spawnSync([
		"git",
		"clone",
		"--depth",
		"1",
		url,
		repoPath,
	]);

	if (cloneResult.exitCode !== 0) {
		log.error(`Failed to clone ${url} (exit code ${cloneResult.exitCode})`);
		return null;
	}

	log.success(`Cloned to ${repoPath}`);
	return repoPath;
}

/**
 * Resolve the default branch name of origin for a cloned repo.
 * Strategy:
 *   1. git rev-parse --abbrev-ref origin/HEAD  (fast, works if already fetched)
 *   2. git remote set-head origin --auto        (network call, sets it)
 *   3. retry rev-parse
 *   4. fallback "main"
 * Strips the leading "origin/" prefix from the ref name.
 * Never throws — callers rely on a usable fallback.
 */
export function resolveDefaultBranch(repoPath) {
	const parseHead = () => {
		const result = Bun.spawnSync(
			["git", "rev-parse", "--abbrev-ref", "origin/HEAD"],
			{ cwd: repoPath },
		);
		if (result.exitCode !== 0) return null;
		const raw = new TextDecoder().decode(result.stdout).trim();
		if (!raw || raw === "origin/HEAD") return null;
		return raw.replace(/^origin\//, "");
	};

	try {
		const branch = parseHead();
		if (branch) return branch;

		// origin/HEAD not set yet — auto-detect it
		Bun.spawnSync(["git", "remote", "set-head", "origin", "--auto"], {
			cwd: repoPath,
		});

		const retried = parseHead();
		return retried ?? "main";
	} catch {
		return "main";
	}
}

/**
 * Update existing repo in cache.
 * fetch+reset handles shallow clones and force-push scenarios (pull fails for
 * shallow repos). If update fails, keeps stale cache to preserve offline operation.
 * Dynamically resolves the default branch instead of hardcoding "main".
 */
function updateRepo(repoPath, url, repoName) {
	log.info(`Updating ${repoName}...`);

	const branch = resolveDefaultBranch(repoPath);

	const fetchResult = Bun.spawnSync(["git", "fetch", "origin", branch], {
		cwd: repoPath,
	});

	if (fetchResult.exitCode !== 0) {
		log.warning(`Failed to fetch ${url}, keeping stale cache`);
		return repoPath;
	}

	const resetResult = Bun.spawnSync(
		["git", "reset", "--hard", `origin/${branch}`],
		{ cwd: repoPath },
	);

	if (resetResult.exitCode !== 0) {
		log.warning(`Failed to reset ${url}, keeping stale cache`);
		return repoPath;
	}

	log.success(`Updated ${repoName}`);
	return repoPath;
}

/** Ensure git is installed, show actionable error if missing. */
function ensureGit() {
	if (!checkGitInstalled()) {
		log.error("git is not installed. Install git using your package manager.");
		return false;
	}
	return true;
}

/** Validate URL and return repo path info, or null if invalid. */
function getValidatedRepoPath(url, cacheDir = CACHE_DIR) {
	const repoName = getRepoName(url);
	if (!repoName) {
		log.error(
			`Invalid skill source URL: ${url}. Expected format: https://github.com/owner/repo or git@github.com:owner/repo`
		);
		return null;
	}
	return { repoName, repoPath: path.join(cacheDir, repoName) };
}

/**
 * Clone repo if not in cache, optionally pull if exists and update=true.
 * Returns null on failure to allow partial success when multiple sources
 * configured.
 */
export function cloneOrPullRepo(url, update = false, cacheDir = CACHE_DIR) {
	if (!ensureGit()) {
		return null;
	}

	const validated = getValidatedRepoPath(url, cacheDir);
	if (!validated) {
		return null;
	}

	const { repoName, repoPath } = validated;

	if (!fs.existsSync(repoPath)) {
		return cloneRepo(url, repoPath);
	}

	if (update) {
		return updateRepo(repoPath, url, repoName);
	}

	return repoPath;
}

/**
 * Check if entry is a valid skill, return skill object or null.
 * Directory is a skill if it contains SKILL.md (explicit marker prevents false
 * positives from doc/asset directories).
 */
function isValidSkill(entry, skillsPath) {
	if (!entry.isDirectory()) {
		return null;
	}

	const skillMdPath = path.join(skillsPath, entry.name, "SKILL.md");
	if (fs.existsSync(skillMdPath) && fs.statSync(skillMdPath).isFile()) {
		return {
			name: entry.name,
			path: path.join(skillsPath, entry.name),
		};
	}

	return null;
}

/** List skill directories in a cached repo (directory must contain SKILL.md). */
export function listSkills(cacheDir) {
	if (!fs.existsSync(cacheDir)) {
		return [];
	}

	const skillsPath = path.join(cacheDir, "skills");
	if (!fs.existsSync(skillsPath)) {
		return [];
	}

	const entries = fs.readdirSync(skillsPath, { withFileTypes: true });
	return entries.map((entry) => isValidSkill(entry, skillsPath)).filter(Boolean);
}

/**
 * Ensure skills directory exists.
 * Exits on fatal errors (skills dir is prerequisite for symlink operations).
 */
function ensureSkillsDir(skillsDir = CLAUDE_SKILLS_DIR) {
	if (!fs.existsSync(skillsDir)) {
		try {
			fs.mkdirSync(skillsDir, { recursive: true });
		} catch (error) {
			if (error.code === "EACCES" || error.code === "ENOTDIR") {
				log.error(
					`Cannot create ${skillsDir}: ${error.message}. Check permissions.`,
				);
				process.exit(1);
			}
			throw error;
		}
	}
}

/**
 * Check if symlink needs update, removing invalid symlink if needed.
 * Returns true if link already points to correct target (idempotent check).
 * Removes and returns false if link points elsewhere (caller will recreate).
 */
function updateSymlinkIfNeeded(destPath, targetPath) {
	try {
		const stats = fs.lstatSync(destPath);
		if (stats.isSymbolicLink()) {
			const currentTarget = fs.readlinkSync(destPath);
			if (currentTarget === targetPath) {
				return true;
			}
			fs.unlinkSync(destPath);
		}
		return false;
	} catch (error) {
		if (error.code === "ENOENT" || error.code === "EACCES") {
			return false;
		}
		throw error;
	}
}

/** Create symlink for skill with actionable error messages. */
function createSymlinkForSkill(skill, source, destPath) {
	try {
		fs.symlinkSync(skill.path, destPath);
		log.info(`Symlinked ${skill.name} from ${source.name}`);
		return true;
	} catch (error) {
		if (error.code === "ENOENT") {
			log.error(`Cannot create symlink for ${skill.name}: source path disappeared: ${skill.path}`);
			return false;
		}
		if (error.code === "EEXIST") {
			if (updateSymlinkIfNeeded(destPath, skill.path)) {
				return true;
			}
			log.error(
				`Cannot create symlink for skill ${skill.name}: regular file exists at ${destPath}. Source: ${source.url}. Move or remove the existing file.`
			);
		} else {
			log.error(`Error creating symlink for ${skill.name}: ${error.message}`);
		}
		return false;
	}
}

/**
 * Process single skill symlink creation.
 * Enforces priority: first occurrence of skill name wins (seenSkills Set).
 * Sources are processed in priority order (user first, then community).
 */
function processSkill(skill, source, seenSkills, skillsDir = CLAUDE_SKILLS_DIR) {
	if (seenSkills.has(skill.name)) {
		return false;
	}

	const destPath = path.join(skillsDir, skill.name);

	if (pathExists(destPath) && updateSymlinkIfNeeded(destPath, skill.path)) {
		seenSkills.add(skill.name);
		return true;
	}

	if (createSymlinkForSkill(skill, source, destPath)) {
		seenSkills.add(skill.name);
		return true;
	}

	return false;
}

/**
 * Symlink a shared resource (directory or file) if not already linked.
 * Safe-backup policy:
 *   - If destPath is a symlink → unlink and relink (idempotent, no backup needed).
 *   - If destPath is a real file or directory → rename to destPath.bak (removing
 *     any stale destPath.bak first) then symlink. Logs a warning so the user knows
 *     their data was moved rather than deleted.
 * Returns true if symlink was created, false if source doesn't exist.
 */
function symlinkSharedResource(srcPath, destPath, isDir, sourceName) {
	if (!fs.existsSync(srcPath)) {
		return false;
	}

	if (pathExists(destPath)) {
		let stat;
		try {
			stat = fs.lstatSync(destPath);
		} catch {
			stat = null;
		}

		if (stat?.isSymbolicLink()) {
			// Already a symlink — just unlink and re-create below.
			fs.unlinkSync(destPath);
		} else {
			// Real file or directory — back it up rather than destroying it.
			const bakPath = `${destPath}.bak`;
			// Remove any stale .bak first so renameSync doesn't fail on
			// non-empty directory or existing file.
			if (pathExists(bakPath)) {
				fs.rmSync(bakPath, { recursive: true, force: true });
			}
			fs.renameSync(destPath, bakPath);
			log.warning(
				`moved existing ${path.basename(destPath)} to ${path.basename(bakPath)} — replaced by symlink from ${sourceName}`,
			);
		}
	}

	fs.symlinkSync(srcPath, destPath);
	const name = path.basename(srcPath);
	log.info(`Symlinked ${name}${isDir ? "/" : ""} from ${sourceName}`);
	return true;
}

/**
 * Symlink skills to ~/.claude/skills/ with priority order.
 * Sources are processed in array order - user skills first (higher priority).
 *
 * Symlinks-only invariant: Never copy skills. Symlinks maintain single source of
 * truth - cache updates immediately visible to Claude Code without re-sync.
 *
 * opts.skillsDir — override the destination directory (default: CLAUDE_SKILLS_DIR).
 * Injected by tests to avoid touching the real ~/.claude/skills/.
 */
export function mergeSkills(sources, opts = {}) {
	const skillsDir = opts.skillsDir ?? CLAUDE_SKILLS_DIR;
	ensureSkillsDir(skillsDir);
	const seenSkills = new Set();
	const linked = { scripts: false, claudeMd: false, readmeMd: false };

	for (const source of sources) {
		const skillsRoot = path.join(source.cachePath, "skills");

		if (!linked.scripts) {
			const src = path.join(skillsRoot, "scripts");
			const dest = path.join(skillsDir, "scripts");
			linked.scripts = symlinkSharedResource(src, dest, true, source.name);
		}

		if (!linked.claudeMd) {
			const src = path.join(skillsRoot, "CLAUDE.md");
			const dest = path.join(skillsDir, "CLAUDE.md");
			linked.claudeMd = symlinkSharedResource(src, dest, false, source.name);
		}

		if (!linked.readmeMd) {
			const src = path.join(skillsRoot, "README.md");
			const dest = path.join(skillsDir, "README.md");
			linked.readmeMd = symlinkSharedResource(src, dest, false, source.name);
		}

		const skills = listSkills(source.cachePath);
		for (const skill of skills) {
			processSkill(skill, source, seenSkills, skillsDir);
		}
	}

	log.success(`Merged ${seenSkills.size} skills to ${skillsDir}`);
}

/**
 * Symlink agent .md files to ~/.claude/agents/ with priority order.
 * Same first-source-wins semantics as mergeSkills: earlier sources in
 * the array take priority when multiple sources provide the same agent name.
 */
export function mergeAgents(sources) {
	// Replace old whole-directory symlink (from configure_claude) with real dir
	if (pathExists(CLAUDE_AGENTS_DIR)) {
		try {
			const stats = fs.lstatSync(CLAUDE_AGENTS_DIR);
			if (stats.isSymbolicLink()) {
				fs.unlinkSync(CLAUDE_AGENTS_DIR);
			}
		} catch {}
	}

	if (!fs.existsSync(CLAUDE_AGENTS_DIR)) {
		fs.mkdirSync(CLAUDE_AGENTS_DIR, { recursive: true });
	}

	const seenAgents = new Set();

	for (const source of sources) {
		const agentsDir = path.join(source.cachePath, "agents");
		if (!fs.existsSync(agentsDir)) continue;

		const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
			if (seenAgents.has(entry.name)) continue;

			const srcPath = path.join(agentsDir, entry.name);
			const destPath = path.join(CLAUDE_AGENTS_DIR, entry.name);

			if (pathExists(destPath) && updateSymlinkIfNeeded(destPath, srcPath)) {
				seenAgents.add(entry.name);
				continue;
			}

			try {
				fs.symlinkSync(srcPath, destPath);
				log.info(`Symlinked agent ${entry.name} from ${source.name}`);
				seenAgents.add(entry.name);
			} catch (error) {
				log.error(`Failed to symlink agent ${entry.name}: ${error.message}`);
			}
		}
	}

	log.success(`Merged ${seenAgents.size} agents to ${CLAUDE_AGENTS_DIR}`);
}

/**
 * Collect sources from config.
 * Continues on individual source failures to allow partial success.
 */
function collectSources(config, update, cacheDir = CACHE_DIR) {
	const sources = [];
	for (const url of config.skillSources) {
		const cachePath = cloneOrPullRepo(url, update, cacheDir);
		if (cachePath) {
			sources.push({
				url,
				name: getRepoName(url),
				cachePath,
			});
		}
	}
	return sources;
}

/** Format and print skills for a single source. */
function printSourceSkills(url, repoName, cachePath) {
	if (!fs.existsSync(cachePath)) {
		log.warning(`${repoName}: not cached (run --skills to sync)`);
		return;
	}

	const skills = listSkills(cachePath);
	if (skills.length === 0) {
		log.dim(`${repoName}: no skills found`);
	} else {
		log.success(`${repoName} (${url}):`);
		for (const skill of skills) {
			log.dim(`  - ${skill.name}`);
		}
	}
}

/** Print available skills from all configured sources. */
export function printAvailableSkills() {
	const config = loadConfig();
	log.info("Available skills:");

	for (const url of config.skillSources) {
		const repoName = getRepoName(url);
		if (!repoName) {
			log.error(`Invalid skill source URL: ${url}. Expected format: https://github.com/owner/repo`);
			continue;
		}
		const cachePath = path.join(CACHE_DIR, repoName);
		printSourceSkills(url, repoName, cachePath);
	}
}

/**
 * Main orchestrator: sync skills from configured sources.
 *
 * Returns a status object so callers (e.g. --claude auto-sync) can decide
 * whether to abort or continue. Direct CLI invocations (`--skills`,
 * `--skills-update`) translate non-"ok" statuses into non-zero exit codes
 * in haoshoku.js so shell users still see failures.
 *
 * Status values:
 *   - "ok"          → at least one source synced + skills/agents merged
 *   - "no-sources"  → skillSources array is empty (informational, not failure)
 *   - "all-failed"  → had sources, none could be cloned/updated (error)
 */
export function syncSkills(options = {}) {
	const {
		update = false,
		configPath = CONFIG_PATH,
		cacheDir = CACHE_DIR,
		skillsDir = CLAUDE_SKILLS_DIR,
		agentsSkillsDir = AGENTS_SKILLS_DIR,
	} = options;

	const config = loadConfig(configPath);
	ensureCacheDir(cacheDir);

	if (config.skillSources.length === 0) {
		log.info(
			`No skill sources configured. Edit ${configPath} to add git repo URLs.`
		);
		return { status: "no-sources", merged: 0 };
	}

	const sources = collectSources(config, update, cacheDir);

	if (sources.length === 0) {
		log.error("All configured skill sources failed to sync");
		return { status: "all-failed", merged: 0 };
	}

	mergeSkills(sources, { skillsDir });
	// Codex reads Agent Skills from ~/.agents/skills — mirror the same symlinks
	// there so skills are available to Codex too, not just Claude Code.
	mergeSkills(sources, { skillsDir: agentsSkillsDir });
	mergeAgents(sources);
	return { status: "ok", merged: sources.length };
}
