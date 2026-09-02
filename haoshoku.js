#!/usr/bin/env bun

import { Command } from "commander";
import prompts from "prompts";
import { detectOS, findActiveModeFlags } from "./src/common/cli_utils.js";
import { promptDeviceType } from "./src/common/device_type.js";
import { getBanner, showBanner } from "./src/common/ui.js";
import { log, promptUser } from "./src/common/utils.js";
import {
	backupAudioConfig,
	syncAudioConfig,
} from "./src/helpers/configure_audio.js";
import { configureBraveManagedPolicies } from "./src/helpers/configure_brave_managed_policies.js";
import {
	backupClaudeConfig,
	syncClaudeConfig,
} from "./src/helpers/configure_claude.js";
import {
	backupClaudeRemoteControl,
	syncClaudeRemoteControl,
} from "./src/helpers/configure_claude_remote_control.js";
import {
	backupClaudeStayAwake,
	syncClaudeStayAwake,
} from "./src/helpers/configure_claude_stay_awake.js";
import {
	backupCodexConfig,
	syncCodexConfig,
} from "./src/helpers/configure_codex.js";
import { installGhStack } from "./src/helpers/configure_gh_stack.js";
import { configureKdeConnectCommands } from "./src/helpers/configure_kde_connect.js";
import {
	backupHyprmoncfg,
	configureHyprmoncfg,
} from "./src/helpers/configure_hyprmoncfg.js";
import {
	backupMimeappsConfig,
	syncMimeappsConfig,
} from "./src/helpers/configure_mimeapps.js";
import {
	backupOmarchyBar,
	configureOmarchyBar,
} from "./src/helpers/configure_omarchy_bar.js";
import { configureOmarchyAppearance } from "./src/helpers/configure_omarchy_appearance.js";
import { configureOmarchyPlugins } from "./src/helpers/configure_omarchy_plugins.js";
import { configureOmarchyWorkspaces } from "./src/helpers/configure_omarchy_workspaces.js";
import {
	backupPrWatch,
	syncPrWatch,
} from "./src/helpers/configure_pr_watch.js";
import { configureT3CodeServer } from "./src/helpers/configure_t3_code_server.js";
import {
	backupWorktreeCleanup,
	syncWorktreeCleanup,
} from "./src/helpers/configure_worktree_cleanup.js";
import { installUserScripts } from "./src/helpers/install_user_scripts.js";
import { configureSkills, listSkills } from "./src/helpers/configure_skills.js";
import { runCachyOSSetup } from "./src/os_scripts/cachyos.js";
import { runDebianServerSetup } from "./src/os_scripts/debian_server.js";

const program = new Command();

program
	.name("haoshoku")
	.description("Haoshoku: portable setup for Arch / Omarchy and Debian Server.")
	.version("11.2.6")
	.addHelpText("before", getBanner());

