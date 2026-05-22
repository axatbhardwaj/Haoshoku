import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { log, readConfiguredDeviceType } from "../common/utils.js";

const HOME_DEFAULT = homedir();
const PROJECT_ROOT_DEFAULT = path.resolve(__dirname, "..", "..");

/**
 * Resolve all live and in-repo audio config paths from injected home +
 * projectRoot (defaults to real $HOME and the haoshoku project root).
 * Pulled out so tests can swap in temp dirs.
 *
 * @param {{ home?: string, projectRoot?: string }} opts
 */
function resolvePaths({ home = HOME_DEFAULT, projectRoot = PROJECT_ROOT_DEFAULT } = {}) {
  return {
    home,
    // Live PipeWire dirs
    livePipewireConfD: path.join(home, ".config", "pipewire", "pipewire.conf.d"),
    livePipewirePulseConfD: path.join(home, ".config", "pipewire", "pipewire-pulse.conf.d"),
    // Live WirePlumber drop-in dir
    liveWireplumberConfD: path.join(home, ".config", "wireplumber", "wireplumber.conf.d"),
    // In-repo backup dirs
    audioBackupDir: path.join(projectRoot, "configs", "audio"),
    repoPipewireConfD: path.join(projectRoot, "configs", "audio", "pipewire", "pipewire.conf.d"),
    repoPipewirePulseConfD: path.join(
      projectRoot,
      "configs",
      "audio",
      "pipewire",
      "pipewire-pulse.conf.d",
    ),
  };
}

/**
 * Copy all files from a flat source directory into destDir.
 * Skips silently if srcDir is missing or empty (partial sync is intentional).
 *
 * @param {string} srcDir
 * @param {string} destDir
 * @param {string} label  — human-readable name used in log messages
 */
function copyDropInDir(srcDir, destDir, label) {
  if (!fs.existsSync(srcDir)) {
    log.warning(`No ${label} source dir found at ${srcDir} — skipping`);
    return;
  }

  const files = fs.readdirSync(srcDir);
  if (files.length === 0) {
    log.warning(`${label} source dir is empty — skipping`);
    return;
  }

  fs.mkdirSync(destDir, { recursive: true });
  for (const file of files) {
    const src = path.join(srcDir, file);
    const dest = path.join(destDir, file);
    // Only copy plain files; drop-in dirs are flat
    if (fs.statSync(src).isFile()) {
      fs.copyFileSync(src, dest);
      log.info(`Synced ${label}/${file}`);
    }
  }
}

function managedWireplumberFiles(audioBackupDir) {
  const wireplumberRoot = path.join(audioBackupDir, "wireplumber");
  const managed = new Set();
  if (!fs.existsSync(wireplumberRoot)) return managed;

  for (const deviceDir of fs.readdirSync(wireplumberRoot, { withFileTypes: true })) {
    if (!deviceDir.isDirectory()) continue;
    const variantDir = path.join(wireplumberRoot, deviceDir.name);
    for (const file of fs.readdirSync(variantDir, { withFileTypes: true })) {
      if (file.isFile()) managed.add(file.name);
    }
  }

  return managed;
}

function pruneManagedDropIns(destDir, managedFiles) {
  if (!fs.existsSync(destDir)) return;

  for (const file of managedFiles) {
    const dest = path.join(destDir, file);
    if (fs.existsSync(dest) && fs.statSync(dest).isFile()) {
      fs.unlinkSync(dest);
      log.info(`Removed stale wireplumber/${file}`);
    }
  }
}

/**
 * Deploy repo audio drop-ins → live ~/.config/.
 *
 * Portable PipeWire drop-ins (device-agnostic):
 *   configs/audio/pipewire/pipewire.conf.d/       → ~/.config/pipewire/pipewire.conf.d/
 *   configs/audio/pipewire/pipewire-pulse.conf.d/ → ~/.config/pipewire/pipewire-pulse.conf.d/
 *
 * Device-routed WirePlumber drop-ins:
 *   configs/audio/wireplumber/<deviceType>/       → ~/.config/wireplumber/wireplumber.conf.d/
 *
 * Missing source dirs are skipped with a warning — partial sync is intentional.
 */
export async function syncAudioConfig(opts = {}) {
  const {
    home,
    livePipewireConfD,
    livePipewirePulseConfD,
    liveWireplumberConfD,
    audioBackupDir,
    repoPipewireConfD,
    repoPipewirePulseConfD,
  } = resolvePaths(opts);

  const deviceType = readConfiguredDeviceType(home);
  log.info(`Syncing audio config (deviceType=${deviceType ?? "unset"})...`);

  // Portable PipeWire drop-ins
  copyDropInDir(repoPipewireConfD, livePipewireConfD, "pipewire.conf.d");
  copyDropInDir(
    repoPipewirePulseConfD,
    livePipewirePulseConfD,
    "pipewire-pulse.conf.d",
  );

  pruneManagedDropIns(
    liveWireplumberConfD,
    managedWireplumberFiles(audioBackupDir),
  );

  if (!deviceType) {
    log.warning(
      "No explicit deviceType in ~/.haoshoku.json — skipping device-specific WirePlumber drop-ins",
    );
    log.success("Audio config synced to ~/.config/");
    return;
  }

  // Device-routed WirePlumber drop-ins
  const repoWireplumberDevice = path.join(
    audioBackupDir,
    "wireplumber",
    deviceType,
  );
  copyDropInDir(
    repoWireplumberDevice,
    liveWireplumberConfD,
    `wireplumber/${deviceType}`,
  );

  log.success("Audio config synced to ~/.config/");
}

/**
 * Snapshot live ~/.config/ audio drop-ins → in-tree configs/audio/.
 *
 * ~/.config/pipewire/pipewire.conf.d/       → configs/audio/pipewire/pipewire.conf.d/
 * ~/.config/pipewire/pipewire-pulse.conf.d/ → configs/audio/pipewire/pipewire-pulse.conf.d/
 * ~/.config/wireplumber/wireplumber.conf.d/ → configs/audio/wireplumber/<deviceType>/
 *
 * Missing live dirs are skipped with a warning.
 */
export async function backupAudioConfig(opts = {}) {
  const {
    home,
    livePipewireConfD,
    livePipewirePulseConfD,
    liveWireplumberConfD,
    audioBackupDir,
    repoPipewireConfD,
    repoPipewirePulseConfD,
  } = resolvePaths(opts);

  const deviceType = readConfiguredDeviceType(home);
  log.info(`Backing up audio config (deviceType=${deviceType ?? "unset"})...`);

  // Portable PipeWire drop-ins
  copyDropInDir(livePipewireConfD, repoPipewireConfD, "pipewire.conf.d");
  copyDropInDir(
    livePipewirePulseConfD,
    repoPipewirePulseConfD,
    "pipewire-pulse.conf.d",
  );

  if (!deviceType) {
    log.warning(
      "No explicit deviceType in ~/.haoshoku.json — skipping device-specific WirePlumber backup",
    );
    log.success("Audio config backed up to configs/audio/");
    return;
  }

  // Device-routed WirePlumber drop-ins (live → repo/<deviceType>/)
  const repoWireplumberDevice = path.join(
    audioBackupDir,
    "wireplumber",
    deviceType,
  );
  copyDropInDir(
    liveWireplumberConfD,
    repoWireplumberDevice,
    `wireplumber/${deviceType}`,
  );

  log.success("Audio config backed up to configs/audio/");
}

/** Alias used by OS setup flows; mirrors configureCaelestiaPrefs(). */
export async function configureAudio(opts = {}) {
  await syncAudioConfig(opts);
}
