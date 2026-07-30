#!/usr/bin/env bun
import fs from "node:fs";

import { Command } from "commander";
import prompts from "prompts";
import { getBanner, showBanner } from "./src/common/ui.js";
import { detectOS, findActiveModeFlags } from "./src/common/cli_utils.js";
import { log, promptUser } from "./src/common/utils.js";
import {
  backupClaudeConfig,
  installSuperpowers,
  syncClaudeConfig,
  updateClaudeConfig,
} from "./src/helpers/configure_claude.js";
import {
  backupCodexConfig,
  syncCodexConfig,
} from "./src/helpers/configure_codex.js";
import { configureAgentOs } from "./src/helpers/configure_agent_os.js";
import {
  backupKdeTheme,
  syncKdeTheme,
} from "./src/helpers/configure_kde_theme.js";
import {
  installCaelestia,
  promptDesktopEnvironment,
  promptDeviceType,
} from "./src/helpers/configure_hyprland.js";
import {
  backupZedConfig,
  syncZedConfig,
  syncZedTheme,
} from "./src/helpers/configure_zed.js";
import {
  backupCaelestiaPrefs,
  syncCaelestiaPrefs,
} from "./src/helpers/configure_caelestia_prefs.js";
import {
  backupAudioConfig,
  syncAudioConfig,
} from "./src/helpers/configure_audio.js";
import {
  backupMimeappsConfig,
  syncMimeappsConfig,
} from "./src/helpers/configure_mimeapps.js";
import {
  backupLockfix,
  syncLockfix,
} from "./src/helpers/configure_lockfix.js";
import {
  backupWorktreeCleanup,
  syncWorktreeCleanup,
} from "./src/helpers/configure_worktree_cleanup.js";
import {
  backupClaudeStayAwake,
  syncClaudeStayAwake,
} from "./src/helpers/configure_claude_stay_awake.js";
import {
  backupPrWatch,
  syncPrWatch,
} from "./src/helpers/configure_pr_watch.js";
import { configureSddm } from "./src/helpers/configure_sddm.js";
import {
  syncSkills,
  printAvailableSkills,
  CACHE_DIR,
} from "./src/helpers/skill_manager.js";
import { runCachyOSSetup, installKdeGlass } from "./src/os_scripts/cachyos.js";
import { runDebianServerSetup } from "./src/os_scripts/debian_server.js";

const program = new Command();

program
  .name("haoshoku")
  .description("Haoshoku: Color of the Supreme King. Dominate your setup.")
  .version("5.15.1")
  .addHelpText("before", getBanner());

