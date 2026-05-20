import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { log } from "../common/utils.js";

const HOME_DEFAULT = homedir();
const PROJECT_ROOT_DEFAULT = path.resolve(__dirname, "..", "..");

const TRACKED_FILES = ["hypr-user.conf", "cli.json"];

/**
 * Resolve the live ~/.config/caelestia/ dir and the configs/caelestia/ backup
 * dir from injected home + projectRoot (defaults to real $HOME and the haoshoku
 * project root). Pulled out so tests can swap in temp dirs.
 */
function resolvePaths({ home = HOME_DEFAULT, projectRoot = PROJECT_ROOT_DEFAULT } = {}) {
  return {
    caelestiaConfigDir: path.join(home, ".config", "caelestia"),
    caelestiaBackupDir: path.join(projectRoot, "configs", "caelestia"),
  };
}

/**
 * Deploy versioned Caelestia preferences (hypr-user.conf, cli.json) from
 * configs/caelestia/ into ~/.config/caelestia/. Missing source files are
 * skipped silently — partial sync is intentional, since a user might only
 * version one file.
 */
export async function syncCaelestiaPrefs(opts = {}) {
  const { caelestiaConfigDir, caelestiaBackupDir } = resolvePaths(opts);
  log.info("Syncing Caelestia prefs...");

  fs.mkdirSync(caelestiaConfigDir, { recursive: true });

  for (const file of TRACKED_FILES) {
    const src = path.join(caelestiaBackupDir, file);
    const dest = path.join(caelestiaConfigDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      log.info(`Synced ${file}`);
    }
  }

  log.success("Caelestia prefs synced to ~/.config/caelestia/");
}

/**
 * Snapshot the current ~/.config/caelestia/ preferences into the in-tree
 * configs/caelestia/ backup dir. No sanitization: hypr-user.conf may contain
 * machine-specific monitor lines, but those aren't sensitive — the CLAUDE.md
 * in configs/caelestia/ documents the need to edit them on fresh hardware.
 */
export async function backupCaelestiaPrefs(opts = {}) {
  const { caelestiaConfigDir, caelestiaBackupDir } = resolvePaths(opts);
  log.info("Backing up Caelestia prefs...");

  if (!fs.existsSync(caelestiaConfigDir)) {
    log.warning(`No ~/.config/caelestia/ found at ${caelestiaConfigDir} — nothing to back up`);
    return;
  }

  fs.mkdirSync(caelestiaBackupDir, { recursive: true });

  for (const file of TRACKED_FILES) {
    const src = path.join(caelestiaConfigDir, file);
    const dest = path.join(caelestiaBackupDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      log.info(`Backed up ${file}`);
    }
  }

  log.success("Caelestia prefs backed up to configs/caelestia/");
}

/** Alias used by OS setup flows; mirrors configureZed(). */
export async function configureCaelestiaPrefs(opts = {}) {
  await syncCaelestiaPrefs(opts);
}
