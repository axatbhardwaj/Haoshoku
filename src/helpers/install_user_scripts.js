import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { log, safeCopyFile } from "../common/utils.js";

const HOME_DEFAULT = homedir();
const PROJECT_ROOT_DEFAULT = path.resolve(__dirname, "..", "..");

function resolvePaths({ home = HOME_DEFAULT, projectRoot = PROJECT_ROOT_DEFAULT } = {}) {
  return {
    scriptsSrc: path.join(projectRoot, "configs", "scripts"),
    localBin: path.join(home, ".local", "bin"),
  };
}

/**
 * Install all executable shell scripts from configs/scripts/ into ~/.local/bin/.
 *
 * Each file is copied verbatim and chmod'd to 0o755. Existing destination files
 * are overwritten — the repo is the source of truth for these scripts. The
 * destination lives in PATH (~/.local/bin/ precedes /usr/bin on most
 * systemd-user-session setups), so any script that shadows a system command
 * (e.g. `game-performance` shadowing /usr/bin/game-performance from
 * cachyos-settings) automatically wins resolution from any tool that calls it
 * by command name.
 *
 * Files starting with `.` are skipped, so `.gitkeep` or other hidden tracking
 * files in the source tree won't get installed.
 *
 * Missing source directory is treated as a no-op (not an error) — a repo with
 * no scripts to deploy should pass through cleanly.
 */
export async function installUserScripts(opts = {}) {
  const { scriptsSrc, localBin } = resolvePaths(opts);

  if (!fs.existsSync(scriptsSrc)) {
    log.info("No configs/scripts/ directory; skipping user-script install.");
    return;
  }

  const entries = fs
    .readdirSync(scriptsSrc, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith("."));

  if (entries.length === 0) {
    log.info("configs/scripts/ is empty; skipping user-script install.");
    return;
  }

  fs.mkdirSync(localBin, { recursive: true });

  log.info(`Installing ${entries.length} user script(s) to ${localBin}...`);
  for (const entry of entries) {
    const src = path.join(scriptsSrc, entry.name);
    const dest = path.join(localBin, entry.name);
    safeCopyFile(src, dest);
    fs.chmodSync(dest, 0o755);
    log.info(`  ${entry.name}`);
  }
  log.success("User scripts installed.");
}
