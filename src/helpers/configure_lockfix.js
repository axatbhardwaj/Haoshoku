import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { log } from "../common/utils.js";

const HOME_DEFAULT = homedir();
const PROJECT_ROOT_DEFAULT = path.resolve(__dirname, "..", "..");

/**
 * Resolve the live and in-repo caelestia-lockfix kit paths from injected home
 * + projectRoot (defaults to real $HOME and the haoshoku project root).
 * Pulled out so tests can swap in temp dirs.
 *
 * @param {{ home?: string, projectRoot?: string }} opts
 */
function resolvePaths({ home = HOME_DEFAULT, projectRoot = PROJECT_ROOT_DEFAULT } = {}) {
  return {
    liveKitDir: path.join(home, ".local", "share", "caelestia-lockfix"),
    repoKitDir: path.join(projectRoot, "configs", "caelestia-lockfix"),
  };
}

/**
 * Deploy configs/caelestia-lockfix/ → ~/.local/share/caelestia-lockfix/.
 *
 * Copies apply.sh and every *.patch file from the repo kit dir to the live
 * kit dir. CLAUDE.md is intentionally excluded — it is repo documentation,
 * not part of the runtime kit.
 *
 * Creates the live kit dir if missing. After copying apply.sh, chmods it
 * to 0o755 so the shell script is executable. If the repo kit dir is absent,
 * logs a warning and skips.
 *
 * @param {{ home?: string, projectRoot?: string }} opts
 */
export async function syncLockfix(opts = {}) {
  const { liveKitDir, repoKitDir } = resolvePaths(opts);

  if (!fs.existsSync(repoKitDir)) {
    log.warning(`No caelestia-lockfix source dir found at ${repoKitDir} — skipping`);
    return;
  }

  fs.mkdirSync(liveKitDir, { recursive: true });

  const allFiles = fs.readdirSync(repoKitDir);
  const filesToCopy = allFiles.filter((f) => {
    if (!fs.statSync(path.join(repoKitDir, f)).isFile()) return false;
    // Only copy apply.sh and *.patch; skip CLAUDE.md and anything else
    return f === "apply.sh" || f.endsWith(".patch");
  });

  for (const file of filesToCopy) {
    const src = path.join(repoKitDir, file);
    const dest = path.join(liveKitDir, file);
    fs.copyFileSync(src, dest);
    log.info(`Synced caelestia-lockfix/${file}`);
  }

  // Ensure apply.sh is executable
  const applyShDest = path.join(liveKitDir, "apply.sh");
  if (fs.existsSync(applyShDest)) {
    fs.chmodSync(applyShDest, 0o755);
  }

  log.success("caelestia-lockfix kit synced to ~/.local/share/caelestia-lockfix/");
}

/**
 * Snapshot ~/.local/share/caelestia-lockfix/ → configs/caelestia-lockfix/.
 *
 * Copies apply.sh and every *.patch file from the live kit dir back into the
 * repo (CLAUDE.md is never touched). Creates the repo kit dir if missing. If
 * the live kit dir is absent, logs a warning and skips.
 *
 * @param {{ home?: string, projectRoot?: string }} opts
 */
export async function backupLockfix(opts = {}) {
  const { liveKitDir, repoKitDir } = resolvePaths(opts);

  if (!fs.existsSync(liveKitDir)) {
    log.warning(`No live caelestia-lockfix dir found at ${liveKitDir} — skipping`);
    return;
  }

  fs.mkdirSync(repoKitDir, { recursive: true });

  const allFiles = fs.readdirSync(liveKitDir);
  const filesToCopy = allFiles.filter((f) => {
    if (!fs.statSync(path.join(liveKitDir, f)).isFile()) return false;
    return f === "apply.sh" || f.endsWith(".patch");
  });

  for (const file of filesToCopy) {
    const src = path.join(liveKitDir, file);
    const dest = path.join(repoKitDir, file);
    fs.copyFileSync(src, dest);
    log.info(`Backed up caelestia-lockfix/${file}`);
  }

  log.success("caelestia-lockfix kit backed up to configs/caelestia-lockfix/");
}

/** Alias used by OS setup flows; mirrors configureAudio(). */
export async function configureLockfix(opts = {}) {
  await syncLockfix(opts);
}
