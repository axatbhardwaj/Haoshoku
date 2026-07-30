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

// Co-owned directories: deploy only bundle-listed paths and preserve everything
// else. The same manifest is used by backupClaudeConfig().
export const MERGE_DEPLOY_DIRS = ["agents", "workflows"];

function lstat(pathname) {
  return fs.lstatSync(pathname, { throwIfNoEntry: false });
}

function bundleLabel(directory, relativePath) {
  return path.join(directory, relativePath);
}

function refuseMergeEntry(state, label, reason) {
  state.refused += 1;
  log.error(`refused ${label}: ${reason}`);
}

function containsPath(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function resolveWithExistingAncestor(pathname) {
  let existingPath = path.resolve(pathname);
  const missingSegments = [];

  while (!lstat(existingPath)) {
    const parentPath = path.dirname(existingPath);
    if (parentPath === existingPath) return path.resolve(pathname);
    missingSegments.unshift(path.basename(existingPath));
    existingPath = parentPath;
  }

  try {
    return path.join(fs.realpathSync(existingPath), ...missingSegments);
  } catch {
    return path.resolve(pathname);
  }
}

function ensureExternalBackupRoot(state) {
  if (state.backupRoot) return state.backupRoot;

  const timestamp = new Date().toISOString().replaceAll(":", "-");
  let backupRoot = path.join(state.backupBase, timestamp);
  let suffix = 1;
  while (lstat(backupRoot)) {
    backupRoot = path.join(state.backupBase, `${timestamp}-${suffix}`);
    suffix += 1;
  }
  fs.mkdirSync(backupRoot, { recursive: true });
  state.backupRoot = backupRoot;
  return backupRoot;
}

function backupMergeDestination(
  destPath,
  destStat,
  directory,
  relativePath,
  state,
) {
  const backupRoot = ensureExternalBackupRoot(state);
  const backupPath = path.join(backupRoot, directory, relativePath);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });

  if (destStat.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(destPath), backupPath);
  } else {
    fs.copyFileSync(destPath, backupPath);
  }

  state.backedUp += 1;
  log.info(`backed-up ${bundleLabel(directory, relativePath)} to ${backupPath}`);
}

function copyMergeFile(srcPath, destPath, srcStat) {
  fs.copyFileSync(srcPath, destPath);
  const writtenStat = lstat(destPath);
  if (writtenStat?.isSymbolicLink() || !writtenStat?.isFile()) {
    throw new Error(`refusing to chmod non-file destination ${destPath}`);
  }
  fs.chmodSync(destPath, srcStat.mode & 0o777);
}

function deployMergeFile(
  srcPath,
  destPath,
  srcStat,
  destStat,
  directory,
  relativePath,
  state,
) {
  const label = bundleLabel(directory, relativePath);

  if (destStat?.isDirectory() || (destStat && !destStat.isFile() && !destStat.isSymbolicLink())) {
    refuseMergeEntry(state, label, "bundle file conflicts with a live non-file");
    return;
  }

  if (destStat?.isFile()) {
    const sourceBytes = fs.readFileSync(srcPath);
    const destinationBytes = fs.readFileSync(destPath);
    if (sourceBytes.equals(destinationBytes)) {
      state.unchanged += 1;
      log.info(`unchanged ${label}`);
      return;
    }
    if (destStat.nlink > 1) {
      refuseMergeEntry(
        state,
        label,
        "destination has multiple hard links",
      );
      return;
    }
  }

  if (destStat && !state.backupIsExternal) {
    refuseMergeEntry(
      state,
      label,
      "external backup root would be inside a co-owned live directory",
    );
    return;
  }

  if (destStat) {
    backupMergeDestination(
      destPath,
      destStat,
      directory,
      relativePath,
      state,
    );
  }

  if (destStat?.isSymbolicLink()) {
    fs.unlinkSync(destPath);
  }

  copyMergeFile(srcPath, destPath, srcStat);
  state.deployed += 1;
  log.info(`deployed ${label}`);
}

