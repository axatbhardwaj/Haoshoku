import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { log, readConfiguredDeviceType } from "../common/utils.js";

const HOME_DEFAULT = homedir();
const PROJECT_ROOT_DEFAULT = path.resolve(__dirname, "..", "..");
const MANAGED_WIREPLUMBER_MARKER =
  "# Managed by Haoshoku: device-routed WirePlumber drop-in\n";

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
 * @param {{ transform?: (contents: string) => string }} opts
 */
function copyDropInDir(srcDir, destDir, label, { transform } = {}) {
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
      if (transform) {
        fs.writeFileSync(dest, transform(fs.readFileSync(src, "utf8")));
      } else {
        fs.copyFileSync(src, dest);
      }
      log.info(`Synced ${label}/${file}`);
    }
  }
}

function withManagedWireplumberMarker(contents) {
  if (contents.startsWith(MANAGED_WIREPLUMBER_MARKER)) return contents;
  return `${MANAGED_WIREPLUMBER_MARKER}${contents}`;
}

function withoutManagedWireplumberMarker(contents) {
  if (!contents.startsWith(MANAGED_WIREPLUMBER_MARKER)) return contents;
  return contents.slice(MANAGED_WIREPLUMBER_MARKER.length);
}

function warnFs(action, target, err) {
  log.warning(`${action} ${target}: ${err?.message ?? err}`);
}

/**
 * Read repo WirePlumber variants as deviceType -> filename -> file contents.
 * Contents give stale-prune a provenance check for files deployed by older
 * Haoshoku versions before the explicit managed marker existed.
 */
function managedWireplumberVariants(audioBackupDir) {
  const wireplumberRoot = path.join(audioBackupDir, "wireplumber");
  const variants = new Map();
  if (!fs.existsSync(wireplumberRoot)) return variants;

  let deviceDirs;
  try {
    deviceDirs = fs.readdirSync(wireplumberRoot, { withFileTypes: true });
  } catch (err) {
    warnFs("Could not read WirePlumber variants under", wireplumberRoot, err);
    return variants;
  }

  for (const deviceDir of deviceDirs) {
    if (!deviceDir.isDirectory()) continue;
    const variantDir = path.join(wireplumberRoot, deviceDir.name);
    const managedFiles = new Map();
    let files;
    try {
      files = fs.readdirSync(variantDir, { withFileTypes: true });
    } catch (err) {
      warnFs("Could not read WirePlumber variant dir", variantDir, err);
      continue;
    }

    for (const file of files) {
      if (!file.isFile()) continue;
      const src = path.join(variantDir, file.name);
      try {
        managedFiles.set(file.name, fs.readFileSync(src, "utf8"));
      } catch (err) {
        warnFs("Could not read WirePlumber managed file", src, err);
      }
    }
    variants.set(deviceDir.name, managedFiles);
  }

  return variants;
}

function staleWireplumberFiles(variants, deviceType) {
  const currentFiles = deviceType
    ? (variants.get(deviceType) ?? new Map())
    : new Map();
  const stale = new Map();

  for (const [variant, files] of variants) {
    if (variant === deviceType) continue;
    for (const [file, contents] of files) {
      if (currentFiles.has(file)) continue;
      if (!stale.has(file)) stale.set(file, []);
      stale.get(file).push(contents);
    }
  }

  return stale;
}

function isManagedWireplumberFile(liveContent, managedContents) {
  if (liveContent.startsWith(MANAGED_WIREPLUMBER_MARKER)) return true;
  return managedContents.some(
    (contents) =>
      liveContent === contents ||
      liveContent === withManagedWireplumberMarker(contents),
  );
}

function pruneManagedDropIns(destDir, staleFiles) {
  if (!fs.existsSync(destDir)) return;

  for (const [file, managedContents] of staleFiles) {
    const dest = path.join(destDir, file);
    let stat;
    try {
      stat = fs.statSync(dest);
    } catch (err) {
      if (err?.code !== "ENOENT") {
        warnFs("Could not stat WirePlumber drop-in", dest, err);
      }
      continue;
    }

    if (!stat.isFile()) continue;

    let liveContent;
    try {
      liveContent = fs.readFileSync(dest, "utf8");
    } catch (err) {
      warnFs("Could not inspect WirePlumber drop-in", dest, err);
      continue;
    }

    if (!isManagedWireplumberFile(liveContent, managedContents)) {
      log.warning(
        `Leaving user-authored wireplumber/${file} untouched (filename matches a managed variant, but no Haoshoku marker/content match was found)`,
      );
      continue;
    }

    try {
      fs.unlinkSync(dest);
      log.info(`Removed stale wireplumber/${file}`);
    } catch (err) {
      if (err?.code !== "ENOENT") {
        warnFs("Could not remove stale WirePlumber drop-in", dest, err);
      }
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
 * WirePlumber files are stamped with a Haoshoku marker. Stale pruning only
 * removes files from other variants when that marker or exact old managed
 * content proves Haoshoku deployed them.
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

  const wireplumberVariants = managedWireplumberVariants(audioBackupDir);
  pruneManagedDropIns(
    liveWireplumberConfD,
    staleWireplumberFiles(wireplumberVariants, deviceType),
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
    { transform: withManagedWireplumberMarker },
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
 * Missing live dirs are skipped with a warning. Without an explicit pc/laptop
 * deviceType, WirePlumber backup is skipped because the repo has no neutral
 * device-routed target.
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
      "No explicit deviceType in ~/.haoshoku.json — skipping device-specific WirePlumber backup; choose pc/laptop before backing up device-routed audio rules",
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
    { transform: withoutManagedWireplumberMarker },
  );

  log.success("Audio config backed up to configs/audio/");
}

/** Alias used by OS setup flows; delegates to the sync operation. */
export async function configureAudio(opts = {}) {
  await syncAudioConfig(opts);
}
