import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { log } from "../common/utils.js";

const HOME_DEFAULT = homedir();
const PROJECT_ROOT_DEFAULT = path.resolve(__dirname, "..", "..");

const SCRIPT = "cleanup-worktrees.sh";
const UNITS = ["defi-worktree-cleanup.service", "defi-worktree-cleanup.timer"];
const TIMER_UNIT = "defi-worktree-cleanup.timer";
const ENABLE_HINT =
  "systemctl --user daemon-reload && systemctl --user enable --now defi-worktree-cleanup.timer";

/**
 * Resolve repo + live paths from injected home/projectRoot (defaults to real
 * $HOME and the haoshoku project root). Pulled out so tests can swap temp dirs.
 *
 * The script and the systemd units deploy to two different live locations:
 *   - cleanup-worktrees.sh -> ~/defi/.worktree-cleanup/
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
    liveScriptDir: path.join(home, "defi", ".worktree-cleanup"),
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
 * Copies cleanup-worktrees.sh to ~/defi/.worktree-cleanup/ (chmod 755) and the
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

  // Script → ~/defi/.worktree-cleanup/ (executable)
  fs.mkdirSync(liveScriptDir, { recursive: true });
  const scriptSrc = path.join(repoDir, SCRIPT);
  if (fs.existsSync(scriptSrc)) {
    const scriptDest = path.join(liveScriptDir, SCRIPT);
    fs.copyFileSync(scriptSrc, scriptDest);
    fs.chmodSync(scriptDest, 0o755);
    log.info(`Synced worktree-cleanup/${SCRIPT}`);
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
    "worktree-cleanup synced (script → ~/defi/.worktree-cleanup/, units → ~/.config/systemd/user/)",
  );

  if (enable !== false) {
    enableTimer(runner);
  }
}

/**
 * Snapshot live → configs/worktree-cleanup/.
 *
 * Copies cleanup-worktrees.sh from ~/defi/.worktree-cleanup/ and the two units
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

  const scriptSrc = path.join(liveScriptDir, SCRIPT);
  if (fs.existsSync(scriptSrc)) {
    fs.copyFileSync(scriptSrc, path.join(repoDir, SCRIPT));
    log.info(`Backed up worktree-cleanup/${SCRIPT}`);
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
