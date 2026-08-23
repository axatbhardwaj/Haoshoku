import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { log, runCommand, safeCopyFile } from "../common/utils.js";

const HOME = homedir();

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CONFIGS_DIR = path.join(PROJECT_ROOT, "configs");
const CUSTOM_CLAUDE_DIR = path.join(CONFIGS_DIR, "claude");

const CLAUDE_INSTALL_URL = "https://claude.ai/install.sh";
const GIT_REPOSITORY_ENV_VARS = [
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_CEILING_DIRECTORIES",
	"GIT_COMMON_DIR",
	"GIT_CONFIG",
	"GIT_CONFIG_COUNT",
	"GIT_CONFIG_PARAMETERS",
	"GIT_DIR",
	"GIT_DISCOVERY_ACROSS_FILESYSTEM",
	"GIT_GLOB_PATHSPECS",
	"GIT_GRAFT_FILE",
	"GIT_ICASE_PATHSPECS",
	"GIT_IMPLICIT_WORK_TREE",
	"GIT_INDEX_FILE",
	"GIT_LITERAL_PATHSPECS",
	"GIT_NOGLOB_PATHSPECS",
	"GIT_NO_REPLACE_OBJECTS",
	"GIT_OBJECT_DIRECTORY",
	"GIT_PREFIX",
	"GIT_REPLACE_REF_BASE",
	"GIT_SHALLOW_FILE",
	"GIT_WORK_TREE",
];

// Exported so tests can assert the portable baseline is complete. Each entry is
// copied independently: a user-owned repository at ~/.claude retains ownership
// of its tracked files, while a fresh or untracked home receives the baseline.
//
// ~/.claude.json is deliberately NOT tracked: it is Claude Code runtime
// state (caches, usage stats, per-project session metadata, oauthAccount),
// not reproducible config — backing it up would leak account metadata.
export const PERSONAL_FILES = [
	{ src: "CLAUDE.md" },
	{ src: "statusline-command.sh" },
	// The deny-first ignore makes a tracked ~/.claude safe. It is stored under a
	// .template name because a real .gitignore here would be honoured by git and
	// npm-packlist, silently dropping bundle files from the published package.
	{ src: "gitignore.template", dest: ".gitignore" },
];

/** Resolve where a PERSONAL_FILES entry lives on a given $HOME (inside ~/.claude/). */
function claudeFilePath(filePath, home = HOME) {
	return path.join(home, ".claude", filePath);
}

/** Check if a command exists in PATH (Bun.which — no external `which` binary). */
function commandExists(cmd) {
	return Bun.which(cmd) !== null;
}

/** Copy the current process environment without Git repository overrides. */
function gitQueryEnvironment() {
	const env = { ...process.env };
	for (const variable of GIT_REPOSITORY_ENV_VARS) delete env[variable];
	return env;
}

/** Fail-open check for a destination tracked by a repo rooted at claudeDir. */
function isTrackedByClaudeRepository(claudeDir, filePath) {
	try {
		const env = gitQueryEnvironment();
		const rootQuery = Bun.spawnSync(
			["git", "-C", claudeDir, "rev-parse", "--show-toplevel"],
			{
				env,
				stderr: "ignore",
				stdout: "pipe",
			},
		);
		if (rootQuery.exitCode !== 0) return false;

		const repoRoot = new TextDecoder().decode(rootQuery.stdout).trim();
		if (fs.realpathSync(repoRoot) !== fs.realpathSync(claudeDir)) return false;

		const trackedQuery = Bun.spawnSync(
			["git", "-C", claudeDir, "ls-files", "--error-unmatch", "--", filePath],
			{
				env,
				stderr: "ignore",
				stdout: "ignore",
			},
		);
		return trackedQuery.exitCode === 0;
	} catch {
		return false;
	}
}

/** Install Claude Code CLI if not already present. */
export async function installClaude() {
	if (commandExists("claude")) {
		log.info("Claude Code already installed.");
		return;
	}

	log.info("Installing Claude Code...");
	await runCommand(`curl -fsSL ${CLAUDE_INSTALL_URL} | bash`);
}

