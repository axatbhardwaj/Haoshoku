import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { log, safeCopyFile } from "../common/utils.js";

const HOME_DEFAULT = homedir();
const PROJECT_ROOT_DEFAULT = path.resolve(__dirname, "..", "..");

/**
 * Resolve the live and in-repo mimeapps.list paths from injected home +
 * projectRoot (defaults to real $HOME and the haoshoku project root).
 * Pulled out so tests can swap in temp dirs.
 *
 * @param {{ home?: string, projectRoot?: string }} opts
 */
function resolvePaths({ home = HOME_DEFAULT, projectRoot = PROJECT_ROOT_DEFAULT } = {}) {
  return {
    liveFile: path.join(home, ".config", "mimeapps.list"),
    liveDir: path.join(home, ".config"),
    liveApplicationsDir: path.join(home, ".local", "share", "applications"),
    repoFile: path.join(projectRoot, "configs", "mimeapps", "mimeapps.list"),
    repoDir: path.join(projectRoot, "configs", "mimeapps"),
    repoApplicationsDir: path.join(projectRoot, "configs", "mimeapps", "applications"),
  };
}

function syncDesktopHandlers(repoApplicationsDir, liveApplicationsDir) {
  if (!fs.existsSync(repoApplicationsDir)) return;

  fs.mkdirSync(liveApplicationsDir, { recursive: true });
  for (const entry of fs.readdirSync(repoApplicationsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".desktop")) continue;
    fs.copyFileSync(
      path.join(repoApplicationsDir, entry.name),
      path.join(liveApplicationsDir, entry.name),
    );
    log.info(`Synced applications/${entry.name}`);
  }
}

/**
 * Deploy configs/mimeapps/mimeapps.list → ~/.config/mimeapps.list and any
 * repo-authored .desktop handlers → ~/.local/share/applications/.
 *
 * Creates ~/.config/ if missing. If the repo source file is absent, logs a
 * warning and skips (partial-sync is intentional — no error thrown).
 *
 * @param {{ home?: string, projectRoot?: string }} opts
 */
export async function syncMimeappsConfig(opts = {}) {
  const {
    liveFile,
    liveDir,
    liveApplicationsDir,
    repoFile,
    repoApplicationsDir,
  } = resolvePaths(opts);

  if (!fs.existsSync(repoFile)) {
    log.warning(`No mimeapps.list source found at ${repoFile} — skipping`);
    return;
  }

  fs.mkdirSync(liveDir, { recursive: true });
  safeCopyFile(repoFile, liveFile);
  syncDesktopHandlers(repoApplicationsDir, liveApplicationsDir);
  log.success("mimeapps.list synced to ~/.config/");
}

/**
 * Snapshot ~/.config/mimeapps.list → configs/mimeapps/mimeapps.list.
 * Repo-authored .desktop handlers are intentionally not backed up from the
 * live system; they are managed assets, not user-edited runtime state.
 *
 * Creates the repo dir if missing. If the live file is absent, logs a
 * warning and skips.
 *
 * @param {{ home?: string, projectRoot?: string }} opts
 */
export async function backupMimeappsConfig(opts = {}) {
  const { liveFile, repoFile, repoDir } = resolvePaths(opts);

  if (!fs.existsSync(liveFile)) {
    log.warning(`No live mimeapps.list found at ${liveFile} — skipping`);
    return;
  }

  fs.mkdirSync(repoDir, { recursive: true });
  fs.copyFileSync(liveFile, repoFile);
  log.success("mimeapps.list backed up to configs/mimeapps/");
}

/** Alias used by OS setup flows; deploys the portable MIME/app handler defaults. */
export async function configureMimeapps(opts = {}) {
  await syncMimeappsConfig(opts);
}