function deployMergeTree(
  srcDir,
  destDir,
  directory,
  state,
  relativeDir = "",
) {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const relativePath = path.join(relativeDir, entry.name);
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    const srcStat = fs.lstatSync(srcPath);
    const destStat = lstat(destPath);
    const label = bundleLabel(directory, relativePath);

    if (srcStat.isDirectory()) {
      if (destStat && !destStat.isDirectory()) {
        refuseMergeEntry(
          state,
          label,
          "bundle directory conflicts with a live file or symlink",
        );
        continue;
      }
      if (!destStat) {
        fs.mkdirSync(destPath);
      }
      deployMergeTree(srcPath, destPath, directory, state, relativePath);
      continue;
    }

    if (srcStat.isFile()) {
      deployMergeFile(
        srcPath,
        destPath,
        srcStat,
        destStat,
        directory,
        relativePath,
        state,
      );
      continue;
    }

    refuseMergeEntry(state, label, "unsupported bundle entry type");
  }
}

function deployMergeDirectory(srcDir, destDir, directory, state) {
  const destStat = lstat(destDir);
  if (destStat && !destStat.isDirectory()) {
    refuseMergeEntry(
      state,
      `${directory}/`,
      "bundle directory conflicts with a live file or symlink",
    );
    return;
  }
  if (!destStat) {
    fs.mkdirSync(destDir);
  }
  deployMergeTree(srcDir, destDir, directory, state);
}

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
  const stateHome =
    options.stateHome ??
    (claudeHome === HOME && process.env.XDG_STATE_HOME
      ? process.env.XDG_STATE_HOME
      : path.join(claudeHome, ".local", "state"));
  const backupBase = resolveWithExistingAncestor(
    path.join(stateHome, "haoshoku", "backups"),
  );

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

  const mergeState = {
    deployed: 0,
    unchanged: 0,
    backedUp: 0,
    refused: 0,
    backupRoot: null,
    backupBase,
    backupIsExternal: MERGE_DEPLOY_DIRS.every(
      (dir) =>
        !containsPath(
          resolveWithExistingAncestor(path.join(claudeDir, dir)),
          backupBase,
        ),
    ),
  };
  for (const dir of MERGE_DEPLOY_DIRS) {
    const src = path.join(srcDir, dir);
    const dest = path.join(claudeDir, dir);
    const srcStat = lstat(src);
    if (srcStat?.isDirectory()) {
      deployMergeDirectory(src, dest, dir, mergeState);
    } else if (srcStat) {
      refuseMergeEntry(
        mergeState,
        `${dir}/`,
        "merge-deploy source is not a directory",
      );
    } else {
      log.warning(`Missing ${dir}/ in source bundle (${src}) — skipped`);
    }
  }
  const backupSummary = mergeState.backupRoot
    ? `; backup root: ${mergeState.backupRoot}`
    : "";
  log.success(
    `Claude merge-deploy summary: deployed=${mergeState.deployed}, unchanged=${mergeState.unchanged}, backed-up=${mergeState.backedUp}, refused=${mergeState.refused}${backupSummary}`,
  );

  log.success("Claude Code config synced.");
}

/**
 * Copy personal files from ~/.claude/ to configs/claude/ for version control.
 * Same options as syncClaudeConfig, in reverse direction.
 */
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

function backupClaudeDirectory(srcDir, destDir, summary) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isSymbolicLink()) {
      fs.rmSync(destPath, { recursive: true, force: true });
      log.warning(`Skipping symlink during Claude backup (${srcPath})`);
    } else if (entry.isDirectory()) {
      backupClaudeDirectory(srcPath, destPath, summary);
    } else {
      backupClaudeFile(srcPath, destPath, summary);
    }
  }
}

export async function backupClaudeConfig(options = {}) {
  const { srcDir = CUSTOM_CLAUDE_DIR, claudeHome = HOME } = options;
  const claudeDir = path.join(claudeHome, ".claude");
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

  for (const dir of MERGE_DEPLOY_DIRS) {
    const src = path.join(claudeDir, dir);
    const dest = path.join(srcDir, dir);
    if (fs.existsSync(src)) {
      backupClaudeDirectory(src, dest, summary);
      log.info(`Backed up ${dir}/`);
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