program
	.option("--os <type>", "Specify the target OS (arch, debian-server)")
	.option(
		"--claude",
		"Deploy Claude Code config (CLAUDE.md, statusline, .gitignore)",
	)
	.option(
		"--claude-backup",
		"Backup Claude Code config (CLAUDE.md, statusline, .gitignore)",
	)
	.option(
		"--claude-remote-control",
		"Deploy Claude Remote Control supervisor and user services",
	)
	.option(
		"--claude-remote-control-backup",
		"Backup Claude Remote Control supervisor and user unit",
	)
	.option("--claude-update", "Redeploy the packaged Claude Code config")
	.option("--codex", "Deploy Codex config (AGENTS.md) to ~/.codex/")
	.option("--codex-backup", "Backup ~/.codex/AGENTS.md to configs/codex/")
	.option(
		"--server-t3-code",
		"Configure the T3 Code headless service and T3 Connect on Debian",
	)
	.option("--skills", "Install Matt Pocock skills for Claude Code and Codex")
	.option("--skills-update", "Refresh Matt Pocock skills")
	.option("--skills-list", "List globally installed skills")
	.option(
		"--gh-stack",
		"Install GitHub's gh-stack extension for stacked pull requests",
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
	.option("--device-type <type>", "Set device type (pc or laptop)")
	.option(
		"--scripts",
		"Deploy user scripts (configs/scripts/ → ~/.local/bin/) and prune retired entries",
	)
	.option(
		"--workspaces",
		"Deploy the two Lua overlay modules under ~/.config/hypr/haoshoku/, install the helper script, and register the two requires in ~/.config/hypr/hyprland.lua",
	)
	.option(
		"--monitors",
		"Deploy hyprmoncfg profile JSON to ~/.config/hyprmoncfg/profiles/, ensure and enable hyprmoncfg",
	)
	.option(
		"--hyprmoncfg-backup",
		"Backup live hyprmoncfg profile JSON to configs/hyprmoncfg/profiles/",
	)
	.option(
		"--omarchy-plugins",
		"Configure the Omarchy plugins declared in common/omarchy-plugins.json",
	)
	.option(
		"--kde-connect-commands",
		"Add Haoshoku remote commands to every paired KDE Connect device",
	)
	.option(
		"--omarchy-bar",
		"Deploy configs/omarchy/bar.json into the bar key of Omarchy shell.json",
	)
	.option(
		"--omarchy-bar-backup",
		"Backup the bar key from Omarchy shell.json to configs/omarchy/bar.json",
	)
	.option(
		"--omarchy-appearance",
		"Apply the pinned Omarchy theme, background, and font from configs/omarchy/appearance.json",
	)
	.option("--3-4-migrate", "Migrate an Omarchy 3 configuration to Omarchy 4")
	.option(
		"--brave-managed-policies",
		"Configure Brave managed policies used by Omarchy browser theming",
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
	const activeFlags = findActiveModeFlags(options);
	if (activeFlags.length >= 2) {
		log.error(
			`--${activeFlags[0]} and --${activeFlags[1]} are mutually exclusive — pass exactly one mode flag`,
		);
		process.exit(2);
	}

	if (options.claudeUpdate) {
		await syncClaudeConfig();
		return;
	}

	if (options.claudeBackup) {
		await backupClaudeConfig();
		return;
	}

	if (options.claudeRemoteControlBackup) {
		if (!(await backupClaudeRemoteControl())) process.exit(1);
		return;
	}

	if (options.claudeRemoteControl) {
		if (!(await syncClaudeRemoteControl())) process.exit(1);
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

	if (options.serverT3Code) {
		if (detectOS() !== "debian-server") {
			log.error("--server-t3-code requires a Debian-family host.");
			process.exitCode = 2;
			return;
		}
		if (!(await configureT3CodeServer())) process.exitCode = 1;
		return;
	}

	if (options.ghStack) {
		const result = await installGhStack();
		if (result !== "installed" && result !== "already-installed") {
			process.exitCode = 1;
		}
		return;
	}

	if (options.skillsUpdate) {
		if (!(await configureSkills())) process.exit(1);
		return;
	}

	if (options.skills) {
		if (!(await configureSkills())) process.exit(1);
		return;
	}

	if (options.skillsList) {
		if (!(await listSkills())) process.exit(1);
		return;
	}

	if (options.claude) {
		await syncClaudeConfig();
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

	if (options.deviceType !== undefined) {
		if (!["pc", "laptop"].includes(options.deviceType)) {
			log.error("Device type must be pc or laptop.");
			process.exitCode = 2;
			return;
		}
		await promptDeviceType({
			forcedDeviceType: options.deviceType,
		});
		return;
	}

	if (options.scripts) {
		await installUserScripts();
		return;
	}

	if (options.workspaces) {
		await configureOmarchyWorkspaces();
		return;
	}

	if (options.monitors) {
		await configureHyprmoncfg();
		return;
	}

	if (options.hyprmoncfgBackup) {
		await backupHyprmoncfg();
		return;
	}

	if (options.omarchyPlugins) {
		await configureOmarchyPlugins();
		return;
	}

	if (options.kdeConnectCommands) {
		const result = await configureKdeConnectCommands();
		if (result.failed.length > 0) process.exitCode = 1;
		return;
	}

	if (options.omarchyBar) {
		await configureOmarchyBar();
		return;
	}

	if (options.omarchyBarBackup) {
		await backupOmarchyBar();
		return;
	}

	if (options.omarchyAppearance) {
		const result = await configureOmarchyAppearance();
		if (result.status !== "configured") process.exitCode = 1;
		return;
	}

	if (options["34Migrate"]) {
		const { migrateOmarchy3To4 } = await import(
			"./src/helpers/migrate_omarchy_3_to_4.js"
		);
		const result = await migrateOmarchy3To4();
		const status = result?.status ?? "failed";
		const summary = `Omarchy 3→4 migration status: ${status}`;
		for (const step of result?.steps ?? []) {
			log.info(`${step.name}: ${step.status}`);
		}
		const backupPaths = new Set();
		const collectBackups = (value) => {
			if (Array.isArray(value)) {
				for (const item of value) collectBackups(item);
				return;
			}
			if (!value || typeof value !== "object") return;
			for (const [key, child] of Object.entries(value)) {
				if (
					(key === "backup" || key === "restoredFrom") &&
					typeof child === "string"
				) {
					backupPaths.add(child);
				} else collectBackups(child);
			}
		};
		collectBackups(result?.steps ?? []);
		for (const backup of backupPaths) log.info(`Backup: ${backup}`);
		if (result?.manualAuthChecklist?.length > 0) {
			log.info("Manual-auth checklist:");
			for (const item of result.manualAuthChecklist) {
				log.info(`  - ${item.id}: ${item.requirement}`);
			}
		}
		if (result?.laptopFollowUp) log.info(result.laptopFollowUp);
		if (result?.recoveryInstruction) {
			log.info(`Recovery: ${result.recoveryInstruction}`);
		}
		if (status === "completed") {
			log.success(summary);
		} else {
			if (status === "failed") log.error(summary);
			else log.warning(summary);
			process.exitCode = 1;
		}
		return;
	}

	if (options.braveManagedPolicies) {
		if (!(await configureBraveManagedPolicies())) process.exit(1);
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
			if (!process.stdin.isTTY) {
				log.warning(
					"Interactive OS selection unavailable; declining setup. Re-run with --os arch or --os debian-server.",
				);
				process.exitCode = 1;
				return;
			}
			const response = await prompts({
				type: "select",
				name: "os",
				message: "Select the target operating system:",
				choices: [
					{ title: "Arch / Omarchy", value: "arch" },
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
		case "arch":
		case "cachyos":
			if (osType === "cachyos") {
				log.warning("--os cachyos is deprecated; use --os arch.");
			}
			if (!(await runCachyOSSetup())) {
				process.exitCode = 1;
				return;
			}
			break;
		case "debian-server":
			if (!(await runDebianServerSetup())) {
				process.exitCode = 1;
				return;
			}
			break;
		default:
			log.error(`Unsupported OS: ${osType}`);
			process.exit(1);
	}
}

program.parse(process.argv);
