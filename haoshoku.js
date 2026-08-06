#!/usr/bin/env bun
import fs from "node:fs";

import { Command } from "commander";
import prompts from "prompts";
import { detectOS, findActiveModeFlags } from "./src/common/cli_utils.js";
import { getBanner, showBanner } from "./src/common/ui.js";
import { log, promptUser } from "./src/common/utils.js";
import { configureAgentOs } from "./src/helpers/configure_agent_os.js";
import {
	backupAudioConfig,
	syncAudioConfig,
} from "./src/helpers/configure_audio.js";
import {
	backupClaudeConfig,
	bootstrapClaudePolicy,
	installSuperpowers,
	syncClaudeConfig,
	updateClaudeConfig,
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
import {
	backupMimeappsConfig,
	syncMimeappsConfig,
} from "./src/helpers/configure_mimeapps.js";
import { configureOmarchyWorkspaces } from "./src/helpers/configure_omarchy_workspaces.js";
import {
	backupPrWatch,
	syncPrWatch,
} from "./src/helpers/configure_pr_watch.js";
import {
	backupWorktreeCleanup,
	syncWorktreeCleanup,
} from "./src/helpers/configure_worktree_cleanup.js";
import { installUserScripts } from "./src/helpers/install_user_scripts.js";
import {
	CACHE_DIR,
	printAvailableSkills,
	syncSkills,
} from "./src/helpers/skill_manager.js";
import { runCachyOSSetup } from "./src/os_scripts/cachyos.js";
import { runDebianServerSetup } from "./src/os_scripts/debian_server.js";

const program = new Command();

program
	.name("haoshoku")
	.description("Haoshoku: portable setup for Arch / Omarchy and Debian Server.")
	.version("7.6.0")
	.addHelpText("before", getBanner());

program
	.option("--os <type>", "Specify the target OS (arch, debian-server)")
	.option(
		"--claude",
		"Deploy Claude Code config (CLAUDE.md, statusline, .gitignore)",
	)
	.option(
		"--claude-backup",
		"Backup Claude Code personal files to configs/claude/",
	)
	.option(
		"--claude-remote-control",
		"Deploy Claude Remote Control supervisor and user services",
	)
	.option(
		"--claude-remote-control-backup",
		"Backup Claude Remote Control supervisor and user unit",
	)
	.option(
		"--claude-bootstrap",
		"Bootstrap private policy repository at ~/.claude/",
	)
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
	.option(
		"--scripts",
		"Deploy user scripts (configs/scripts/ → ~/.local/bin/) and prune retired entries",
	)
	.option(
		"--workspaces",
		"Deploy workspace config to ~/.config/hypr/, install helper script to ~/.local/bin/, add source line to ~/.config/hypr/hyprland.conf, and reload Hyprland",
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
		await updateClaudeConfig();
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

	if (options.claudeBootstrap) {
		await bootstrapClaudePolicy();
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

	if (options.scripts) {
		await installUserScripts();
		return;
	}

	if (options.workspaces) {
		await configureOmarchyWorkspaces();
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
