#!/usr/bin/env bun
import fs from "node:fs";

import { Command } from "commander";
import prompts from "prompts";
import { getBanner, showBanner } from "./src/common/ui.js";
import { log } from "./src/common/utils.js";
import {
  backupClaudeConfig,
  installSuperpowers,
  syncClaudeConfig,
  updateClaudeConfig,
} from "./src/helpers/configure_claude.js";
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
  .version("5.2.0")
  .addHelpText("before", getBanner());

function detectOS() {
  try {
    const osRelease = fs.readFileSync("/etc/os-release", "utf-8");
    const lines = osRelease.split("\n");
    const info = {};
    for (const line of lines) {
      const [key, value] = line.split("=");
      if (key && value) {
        info[key] = value.replace(/"/g, "");
      }
    }

    const id = info.ID ? info.ID.toLowerCase() : "";
    const idLike = info.ID_LIKE ? info.ID_LIKE.toLowerCase() : "";

    if (id.includes("cachyos") || idLike.includes("arch")) {
      return "cachyos";
    }
    if (id.includes("debian") || idLike.includes("debian")) {
      return "debian-server";
    }
  } catch (_e) {
    // Ignore error if file doesn't exist
  }
  return null;
}

program
  .option("--os <type>", "Specify the target OS (cachyos, debian-server)")
  .option(
    "--claude",
    "Deploy Claude Code config (personal files, conventions, agents)",
  )
  .option("--claude-backup", "Backup personal Claude config to configs/claude/")
  .option("--claude-update", "Update cached config and sync Claude config")
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
    showBanner();

    if (options.claudeUpdate) {
      await updateClaudeConfig();
      await syncClaudeConfig();
      return;
    }

    if (options.claudeBackup) {
      await backupClaudeConfig();
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

    if (!osType) {
      const detected = detectOS();
      if (detected) {
        log.info(`Detected OS: ${detected}`);
        osType = detected;
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
  });

program.parse(process.argv);
