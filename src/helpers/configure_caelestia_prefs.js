import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { log, readDeviceType, safeCopyFile } from "../common/utils.js";

const HOME_DEFAULT = homedir();
const PROJECT_ROOT_DEFAULT = path.resolve(__dirname, "..", "..");

/**
 * Resolve the live ~/.config/caelestia/ dir and the configs/caelestia/ backup
 * dir from injected home + projectRoot (defaults to real $HOME and the haoshoku
 * project root). Pulled out so tests can swap in temp dirs.
 */
function resolvePaths({ home = HOME_DEFAULT, projectRoot = PROJECT_ROOT_DEFAULT } = {}) {
  return {
    home,
    caelestiaConfigDir: path.join(home, ".config", "caelestia"),
    caelestiaBackupDir: path.join(projectRoot, "configs", "caelestia"),
  };
}

/** Source filename of the hypr-user variant for a given deviceType. */
function variantFilename(deviceType) {
  return `hypr-user-${deviceType}.conf`;
}

/**
 * Deploy versioned Caelestia preferences into ~/.config/caelestia/.
 *
 * Routes the hypr-user variant by deviceType (read from ~/.haoshoku.json):
 *   - `pc`     → configs/caelestia/hypr-user-pc.conf
 *   - `laptop` → configs/caelestia/hypr-user-laptop.conf
 *   - unknown / unset / malformed → falls back to `pc` (safer default).
 *
 * Both variants land at ~/.config/caelestia/hypr-user.conf locally — Caelestia
 * sources that exact path; the device-specific name only lives in the haoshoku
 * tree. cli.json is portable and deploys identically regardless of device.
 *
 * Missing source files are skipped silently — partial sync is intentional.
 */
export async function syncCaelestiaPrefs(opts = {}) {
  const { home, caelestiaConfigDir, caelestiaBackupDir } = resolvePaths(opts);
  const deviceType = readDeviceType(home);
  log.info(`Syncing Caelestia prefs (deviceType=${deviceType})...`);

  fs.mkdirSync(caelestiaConfigDir, { recursive: true });

  // hypr-user variant
  const variantSrc = path.join(caelestiaBackupDir, variantFilename(deviceType));
  const hyprUserDest = path.join(caelestiaConfigDir, "hypr-user.conf");
  if (fs.existsSync(variantSrc)) {
    safeCopyFile(variantSrc, hyprUserDest);
    log.info(`Synced ${variantFilename(deviceType)} → hypr-user.conf`);
  } else {
    log.warning(
      `No ${variantFilename(deviceType)} in repo — skipping hypr-user.conf deploy.`,
    );
  }

  // Portable: cli.json (always)
  const cliSrc = path.join(caelestiaBackupDir, "cli.json");
  const cliDest = path.join(caelestiaConfigDir, "cli.json");
  if (fs.existsSync(cliSrc)) {
    safeCopyFile(cliSrc, cliDest);
    log.info("Synced cli.json");
  }

  log.success("Caelestia prefs synced to ~/.config/caelestia/");
}

/**
 * Snapshot the current ~/.config/caelestia/ preferences into the in-tree
 * configs/caelestia/. Routes the hypr-user.conf snapshot back to the
 * deviceType-specific variant (so a laptop user's backup goes to
 * `hypr-user-laptop.conf`, not overwriting the PC variant). cli.json
 * backs up identically.
 */
export async function backupCaelestiaPrefs(opts = {}) {
  const { home, caelestiaConfigDir, caelestiaBackupDir } = resolvePaths(opts);
  const deviceType = readDeviceType(home);

  log.info(`Backing up Caelestia prefs (deviceType=${deviceType})...`);

  if (!fs.existsSync(caelestiaConfigDir)) {
    log.warning(`No ~/.config/caelestia/ found at ${caelestiaConfigDir} — nothing to back up`);
    return;
  }

  fs.mkdirSync(caelestiaBackupDir, { recursive: true });

  // hypr-user.conf → variant file in repo
  const hyprUserSrc = path.join(caelestiaConfigDir, "hypr-user.conf");
  const variantDest = path.join(caelestiaBackupDir, variantFilename(deviceType));
  if (fs.existsSync(hyprUserSrc)) {
    // installCaelestia pre-creates an EMPTY hypr-user.conf placeholder before
    // first boot. Backing that empty file up over a curated repo variant would
    // silently wipe the host's real monitor config. Guard: when the live file
    // is empty/whitespace-only but the repo already holds a non-empty variant,
    // skip it — the repo copy is the source of truth.
    const liveIsBlank =
      fs.readFileSync(hyprUserSrc, "utf8").trim().length === 0;
    const repoHasContent =
      fs.existsSync(variantDest) &&
      fs.readFileSync(variantDest, "utf8").length > 0;
    if (liveIsBlank && repoHasContent) {
      log.warning(
        `Live hypr-user.conf at ${hyprUserSrc} is empty (pre-boot placeholder) — keeping curated ${variantFilename(deviceType)} instead of clobbering it.`,
      );
    } else {
      fs.copyFileSync(hyprUserSrc, variantDest);
      log.info(`Backed up hypr-user.conf → ${variantFilename(deviceType)}`);
    }
  }

  // Portable: cli.json
  const cliSrc = path.join(caelestiaConfigDir, "cli.json");
  const cliDest = path.join(caelestiaBackupDir, "cli.json");
  if (fs.existsSync(cliSrc)) {
    fs.copyFileSync(cliSrc, cliDest);
    log.info("Backed up cli.json");
  }

  log.success("Caelestia prefs backed up to configs/caelestia/");
}

/** Alias used by OS setup flows; mirrors configureZed(). */
export async function configureCaelestiaPrefs(opts = {}) {
  await syncCaelestiaPrefs(opts);
}