program
  .option("--os <type>", "Specify the target OS (cachyos, debian-server)")
  .option(
    "--claude",
    "Deploy Claude Code config (personal files, agents, workflows)",
  )
  .option("--claude-backup", "Backup personal Claude config to configs/claude/")
  .option("--claude-update", "Update cached config and sync Claude config")
  .option("--codex", "Deploy Codex config (AGENTS.md) to ~/.codex/")
  .option("--codex-backup", "Backup ~/.codex/AGENTS.md to configs/codex/")
  .option(
    "--agent-os",
    "Provision Agent OS (~/agent-os) at the pinned SHA + customization",
  )
  .option("--skills", "Sync skills from configured sources")
  .option("--skills-update", "Update cached skill sources")
  .option("--skills-list", "List available skills")
  .option("--superpowers", "Enable the Superpowers plugin for Claude Code")
  .option("--zed", "Sync Zed config from configs/zed/ to ~/.config/zed/")
  .option(
    "--zed-backup",
    "Backup Zed config to configs/zed/ (sanitizes sensitive data)",
  )
  .option("--zed-theme", "Sync Zed theme to ~/.config/zed/themes/")
  .option(
    "--caelestia-prefs",
    "Sync Caelestia hypr-user.conf + cli.json from configs/caelestia/ to ~/.config/caelestia/",
  )
  .option(
    "--caelestia-prefs-backup",
    "Backup Caelestia hypr-user.conf + cli.json from ~/.config/caelestia/ to configs/caelestia/",
  )
  .option(
    "--sddm-posthook",
    "Write the caelestia-sddm posthook sudoers rule (passwordless auto-sync of the SDDM login screen when Caelestia wallpaper/colours change)",
  )
  .option("--audio", "Sync audio config from configs/audio/ to ~/.config/")
  .option(
    "--audio-backup",
    "Backup audio config from ~/.config/ to configs/audio/",
  )
  .option(
    "--mimeapps",
    "Sync mimeapps.list from configs/mimeapps/ to ~/.config/",
  )
  .option(
    "--mimeapps-backup",
    "Backup mimeapps.list from ~/.config/ to configs/mimeapps/",
  )
  .option(
    "--lockfix",
    "Sync caelestia-lockfix kit from configs/caelestia-lockfix/ to ~/.local/share/caelestia-lockfix/",
  )
  .option(
    "--lockfix-backup",
    "Backup caelestia-lockfix kit from ~/.local/share/caelestia-lockfix/ to configs/caelestia-lockfix/",
  )
  .option(
    "--worktree-cleanup",
    "Deploy the ~/defi git-worktree cleanup script + systemd timer (configs/worktree-cleanup/ → live) and enable the Friday timer",
  )
  .option(
    "--worktree-cleanup-backup",
    "Backup the ~/defi worktree-cleanup script + systemd units to configs/worktree-cleanup/",
  )
  .option(
    "--claude-stay-awake",
    "Deploy the claude-stay-awake sleep inhibitor (configs/claude-stay-awake/ → live) and enable the systemd user service",
  )
  .option(
    "--claude-stay-awake-backup",
    "Backup the claude-stay-awake script + systemd unit to configs/claude-stay-awake/",
  )
  .option(
    "--pr-watch",
    "Deploy the pr-watch PR watcher (configs/pr-watch/ → ~/.local/bin/)",
  )
  .option(
    "--pr-watch-backup",
    "Backup the pr-watch PR watcher from ~/.local/bin/ to configs/pr-watch/",
  )
  .option("--kde-theme", "Deploy KDE Ocean theme files (sync only, no activate)")
  .option("--kde-theme-backup", "Backup KDE Ocean theme from system to configs/kde/")
  .option(
    "--kde-glass",
    "Install/reinstall KDE Glass blur effect (CachyOS/Arch only)",
  )
  .option(
    "--hyprland",
    "Install Hyprland + upstream Caelestia rice (CachyOS/Arch only). Asks about your current DE and which device this is; persists the device answer to ~/.haoshoku.json for future per-host configs.",
  )
  .action(async (options) => {
    try {
      await runAction(options);
    } catch (err) {
      log.error(err.message);
      log.dim(err.stack);
      process.exit(1);
    }
  });

