import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { log, runCommand } from "../common/utils.js";
import { CACHE_DIR } from "./skill_manager.js";

const HOME = homedir();
const CLAUDE_CONFIG_DIR = path.join(HOME, ".claude");
const CLAUDE_JSON_PATH = path.join(HOME, ".claude.json");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CONFIGS_DIR = path.join(PROJECT_ROOT, "configs");
const CUSTOM_CLAUDE_DIR = path.join(CONFIGS_DIR, "claude");

// Runtime clone from skill_manager (solatis/claude-config)
const CLAUDE_CONFIG_CACHE = path.join(CACHE_DIR, "solatis-claude-config");

const CLAUDE_INSTALL_URL = "https://claude.ai/install.sh";

// Directories symlinked from cached clone to ~/.claude/
const SHARED_DIRS = ["output-styles", "conventions"];
const PERSONAL_FILES = [
  { src: "claude.json", dest: CLAUDE_JSON_PATH },
  { src: "settings.json", dest: path.join(CLAUDE_CONFIG_DIR, "settings.json") },
  { src: "CLAUDE.md", dest: path.join(CLAUDE_CONFIG_DIR, "CLAUDE.md") },
];

/** Check if a command exists in PATH. */
function commandExists(cmd) {
  try {
    const result = Bun.spawnSync(["which", cmd]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/** Check if path exists (works for broken symlinks unlike fs.existsSync). */
function pathExists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Replace existing file/dir/symlink at dest with symlink to src. */
function createSymlink(src, dest) {
  if (pathExists(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.symlinkSync(src, dest);
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
  syncSkills({ update: true });
  log.success("Claude config updated.");
}

/** Deploy config to ~/.claude/ (copy personal files, symlink shared dirs from cache). */
export async function syncClaudeConfig() {
  log.info("Syncing Claude Code config...");

  fs.mkdirSync(CLAUDE_CONFIG_DIR, { recursive: true });

  for (const file of PERSONAL_FILES) {
    const srcPath = path.join(CUSTOM_CLAUDE_DIR, file.src);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, file.dest);
      log.info(`Copied ${file.src}`);
    }
  }

  // Symlink agents/conventions/output-styles from cached clone
  for (const dir of SHARED_DIRS) {
    const srcDir = path.join(CLAUDE_CONFIG_CACHE, dir);
    const destDir = path.join(CLAUDE_CONFIG_DIR, dir);
    if (fs.existsSync(srcDir)) {
      createSymlink(srcDir, destDir);
      log.info(`Symlinked ${dir}/`);
    } else {
      log.warning(`${dir}/ not found in cache - run --skills first`);
    }
  }

  log.success("Claude Code config synced.");
}

/** Copy personal files from ~/.claude/ to configs/claude/ for version control. */
export async function backupClaudeConfig() {
  log.info("Backing up Claude Code config...");

  fs.mkdirSync(CUSTOM_CLAUDE_DIR, { recursive: true });

  if (fs.existsSync(CLAUDE_JSON_PATH)) {
    fs.copyFileSync(
      CLAUDE_JSON_PATH,
      path.join(CUSTOM_CLAUDE_DIR, "claude.json"),
    );
    log.info("Backed up ~/.claude.json");
  }

  const settingsPath = path.join(CLAUDE_CONFIG_DIR, "settings.json");
  if (fs.existsSync(settingsPath)) {
    fs.copyFileSync(
      settingsPath,
      path.join(CUSTOM_CLAUDE_DIR, "settings.json"),
    );
    log.info("Backed up settings.json");
  }

  const claudeMdPath = path.join(CLAUDE_CONFIG_DIR, "CLAUDE.md");
  if (fs.existsSync(claudeMdPath)) {
    fs.copyFileSync(claudeMdPath, path.join(CUSTOM_CLAUDE_DIR, "CLAUDE.md"));
    log.info("Backed up CLAUDE.md");
  }

  log.success("Claude Code config backed up to configs/claude/");
}

/** Install Claude Code CLI and deploy config (used by OS setup scripts). */
export async function configureClaude() {
  await installClaude();
  await syncClaudeConfig();
}
