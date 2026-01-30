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
const CONFIG_PATH = path.join(HOME, ".haoshoku.json");

const DEFAULT_CONFIG = {
	skillSources: ["https://github.com/solatis/claude-config.git"],
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

/** Validate and parse git URL, return null if invalid. */
function validateGitUrl(url) {
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
 * Returns format: owner-repo (e.g., solatis-claude-config).
 */
export function getRepoName(url) {
	const parsed = validateGitUrl(url);
	if (!parsed) {
		return null;
	}
	return `${parsed.owner}-${parsed.repo}`;
}

/** Create default config with solatis/claude-config as community baseline. */
function createDefaultConfig() {
	log.info("Creating default skill configuration...");
	log.info(`Config file: ${CONFIG_PATH}`);
	log.info("Default source: solatis/claude-config (community skills)");
	log.info(
		`To add your own skills: edit ${CONFIG_PATH} and add your git repo URL to skillSources array`
	);

	fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
	return DEFAULT_CONFIG;
}

/**
 * Handle config loading errors with specific recovery strategies.
 * Catches only SyntaxError (malformed JSON) - filesystem errors propagate
 * naturally for actionable error messages.
 */
function handleConfigError(error) {
	if (error instanceof SyntaxError) {
		log.warning(`Invalid JSON in ${CONFIG_PATH}, using defaults`);
		return DEFAULT_CONFIG;
	}
	if (error.code === "EACCES" || error.code === "ENOENT") {
		log.error(`Cannot read config file at ${CONFIG_PATH}: ${error.message}`);
		return DEFAULT_CONFIG;
	}
	throw error;
}

/**
 * Read ~/.haoshoku.json, return default config if missing/invalid.
 * Soft validation: if schema is wrong (missing skillSources array), fallback
 * to defaults for forward compatibility.
 */
export function loadConfig() {
	if (!fs.existsSync(CONFIG_PATH)) {
		return createDefaultConfig();
	}

	try {
		const content = fs.readFileSync(CONFIG_PATH, "utf-8");
		const config = JSON.parse(content);

		if (!Array.isArray(config.skillSources)) {
			log.warning(`Config schema invalid in ${CONFIG_PATH}, using defaults`);
			return DEFAULT_CONFIG;
		}

		return config;
	} catch (error) {
		return handleConfigError(error);
	}
}

/**
 * Create cache directory with user-only permissions.
 * Mode 0o700: cached skills may contain sensitive paths (principle of least privilege).
 * Exits on fatal errors (cache dir is prerequisite for all operations).
 */
export function ensureCacheDir() {
	if (!fs.existsSync(CACHE_DIR)) {
		try {
			fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
		} catch (error) {
			if (error.code === "ENOTDIR") {
				log.error(
					`Cannot create cache directory at ${CACHE_DIR}: path exists as regular file. Remove the file or set XDG_CACHE_HOME to a different location.`
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
 * Update existing repo in cache.
 * fetch+reset handles shallow clones and force-push scenarios (pull fails for
 * shallow repos). If update fails, keeps stale cache to preserve offline operation.
 */
function updateRepo(repoPath, url, repoName) {
	log.info(`Updating ${repoName}...`);

	const fetchResult = Bun.spawnSync(["git", "fetch", "origin", "main"], {
		cwd: repoPath,
	});

	if (fetchResult.exitCode !== 0) {
		log.warning(`Failed to fetch ${url}, keeping stale cache`);
		return repoPath;
	}

	const resetResult = Bun.spawnSync(
		["git", "reset", "--hard", "origin/main"],
		{ cwd: repoPath }
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
function getValidatedRepoPath(url) {
	const repoName = getRepoName(url);
	if (!repoName) {
		log.error(
			`Invalid skill source URL: ${url}. Expected format: https://github.com/owner/repo or git@github.com:owner/repo`
		);
		return null;
	}
	return { repoName, repoPath: path.join(CACHE_DIR, repoName) };
}

/**
 * Clone repo if not in cache, optionally pull if exists and update=true.
 * Returns null on failure to allow partial success when multiple sources
 * configured.
 */
export function cloneOrPullRepo(url, update = false) {
	if (!ensureGit()) {
		return null;
	}

	const validated = getValidatedRepoPath(url);
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
function ensureSkillsDir() {
	if (!fs.existsSync(CLAUDE_SKILLS_DIR)) {
		try {
			fs.mkdirSync(CLAUDE_SKILLS_DIR, { recursive: true });
		} catch (error) {
			if (error.code === "EACCES" || error.code === "ENOTDIR") {
				log.error(
					`Cannot create ${CLAUDE_SKILLS_DIR}: ${error.message}. Check permissions.`
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
function processSkill(skill, source, seenSkills) {
	if (seenSkills.has(skill.name)) {
		return false;
	}

	const destPath = path.join(CLAUDE_SKILLS_DIR, skill.name);

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
 * Returns true if symlink was created, false if source doesn't exist.
 */
function symlinkSharedResource(srcPath, destPath, isDir, sourceName) {
	if (!fs.existsSync(srcPath)) {
		return false;
	}

	if (pathExists(destPath)) {
		fs.rmSync(destPath, { recursive: isDir, force: true });
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
 */
export function mergeSkills(sources) {
	ensureSkillsDir();
	const seenSkills = new Set();
	const linked = { scripts: false, claudeMd: false, readmeMd: false };

	for (const source of sources) {
		const skillsRoot = path.join(source.cachePath, "skills");

		if (!linked.scripts) {
			const src = path.join(skillsRoot, "scripts");
			const dest = path.join(CLAUDE_SKILLS_DIR, "scripts");
			linked.scripts = symlinkSharedResource(src, dest, true, source.name);
		}

		if (!linked.claudeMd) {
			const src = path.join(skillsRoot, "CLAUDE.md");
			const dest = path.join(CLAUDE_SKILLS_DIR, "CLAUDE.md");
			linked.claudeMd = symlinkSharedResource(src, dest, false, source.name);
		}

		if (!linked.readmeMd) {
			const src = path.join(skillsRoot, "README.md");
			const dest = path.join(CLAUDE_SKILLS_DIR, "README.md");
			linked.readmeMd = symlinkSharedResource(src, dest, false, source.name);
		}

		const skills = listSkills(source.cachePath);
		for (const skill of skills) {
			processSkill(skill, source, seenSkills);
		}
	}

	log.success(`Merged ${seenSkills.size} skills to ${CLAUDE_SKILLS_DIR}`);
}

/**
 * Collect sources from config.
 * Continues on individual source failures to allow partial success.
 */
function collectSources(config, update) {
	const sources = [];
	for (const url of config.skillSources) {
		const cachePath = cloneOrPullRepo(url, update);
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
 * Uses process.exit(1) on fatal errors for clear CLI exit codes.
 */
export function syncSkills(options = { update: false }) {
	const config = loadConfig();
	ensureCacheDir();

	const sources = collectSources(config, options.update);

	if (sources.length === 0) {
		log.error("All skill sources failed to sync");
		process.exit(1);
	}

	mergeSkills(sources);
}
