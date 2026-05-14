import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { log, runCommand, copyDirRecursive } from "../common/utils.js";

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
export const PERSONAL_FILES = [
  { src: "claude.json" },
  { src: "settings.json" },
  { src: "CLAUDE.md" },
  { src: "statusline-command.sh" },
];

// Directories fully owned by haoshoku (replaced on sync)
export const MANAGED_DIRS = ["conventions", "output-styles"];

/**
 * Resolve where a PERSONAL_FILES entry lives on a given $HOME.
 * `claude.json` sits next to ~/.claude/, the rest live inside it.
 */
function claudeFilePath(src, home = HOME) {
  if (src === "claude.json") {
    return path.join(home, ".claude.json");
  }
  return path.join(home, ".claude", src);
}

/** Check if a command exists in PATH. */
function commandExists(cmd) {
  try {
    const result = Bun.spawnSync(["which", cmd]);
    return result.exitCode === 0;
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
    const destPath = claudeFilePath(file.src, claudeHome);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, destPath);
      log.info(`Copied ${file.src}`);
    } else {
      log.warning(`Missing ${file.src} in source bundle (${srcPath}) — skipped`);
    }
  }

  for (const dir of MANAGED_DIRS) {
    const src = path.join(srcDir, dir);
    const dest = path.join(claudeDir, dir);
    if (fs.existsSync(src)) {
      copyDirRecursive(src, dest);
      log.info(`Synced ${dir}/`);
    } else {
      log.warning(`Missing ${dir}/ in source bundle (${src}) — skipped`);
    }
  }

  log.success("Claude Code config synced.");
}

/**
 * Copy personal files from ~/.claude/ to configs/claude/ for version control.
 * Same options as syncClaudeConfig, in reverse direction.
 */
export async function backupClaudeConfig(options = {}) {
  const { srcDir = CUSTOM_CLAUDE_DIR, claudeHome = HOME } = options;
  const claudeDir = path.join(claudeHome, ".claude");

  log.info("Backing up Claude Code config...");

  fs.mkdirSync(srcDir, { recursive: true });

  for (const file of PERSONAL_FILES) {
    const livePath = claudeFilePath(file.src, claudeHome);
    if (fs.existsSync(livePath)) {
      fs.copyFileSync(livePath, path.join(srcDir, file.src));
      log.info(`Backed up ${file.src}`);
    }
  }

  for (const dir of MANAGED_DIRS) {
    const src = path.join(claudeDir, dir);
    const dest = path.join(srcDir, dir);
    if (fs.existsSync(src)) {
      copyDirRecursive(src, dest);
      log.info(`Backed up ${dir}/`);
    }
  }

  log.success("Claude Code config backed up to configs/claude/");
}

/** Idempotently enable the Superpowers plugin in ~/.claude/settings.json. */
export async function installSuperpowers(settingsPath = SETTINGS_PATH) {
  if (!fs.existsSync(settingsPath)) {
    log.error(
      `${settingsPath} not found. Run 'haoshoku --claude' first to deploy the config bundle.`,
    );
    return;
  }

  log.info("Enabling Superpowers plugin in ~/.claude/settings.json...");
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
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
