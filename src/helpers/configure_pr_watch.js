import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { log } from "../common/utils.js";

const HOME_DEFAULT = homedir();
const PROJECT_ROOT_DEFAULT = path.resolve(__dirname, "..", "..");

const FILES = ["pr-watch.js", "pr-watch"];

/**
 * Resolve repo + live paths from injected home/projectRoot (defaults to real
 * $HOME and the haoshoku project root). Pulled out so tests can swap temp dirs.
 *
 * Both watcher files deploy to ~/.local/bin/.
 *
 * @param {{ home?: string, projectRoot?: string }} opts
 */
function resolvePaths({
  home = HOME_DEFAULT,
  projectRoot = PROJECT_ROOT_DEFAULT,
} = {}) {
  return {
    repoDir: path.join(projectRoot, "configs", "pr-watch"),
    liveDir: path.join(home, ".local", "bin"),
  };
}

/** Deploy configs/pr-watch/ to ~/.local/bin/. */
export async function syncPrWatch(opts = {}) {
  const { repoDir, liveDir } = resolvePaths(opts);

  if (!fs.existsSync(repoDir)) {
    log.warning(`No pr-watch source dir found at ${repoDir} — skipping`);
    return;
  }

  fs.mkdirSync(liveDir, { recursive: true });
  for (const file of FILES) {
    const source = path.join(repoDir, file);
    if (!fs.existsSync(source)) {
      log.warning(`No pr-watch source file found at ${source} — skipping`);
      continue;
    }
    const destination = path.join(liveDir, file);
    fs.copyFileSync(source, destination);
    fs.chmodSync(destination, 0o755);
    log.info(`Synced pr-watch/${file}`);
  }

  log.success("pr-watch synced to ~/.local/bin/");
}

/** Snapshot both live watcher files into configs/pr-watch/. */
export async function backupPrWatch(opts = {}) {
  const { repoDir, liveDir } = resolvePaths(opts);
  const liveFiles = FILES.filter((file) =>
    fs.existsSync(path.join(liveDir, file)),
  );

  if (liveFiles.length === 0) {
    log.warning(`No live pr-watch files found at ${liveDir} — skipping backup`);
    return;
  }

  fs.mkdirSync(repoDir, { recursive: true });
  for (const file of FILES) {
    const source = path.join(liveDir, file);
    if (!fs.existsSync(source)) {
      log.warning(`No live pr-watch file found at ${source} — skipping`);
      continue;
    }
    fs.copyFileSync(source, path.join(repoDir, file));
    log.info(`Backed up pr-watch/${file}`);
  }

  log.success("pr-watch backed up to configs/pr-watch/");
}

/** Alias used by OS setup flows. */
export async function configurePrWatch(opts = {}) {
  await syncPrWatch(opts);
}
