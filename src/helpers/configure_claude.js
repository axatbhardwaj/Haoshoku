import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  log,
  runCommand,
  safeCopyFile,
} from "../common/utils.js";

const HOME = homedir();
const CLAUDE_CONFIG_DIR = path.join(HOME, ".claude");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CONFIGS_DIR = path.join(PROJECT_ROOT, "configs");
const CUSTOM_CLAUDE_DIR = path.join(CONFIGS_DIR, "claude");
const SETTINGS_PATH = path.join(CLAUDE_CONFIG_DIR, "settings.json");
const SUPERPOWERS_PLUGIN_ID = "superpowers@claude-plugins-official";

const CLAUDE_INSTALL_URL = "https://claude.ai/install.sh";

// Exported so tests can assert the manifest is complete (e.g. regression
// guard that statusline-command.sh is never silently dropped).
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
      // safeCopyFile preserves a differing live file as ${dest}.bak before
      // overwriting. Identical content is a no-op so re-runs don't churn .bak.
      safeCopyFile(srcPath, destPath);
      log.info(`Copied ${file.src} to ${liveFile}`);
    } else {
      log.warning(`Missing ${file.src} in source bundle (${srcPath}) — skipped`);
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
  if (!fs.existsSync(settingsPath)) {
    log.error(
      `${settingsPath} not found. Run Claude Code once to create it, then retry.`,
    );
    return;
  }

  log.info("Enabling Superpowers plugin in ~/.claude/settings.json...");
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch (err) {
    log.error(
      `settings.json is not valid JSON (${err?.message ?? err}) — fix it before retrying`,
    );
    return;
  }
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
