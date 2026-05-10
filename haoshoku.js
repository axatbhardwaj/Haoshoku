#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";

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
  backupZedConfig,
  syncZedConfig,
  syncZedTheme,
} from "./src/helpers/configure_zed.js";
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
  .version("4.2.1")
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
  .option("--kde-theme", "Deploy KDE Ocean theme files (sync only, no activate)")
  .option("--kde-theme-backup", "Backup KDE Ocean theme from system to configs/kde/")
  .option(
    "--kde-glass",
    "Install/reinstall KDE Glass blur effect (CachyOS/Arch only)",
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
      syncSkills({ update: true });
      return;
    }

    if (options.skills) {
      syncSkills({ update: false });
      return;
    }

    if (options.skillsList) {
      printAvailableSkills();
      return;
    }

    if (options.claude) {
      if (!fs.existsSync(CACHE_DIR)) {
        log.info("Cache is empty, syncing skills first...");
        syncSkills({ update: false });
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
