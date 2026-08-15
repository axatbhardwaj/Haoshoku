import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { log, runCommand, safeCopyFile } from "../common/utils.js";

const HOME = homedir();
const CLAUDE_CONFIG_DIR = path.join(HOME, ".claude");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CONFIGS_DIR = path.join(PROJECT_ROOT, "configs");
const CUSTOM_CLAUDE_DIR = path.join(CONFIGS_DIR, "claude");
const SETTINGS_PATH = path.join(CLAUDE_CONFIG_DIR, "settings.json");
const HAOSHOKU_CONFIG_PATH = path.join(HOME, ".haoshoku.json");
const SUPERPOWERS_PLUGIN_ID = "superpowers@claude-plugins-official";

const CLAUDE_INSTALL_URL = "https://claude.ai/install.sh";
export const DEFAULT_CLAUDE_BOOTSTRAP_URL =
	"git@github.com:axatbhardwaj/claude-policy.git";
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

// Exported so tests can assert the public fallback is complete. Each entry is
// copied independently: a private Claude repository retains ownership of its
// tracked files, while a fresh or untracked home receives the public runtime.
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
	{ src: "agents/sol-wrapper.md" },
	{ src: "agents/luna-wrapper.md" },
	{ src: "agents/opencode-wrapper.md" },
	{ src: "agents/grok-wrapper.md" },
	{ src: "agents/madhyastha.md" },
	{ src: "agents/anveshaka.md" },
	{ src: "agents/fable-planner.md" },
	{ src: "agents/opus-reviewer.md" },
	{ src: "agents/run-codex-task.sh" },
	{ src: "agents/run-opencode-seat.sh" },
	{ src: "agents/validate-codex-wrapper.sh" },
	{ src: "agents/codex-result.schema.json" },
	{ src: "agents/prepare-pr-review-render-workspace.sh" },
	{ src: "skills/discovering-work/SKILL.md" },
	{ src: "skills/discovering-work/agents/openai.yaml" },
	{ src: "skills/implement-work/SKILL.md" },
	{ src: "skills/review-pr/SKILL.md" },
	{ src: "skills/create-pr/SKILL.md" },
	{ src: "skills/brainstorm/SKILL.md" },
	{ src: "skills/babysit-pr/SKILL.md" },
	{ src: "skills/linear-ticketing/SKILL.md" },
	{ src: "skills/html-explainer/SKILL.md" },
	{ src: "skills/html-explainer/template.html" },
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

/** Run one git command without inherited repository overrides. */
async function runBootstrapGit(args, options = {}) {
	const stdoutMode = options.stdout ?? "ignore";
	const proc = Bun.spawn(["git", ...args], {
		env: gitQueryEnvironment(),
		stderr: options.stderr ?? "ignore",
		stdout: stdoutMode,
	});
	const stdout =
		stdoutMode === "pipe"
			? new Response(proc.stdout).text()
			: Promise.resolve("");
	const exitCode = await proc.exited;
	return {
		exitCode,
		stdout: (await stdout).trim(),
	};
}

/** Read the optional private-policy URL without creating or changing config. */
function readClaudeBootstrapUrl(configPath) {
	if (!fs.existsSync(configPath)) return DEFAULT_CLAUDE_BOOTSTRAP_URL;

	try {
		const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
		return typeof config.claudeBootstrapUrl === "string" &&
			config.claudeBootstrapUrl.trim()
			? config.claudeBootstrapUrl.trim()
			: DEFAULT_CLAUDE_BOOTSTRAP_URL;
	} catch (error) {
		log.warning(
			`Invalid JSON in ${configPath}, using the default Claude bootstrap URL (${error.message})`,
		);
		return DEFAULT_CLAUDE_BOOTSTRAP_URL;
	}
}

function isSuperpowersEnabled(settingsPath) {
	if (!fs.existsSync(settingsPath)) return false;

	try {
		const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
		return settings?.enabledPlugins?.[SUPERPOWERS_PLUGIN_ID] === true;
	} catch {
		return false;
	}
}

