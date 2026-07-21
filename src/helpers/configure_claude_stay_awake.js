import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { log } from "../common/utils.js";

const HOME_DEFAULT = homedir();
const PROJECT_ROOT_DEFAULT = path.resolve(__dirname, "..", "..");

const SCRIPT = "claude-stay-awake";
const SERVICE_UNIT = "claude-stay-awake.service";
const ENABLE_HINT =
  "systemctl --user daemon-reload && systemctl --user enable --now claude-stay-awake.service";

/**
 * Resolve repo + live paths from injected home/projectRoot (defaults to real
 * $HOME and the haoshoku project root). Pulled out so tests can swap temp dirs.
 *
 * The script and systemd user unit deploy to two different live locations:
 *   - claude-stay-awake         -> ~/.local/bin/
 *   - claude-stay-awake.service -> ~/.config/systemd/user/
 *
 * @param {{ home?: string, projectRoot?: string }} opts
 */
function resolvePaths({
  home = HOME_DEFAULT,
  projectRoot = PROJECT_ROOT_DEFAULT,
} = {}) {
  return {
    repoDir: path.join(projectRoot, "configs", "claude-stay-awake"),
    liveScriptDir: path.join(home, ".local", "bin"),
    liveSystemdDir: path.join(home, ".config", "systemd", "user"),
  };
}

/** Enable the service via `systemctl --user`, guarded by availability. */
function enableService(runner) {
  try {
    const probe = runner(["systemctl", "--user", "--version"]);
    if (!probe || probe.exitCode !== 0) {
      log.warning(
        `systemctl --user unavailable — skipping service enable. Run manually:\n  ${ENABLE_HINT}`,
      );
      return;
    }

    const reload = runner(["systemctl", "--user", "daemon-reload"]);
    const enable = runner([
      "systemctl",
      "--user",
      "enable",
      "--now",
      SERVICE_UNIT,
    ]);

    if ((reload?.exitCode ?? 1) === 0 && (enable?.exitCode ?? 1) === 0) {
      log.success(`Enabled ${SERVICE_UNIT} (systemctl --user)`);
      return;
    }

    log.warning(
      `Could not enable the service automatically. Run manually:\n  ${ENABLE_HINT}`,
    );
  } catch {
    log.warning(
      `systemctl --user unavailable — skipping service enable. Run manually:\n  ${ENABLE_HINT}`,
    );
  }
}

/**
 * Deploy configs/claude-stay-awake/ to the live script + systemd user dirs,
 * then (unless enable === false) daemon-reload + enable --now the service.
 *
 * @param {{ home?: string, projectRoot?: string, enable?: boolean, runner?: Function }} opts
 */
export async function syncClaudeStayAwake(opts = {}) {
  const { enable = true } = opts;
  const runner = opts.runner ?? ((args) => Bun.spawnSync(args));
  const { repoDir, liveScriptDir, liveSystemdDir } = resolvePaths(opts);

  if (!fs.existsSync(repoDir)) {
    log.warning(
      `No claude-stay-awake source dir found at ${repoDir} — skipping`,
    );
    return;
  }

  fs.mkdirSync(liveScriptDir, { recursive: true });
  const scriptSrc = path.join(repoDir, SCRIPT);
  if (fs.existsSync(scriptSrc)) {
    const scriptDest = path.join(liveScriptDir, SCRIPT);
    fs.copyFileSync(scriptSrc, scriptDest);
    fs.chmodSync(scriptDest, 0o755);
    log.info(`Synced claude-stay-awake/${SCRIPT}`);
  }

  fs.mkdirSync(liveSystemdDir, { recursive: true });
  const serviceSrc = path.join(repoDir, SERVICE_UNIT);
  if (fs.existsSync(serviceSrc)) {
    fs.copyFileSync(serviceSrc, path.join(liveSystemdDir, SERVICE_UNIT));
    log.info(`Synced claude-stay-awake/${SERVICE_UNIT}`);
  }

  log.success(
    "claude-stay-awake synced (script → ~/.local/bin/, service → ~/.config/systemd/user/)",
  );

  if (enable !== false) {
    enableService(runner);
  }
}

/** Snapshot the live script + systemd user unit into configs/claude-stay-awake/. */
export async function backupClaudeStayAwake(opts = {}) {
  const { repoDir, liveScriptDir, liveSystemdDir } = resolvePaths(opts);
  const scriptSrc = path.join(liveScriptDir, SCRIPT);

  if (!fs.existsSync(scriptSrc)) {
    log.warning(
      `No live script found at ${scriptSrc} — skipping claude-stay-awake backup`,
    );
    return;
  }

  fs.mkdirSync(repoDir, { recursive: true });

  fs.copyFileSync(scriptSrc, path.join(repoDir, SCRIPT));
  log.info(`Backed up claude-stay-awake/${SCRIPT}`);

  const serviceSrc = path.join(liveSystemdDir, SERVICE_UNIT);
  if (fs.existsSync(serviceSrc)) {
    fs.copyFileSync(serviceSrc, path.join(repoDir, SERVICE_UNIT));
    log.info(`Backed up claude-stay-awake/${SERVICE_UNIT}`);
  }

  log.success("claude-stay-awake backed up to configs/claude-stay-awake/");
}

/** Alias used by OS setup flows. */
export async function configureClaudeStayAwake(opts = {}) {
  await syncClaudeStayAwake(opts);
}