async function runAction(options) {
    showBanner();

    // Mutually-exclusive mode flags: pass exactly one. Previously the if/return
    // chain silently ran only the first matching flag and ignored the rest.
    const activeFlags = [
      ...findActiveModeFlags(options),
      ...["prWatch", "prWatchBackup"].filter((flag) => options[flag]),
    ];
    if (activeFlags.length >= 2) {
      log.error(
        `--${activeFlags[0]} and --${activeFlags[1]} are mutually exclusive — pass exactly one mode flag`,
      );
      process.exit(2);
    }

    if (options.claudeUpdate) {
      await updateClaudeConfig();
      await syncClaudeConfig();
      return;
    }

    if (options.claudeBackup) {
      await backupClaudeConfig();
      return;
    }

    if (options.codexBackup) {
      await backupCodexConfig();
      return;
    }

    if (options.codex) {
      await syncCodexConfig();
      return;
    }

    if (options.agentOs) {
      await configureAgentOs();
      return;
    }

    if (options.superpowers) {
      await installSuperpowers();
      return;
    }

    if (options.skillsUpdate) {
      const result = syncSkills({ update: true });
      if (result.status === "all-failed") process.exit(1);
      return;
    }

    if (options.skills) {
      const result = syncSkills({ update: false });
      if (result.status === "all-failed") process.exit(1);
      return;
    }

    if (options.skillsList) {
      printAvailableSkills();
      return;
    }

    if (options.claude) {
      if (!fs.existsSync(CACHE_DIR)) {
        log.info("Cache is empty, syncing skills first...");
        const result = syncSkills({ update: false });
        if (result.status !== "ok") {
          log.warning(
            `Skill sync skipped (${result.status}) — continuing with config deploy.`,
          );
        }
      }

      await syncClaudeConfig();
      return;
    }

    if (options.zedBackup) {
      await backupZedConfig();
      return;
    }

    if (options.zed) {
      await syncZedConfig();
      return;
    }

    if (options.zedTheme) {
      await syncZedTheme();
      return;
    }

    if (options.caelestiaPrefsBackup) {
      await backupCaelestiaPrefs();
      return;
    }

    if (options.caelestiaPrefs) {
      await syncCaelestiaPrefs();
      return;
    }

    if (options.sddmPosthook) {
      await configureSddm();
      return;
    }

    if (options.audioBackup) {
      await backupAudioConfig();
      return;
    }

    if (options.audio) {
      await syncAudioConfig();
      return;
    }

    if (options.mimeappsBackup) {
      await backupMimeappsConfig();
      return;
    }

    if (options.mimeapps) {
      await syncMimeappsConfig();
      return;
    }

    if (options.lockfixBackup) {
      await backupLockfix();
      return;
    }

    if (options.lockfix) {
      await syncLockfix();
      return;
    }

    if (options.worktreeCleanupBackup) {
      await backupWorktreeCleanup();
      return;
    }

    if (options.worktreeCleanup) {
      await syncWorktreeCleanup();
      return;
    }

    if (options.claudeStayAwakeBackup) {
      await backupClaudeStayAwake();
      return;
    }

    if (options.claudeStayAwake) {
      await syncClaudeStayAwake();
      return;
    }

    if (options.prWatchBackup) {
      await backupPrWatch();
      return;
    }

    if (options.prWatch) {
      await syncPrWatch();
      return;
    }

    if (options.kdeThemeBackup) {
      await backupKdeTheme();
      return;
    }

    if (options.kdeTheme) {
      await syncKdeTheme();
      return;
    }

    if (options.kdeGlass) {
      await installKdeGlass();
      return;
    }

    if (options.hyprland) {
      const os = detectOS();
      if (os !== "cachyos") {
        log.error(
          `--hyprland is gated to CachyOS/Arch (detected: ${os || "unknown"}). Run on an Arch-family system.`,
        );
        process.exit(1);
      }
      const de = await promptDesktopEnvironment();
      if (de === null) {
        log.warning("Desktop environment prompt cancelled — aborting.");
        process.exit(0);
      }
      const device = await promptDeviceType();
      if (device === null) {
        log.info("Device type skipped (no entry written to ~/.haoshoku.json).");
      } else {
        log.info(`Recorded device type as '${device}' in ~/.haoshoku.json.`);
      }
      await installCaelestia({ skipHyprlandPackages: de === "hyprland" });
      log.success(
        "Caelestia installed. Log out and select 'Hyprland' at SDDM to use it.",
      );
      log.info(
        "Monitor configuration is your responsibility: edit ~/.config/caelestia/hypr-user.conf.",
      );
      return;
    }

    let osType = options.os;
    // Track whether osType came from silent auto-detection (vs the --os flag or
    // the interactive select prompt): a bare `haoshoku` must confirm before
    // mutating the system.
    let osAutoDetected = false;

    if (!osType) {
      const detected = detectOS();
      if (detected) {
        log.info(`Detected OS: ${detected}`);
        osType = detected;
        osAutoDetected = true;
      } else {
        const response = await prompts({
          type: "select",
          name: "os",
          message: "Select the target operating system:",
          choices: [
            { title: "CachyOS", value: "cachyos" },
            { title: "Debian Server", value: "debian-server" },
          ],
        });
        osType = response.os;
      }
    }

    if (!osType) {
      log.error("No OS selected. Exiting.");
      process.exit(1);
    }

    if (osAutoDetected) {
      // Bare `haoshoku` would otherwise launch a system-mutating setup with
      // zero confirmation. promptUser aborts the process on Ctrl+C.
      const proceed = await promptUser(
        `Detected ${osType} — run the full ${osType} setup now?`,
        true,
      );
      if (!proceed) {
        log.info("Setup cancelled. Exiting.");
        return;
      }
    }

    log.info(`Starting setup for: ${osType}`);

    switch (osType) {
      case "cachyos":
        await runCachyOSSetup();
        break;
      case "debian-server":
        await runDebianServerSetup();
        break;
      default:
        log.error(`Unsupported OS: ${osType}`);
        process.exit(1);
    }

    const syncResponse = await prompts({
      type: "confirm",
      name: "syncSkills",
      message: "Sync Claude Code skills from configured sources?",
      initial: true,
    });

    if (syncResponse.syncSkills) {
      syncSkills({ update: false });
    }
}

program.parse(process.argv);