/** Bootstrap the configured private policy repository in ~/.claude/. */
export async function bootstrapClaudePolicy(options = {}) {
	const {
		claudeHome = HOME,
		configPath = HAOSHOKU_CONFIG_PATH,
		strict = true,
	} = options;
	const claudeDir = path.join(claudeHome, ".claude");
	const settingsPath = path.join(claudeDir, "settings.json");
	const preserveSuperpowers = isSuperpowersEnabled(settingsPath);
	const url = readClaudeBootstrapUrl(configPath);

	let reachable;
	try {
		reachable = await runBootstrapGit(["ls-remote", url]);
	} catch {
		reachable = { exitCode: 1 };
	}
	if (reachable.exitCode !== 0) {
		log.error(
			`Unable to reach the Claude policy repository. Authentication is the likely cause. Consider checking your git credentials and retrying.`,
		);
		if (strict) process.exitCode = 1;
		return false;
	}

	fs.mkdirSync(claudeDir, { recursive: true });

	const init = await runBootstrapGit(["-C", claudeDir, "init"]);
	if (init.exitCode !== 0)
		throw new Error("Failed to initialize ~/.claude as git");

	const origin = await runBootstrapGit([
		"-C",
		claudeDir,
		"remote",
		"get-url",
		"origin",
	]);
	const remoteCommand = origin.exitCode === 0 ? "set-url" : "add";
	const configuredOrigin = await runBootstrapGit([
		"-C",
		claudeDir,
		"remote",
		remoteCommand,
		"origin",
		url,
	]);
	if (configuredOrigin.exitCode !== 0) {
		throw new Error("Failed to configure the Claude policy origin remote");
	}

	const fetch = await runBootstrapGit([
		"-C",
		claudeDir,
		"fetch",
		"--prune",
		"origin",
	]);
	if (fetch.exitCode !== 0) throw new Error("Failed to fetch Claude policy");

	const setHead = await runBootstrapGit([
		"-C",
		claudeDir,
		"remote",
		"set-head",
		"origin",
		"--auto",
	]);
	if (setHead.exitCode !== 0) {
		throw new Error("Failed to resolve the Claude policy default branch");
	}

	const defaultBranch = await runBootstrapGit(
		["-C", claudeDir, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
		{ stdout: "pipe" },
	);
	const branch = defaultBranch.stdout.replace(/^origin\//, "");
	if (defaultBranch.exitCode !== 0 || !branch) {
		throw new Error("Failed to read the Claude policy default branch");
	}

	const checkout = await runBootstrapGit([
		"-C",
		claudeDir,
		"checkout",
		"-f",
		"-B",
		branch,
		`origin/${branch}`,
	]);

	if (preserveSuperpowers) {
		try {
			await installSuperpowers(settingsPath);
		} catch (error) {
			log.error(
				`Claude policy bootstrap replaced the Superpowers registration and could not restore it (${error?.message ?? error}).`,
			);
		}
		if (!isSuperpowersEnabled(settingsPath)) {
			log.error(
				"Claude policy bootstrap removed the existing Superpowers registration and could not restore it. Fix ~/.claude/settings.json, then rerun: haoshoku --superpowers",
			);
			if (strict) process.exitCode = 1;
			return false;
		}
	}

	if (checkout.exitCode !== 0) {
		throw new Error(`Failed to check out Claude policy branch ${branch}`);
	}

	log.success(`Claude policy bootstrapped from ${url} on branch ${branch}.`);
	return true;
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

/** Update cached claude-config by pulling latest (delegates to skill_manager). */
export async function updateClaudeConfig() {
	const { syncSkills } = await import("./skill_manager.js");
	log.info("Updating Claude config from remote...");
	const result = syncSkills({ update: true });
	if (result.status === "ok") {
		log.success("Claude config updated.");
	} else {
		log.warning(
			`Skill update did not complete (${result.status}) — continuing.`,
		);
	}
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

/** Idempotently enable the Superpowers plugin in ~/.claude/settings.json. */
export async function installSuperpowers(settingsPath = SETTINGS_PATH) {
	let settings = {};
	if (fs.existsSync(settingsPath)) {
		try {
			settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
		} catch (err) {
			log.error(
				`settings.json is not valid JSON (${err?.message ?? err}) — fix it before retrying`,
			);
			return;
		}
	} else {
		fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
	}

	if (
		settings === null ||
		typeof settings !== "object" ||
		Array.isArray(settings)
	) {
		log.error(
			`settings.json must be an object (${settingsPath}) — fix it before retrying`,
		);
		return;
	}
	if (
		settings.enabledPlugins !== undefined &&
		(settings.enabledPlugins === null ||
			typeof settings.enabledPlugins !== "object" ||
			Array.isArray(settings.enabledPlugins))
	) {
		log.error(
			`settings.json enabledPlugins must be an object (${settingsPath}) — fix it before retrying`,
		);
		return;
	}

	log.info("Enabling Superpowers plugin in ~/.claude/settings.json...");
	settings.enabledPlugins ??= {};

	if (settings.enabledPlugins[SUPERPOWERS_PLUGIN_ID] === true) {
		log.info("Superpowers plugin already enabled (no change).");
		return;
	}

	settings.enabledPlugins[SUPERPOWERS_PLUGIN_ID] = true;
	fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
	log.success(
		"Superpowers plugin enabled in ~/.claude/settings.json. Restart Claude Code to load it.",
	);
}

/** Install Claude Code CLI and deploy config (used by OS setup scripts). */
export async function configureClaude() {
	await installClaude();
	await syncClaudeConfig();
}
