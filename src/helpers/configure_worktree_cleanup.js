import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { PROJECT_ROOT as PROJECT_ROOT_DEFAULT } from "../common/paths.js";

import { log } from "../common/utils.js";

const HOME_DEFAULT = homedir();

const SCRIPT = "cleanup-worktrees.sh";
const UNITS = ["disk-cleanup.service", "disk-cleanup.timer"];
const RUNTIME_FILES = [SCRIPT, "disk-cleanup-tmpfiles.conf"];
const LEGACY_UNITS = ["defi-worktree-cleanup.timer", "defi-worktree-cleanup.service"];
const TIMER_UNIT = "disk-cleanup.timer";
const ENABLE_HINT =
  "systemctl --user daemon-reload && systemctl --user enable --now disk-cleanup.timer";

/**
 * Resolve repo + live paths from injected home/projectRoot (defaults to real
 * $HOME and the haoshoku project root). Pulled out so tests can swap temp dirs.
 *
 * The script and the systemd units deploy to two different live locations:
 *   - cleanup-worktrees.sh -> ~/.local/share/disk-cleanup/
 *   - *.service / *.timer  -> ~/.config/systemd/user/
 *
 * @param {{ home?: string, projectRoot?: string }} opts
 */
function resolvePaths({
  home = HOME_DEFAULT,
  projectRoot = PROJECT_ROOT_DEFAULT,
} = {}) {
  return {
    repoDir: path.join(projectRoot, "configs", "worktree-cleanup"),
    liveScriptDir: path.join(home, ".local", "share", "disk-cleanup"),
    liveSystemdDir: path.join(home, ".config", "systemd", "user"),
  };
}

/**
 * Enable the timer via `systemctl --user`, guarded by availability.
 *
 * This is the one place Haoshoku runs a service manager rather than just
 * copying files, so it is isolated, injectable (runner), and never throws:
 * if systemctl is missing (e.g. headless install) it logs an actionable hint
 * and returns. Tests inject a mock runner so they never touch the real
 * service manager.
 */
function enableTimer(runner) {
  const probe = runner(["systemctl", "--user", "--version"]);
  if (!probe || probe.exitCode !== 0) {
    log.warning(
      `systemctl --user unavailable — skipping timer enable. Run manually:\n  ${ENABLE_HINT}`,
    );
    return;
  }

  const reload = runner(["systemctl", "--user", "daemon-reload"]);
  const enable = runner(["systemctl", "--user", "enable", "--now", TIMER_UNIT]);

  if ((reload?.exitCode ?? 1) === 0 && (enable?.exitCode ?? 1) === 0) {
    log.success(`Enabled ${TIMER_UNIT} (systemctl --user)`);
  } else {
    log.warning(
      `Could not enable the timer automatically. Run manually:\n  ${ENABLE_HINT}`,
    );
  }
}

/**
 * Deploy configs/worktree-cleanup/ → live, then (unless enable === false)
 * daemon-reload + enable --now the timer.
 *
 * Copies cleanup-worktrees.sh to ~/.local/share/disk-cleanup/ (chmod 755) and the
 * two systemd units to ~/.config/systemd/user/. CLAUDE.md and test-cleanup.sh
 * are repo-only and never deployed. If the repo dir is absent, logs a warning
 * and skips.
 *
 * @param {{ home?: string, projectRoot?: string, enable?: boolean, runner?: Function }} opts
 */
export async function syncWorktreeCleanup(opts = {}) {
  const { enable = true } = opts;
  const runner = opts.runner ?? ((args) => Bun.spawnSync(args));
  const { repoDir, liveScriptDir, liveSystemdDir } = resolvePaths(opts);

  if (!fs.existsSync(repoDir)) {
    log.warning(
      `No worktree-cleanup source dir found at ${repoDir} — skipping`,
    );
    return;
  }

  fs.mkdirSync(liveScriptDir, { recursive: true });
  for (const file of RUNTIME_FILES) {
    const src = path.join(repoDir, file);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(liveScriptDir, file);
    fs.copyFileSync(src, dest);
    fs.chmodSync(dest, file === SCRIPT ? 0o755 : 0o644);
  }

  const legacy = LEGACY_UNITS.filter((unit) =>
    fs.existsSync(path.join(liveSystemdDir, unit)),
  );
  if (legacy.length > 0) {
    if (enable !== false) {
      const result = runner(["systemctl", "--user", "disable", "--now", ...legacy]);
      if (result?.exitCode !== 0) {
        throw new Error("Could not retire legacy worktree-cleanup units");
      }
    }
    for (const unit of legacy) fs.unlinkSync(path.join(liveSystemdDir, unit));
  }

  // Units → ~/.config/systemd/user/
  fs.mkdirSync(liveSystemdDir, { recursive: true });
  for (const unit of UNITS) {
    const src = path.join(repoDir, unit);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(liveSystemdDir, unit));
      log.info(`Synced worktree-cleanup/${unit}`);
    }
  }

  log.success(
    "worktree-cleanup synced (script → ~/.local/share/disk-cleanup/, units → ~/.config/systemd/user/)",
  );

  if (enable !== false) {
    enableTimer(runner);
  }
}

/**
 * Snapshot live → configs/worktree-cleanup/.
 *
 * Copies cleanup-worktrees.sh from ~/.local/share/disk-cleanup/ and the two units
 * from ~/.config/systemd/user/ back into the repo. Creates the repo dir if
 * missing. If the live script dir is absent, logs a warning and skips.
 *
 * @param {{ home?: string, projectRoot?: string }} opts
 */
export async function backupWorktreeCleanup(opts = {}) {
  const { repoDir, liveScriptDir, liveSystemdDir } = resolvePaths(opts);

  if (!fs.existsSync(liveScriptDir)) {
    log.warning(
      `No live worktree-cleanup dir found at ${liveScriptDir} — skipping`,
    );
    return;
  }

  fs.mkdirSync(repoDir, { recursive: true });

  for (const file of RUNTIME_FILES) {
    const src = path.join(liveScriptDir, file);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(repoDir, file));
  }

  for (const unit of UNITS) {
    const src = path.join(liveSystemdDir, unit);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(repoDir, unit));
      log.info(`Backed up worktree-cleanup/${unit}`);
    }
  }

  log.success("worktree-cleanup backed up to configs/worktree-cleanup/");
}

/** Alias used by OS setup flows; delegates to the sync operation. */
export async function configureWorktreeCleanup(opts = {}) {
  await syncWorktreeCleanup(opts);
}