/**
 * Deploy config to ~/.claude/ (copy personal files from haoshoku template).
 * Options:
 *   - srcDir:    where to read PERSONAL_FILES from (defaults to bundled configs/claude/)
 *   - claudeHome: which $HOME to write into (defaults to real HOME)
 * Missing source files now warn loudly so an incomplete bundle is visible
 * (previously the silent skip masked e.g. statusline-command.sh going missing).
 */
export async function syncClaudeConfig(options = {}) {
	const { srcDir = CUSTOM_CLAUDE_DIR, claudeHome = HOME } = options;
	const claudeDir = path.join(claudeHome, ".claude");

	log.info("Syncing Claude Code config...");

	fs.mkdirSync(claudeDir, { recursive: true });

	for (const file of PERSONAL_FILES) {
		const srcPath = path.join(srcDir, file.src);
		const liveFile = file.dest ?? file.src;
		const destPath = claudeFilePath(liveFile, claudeHome);
		if (fs.existsSync(srcPath)) {
			if (isTrackedByClaudeRepository(claudeDir, liveFile)) {
				log.info(
					`Skipped ${liveFile}: tracked by the git repository at the Claude home. Recover a missing file with: git -C ${JSON.stringify(claudeDir)} restore -- ${JSON.stringify(liveFile)}`,
				);
			} else {
				fs.mkdirSync(path.dirname(destPath), { recursive: true });
				safeCopyFile(srcPath, destPath);
				log.info(`Copied ${file.src} to ${liveFile}`);
			}
		} else {
			log.warning(
				`Missing ${file.src} in source bundle (${srcPath}) — skipped`,
			);
		}
	}

	log.success("Claude Code config synced.");
}

/** Find the first literal absolute home path in file contents. */
function findAbsoluteHomePath(content) {
	const lines = content.toString("utf-8").split(/\r?\n/);
	for (const [index, line] of lines.entries()) {
		const matchedPath = line.match(/\/(?:home|Users)\/[^\s"'`<>)]*/)?.[0];
		if (matchedPath) {
			return {
				line: line.trim(),
				lineNumber: index + 1,
				matchedPath,
			};
		}
	}
	return null;
}

/** Copy one live Claude file into the bundle unless its contents leak a home path. */
function backupClaudeFile(srcPath, destPath, summary) {
	const content = fs.readFileSync(srcPath);
	const absoluteHomePath = findAbsoluteHomePath(content);
	if (absoluteHomePath) {
		summary.refused += 1;
		log.warning(
			`REFUSED Claude backup for ${srcPath}: ${absoluteHomePath.matchedPath} on line ${absoluteHomePath.lineNumber}: ${absoluteHomePath.line}`,
		);
		return false;
	}

	fs.mkdirSync(path.dirname(destPath), { recursive: true });
	fs.copyFileSync(srcPath, destPath);
	summary.backedUp += 1;
	return true;
}

/**
 * Copy personal files from ~/.claude/ to configs/claude/ for version control.
 * Same options as syncClaudeConfig, in reverse direction.
 */
export async function backupClaudeConfig(options = {}) {
	const { srcDir = CUSTOM_CLAUDE_DIR, claudeHome = HOME } = options;
	const summary = { backedUp: 0, refused: 0 };

	log.info("Backing up Claude Code config...");

	fs.mkdirSync(srcDir, { recursive: true });

	for (const file of PERSONAL_FILES) {
		const liveFile = file.dest ?? file.src;
		const livePath = claudeFilePath(liveFile, claudeHome);
		if (fs.existsSync(livePath)) {
			if (backupClaudeFile(livePath, path.join(srcDir, file.src), summary)) {
				log.info(`Backed up ${liveFile} to ${file.src}`);
			}
		}
	}

	log.success(
		`Claude backup summary: backed-up=${summary.backedUp}, refused=${summary.refused}`,
	);
	log.success("Claude Code config backed up to configs/claude/");
	return summary;
}

/** Install Claude Code CLI and deploy config (used by OS setup scripts). */
export async function configureClaude() {
	await installClaude();
	await syncClaudeConfig();
}
