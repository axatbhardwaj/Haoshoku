#!/usr/bin/env bun

import { Command } from "commander";
import prompts from "prompts";
import { detectOS, findActiveModeFlags } from "./src/common/cli_utils.js";
import { promptDeviceType } from "./src/common/device_type.js";
import { getBanner, showBanner } from "./src/common/ui.js";
import { log, promptUser, runCommand } from "./src/common/utils.js";
import {
	backupAgentSkills,
	syncAgentSkills,
} from "./src/helpers/configure_agent_skills.js";
import {
	backupAgentsConfig,
	syncAgentsConfig,
} from "./src/helpers/configure_agents.js";
import {
	backupAudioConfig,
	syncAudioConfig,
} from "./src/helpers/configure_audio.js";
import {
	checkAxstack,
	configureAxstack,
} from "./src/helpers/configure_axstack.js";
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
import { configureDiscordTheme } from "./src/helpers/configure_discord_theme.js";
import {
	ensureGamingConfig,
	setGamingConfig,
	syncDeployedGamingAutostart,
} from "./src/helpers/configure_gaming.js";
import { installGhStack } from "./src/helpers/configure_gh_stack.js";
import { configureHermesRelay } from "./src/helpers/configure_hermes_relay.js";
import {
	backupHyprmoncfg,
	configureHyprmoncfg,
} from "./src/helpers/configure_hyprmoncfg.js";
import { configureKdeConnectCommands } from "./src/helpers/configure_kde_connect.js";
import {
	backupMimeappsConfig,
	syncMimeappsConfig,
} from "./src/helpers/configure_mimeapps.js";
import { configureOmarchyAppearance } from "./src/helpers/configure_omarchy_appearance.js";
import {
	backupOmarchyBar,
	configureOmarchyBar,
} from "./src/helpers/configure_omarchy_bar.js";
import { configureOmarchyPlugins } from "./src/helpers/configure_omarchy_plugins.js";
import { configureOmarchyWorkspaces } from "./src/helpers/configure_omarchy_workspaces.js";
import {
	backupPaseoProfiles,
	syncPaseoProfiles,
} from "./src/helpers/configure_paseo_profiles.js";
import {
	configurePaseoSchedules,
	runPaseoSchedules,
} from "./src/helpers/configure_paseo_schedules.js";
import { configurePaseoServer } from "./src/helpers/configure_paseo_server.js";
import {
	ensurePaseoTaskConfig,
	setPaseoTaskConfig,
} from "./src/helpers/configure_paseo_tasks.js";
import {
	backupPrWatch,
	syncPrWatch,
} from "./src/helpers/configure_pr_watch.js";
import { configureSkills, listSkills } from "./src/helpers/configure_skills.js";
import { configureT3CodeServer } from "./src/helpers/configure_t3_code_server.js";
import { setExplainerTheme } from "./src/helpers/configure_visual_explainer.js";
import {
	backupWorktreeCleanup,
	syncWorktreeCleanup,
} from "./src/helpers/configure_worktree_cleanup.js";
import { installUserScripts } from "./src/helpers/install_user_scripts.js";
import { runCachyOSSetup } from "./src/os_scripts/cachyos.js";
import { runDebianServerSetup } from "./src/os_scripts/debian_server.js";

const program = new Command();

function parseEnabledState(value) {
	if (value === "enabled") return true;
	if (value === "disabled") return false;
	return null;
}

program
	.name("haoshoku")
	.description("Haoshoku: portable setup for Arch / Omarchy and Debian Server.")
	.version("11.13.3")
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
		"--agents",
		"Deploy shared agent profile (PROFILE.md) to Claude, Codex, Opencode and Antigravity",
	)
	.option(
		"--agents-backup",
		"Backup live Claude profile to configs/agent-profile/PROFILE.md",
	)
	.option("--axstack", "Install or update the pinned Axstack release")
	.option("--axstack-check", "Check Axstack release and harness setup")
	.option(
		"--server-t3-code",
		"Configure the T3 Code headless service and T3 Connect on Debian",
	)
	.option(
		"--server-paseo",
		"Configure the native Paseo headless service on Debian",
	)
	.option("--server-hermes-relay", "Configure Hermes relay transport on Debian")
	.option(
		"--skills",
		"Install Matt Pocock and Paseo skills for Claude Code and Codex",
	)
	.option("--skills-update", "Refresh Matt Pocock and Paseo skills")
	.option("--skills-list", "List globally installed skills")
	.option("--agent-skills", "Deploy Haoshoku agent skills")
	.option("--agent-skills-backup", "Backup Haoshoku-owned orchestration skills")
	.option("--paseo-tasks", "Configure the default Paseo task lifecycle policy")
	.option(
		"--paseo-schedules",
		"Configure explicit local Paseo schedule mappings",
	)
	.option(
		"--paseo-schedules-check",
		"Preview configured local Paseo schedule model differences",
	)
	.option(
		"--paseo-schedules-apply",
		"Back up, update, and verify configured local Paseo schedules",
	)
	.option(
		"--paseo-tasks-enabled <state>",
		"Set Paseo task lifecycle (enabled or disabled)",
	)
	.option(
		"--paseo-task-cleanup <mode>",
		"Set completed-task cleanup (archive or keep)",
	)
	.option(
		"--paseo-task-renaming <state>",
		"Set task chat renaming (enabled or disabled)",
	)
	.option(
		"--explainer-theme <theme>",
		"Set visual-explainer theme (dark, light, system)",
	)
	.option("--paseo-profiles", "Deploy managed Paseo orchestration policy")
	.option(
		"--paseo-profiles-backup",
		"Backup the secret-free Paseo orchestration policy",
	)
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
		"--gaming",
		"Ensure the gaming autostart defaults (Steam on, Omakade off) in ~/.config/haoshoku/gaming.json",
	)
	.option(
		"--gaming-steam-autostart <state>",
		"Set Steam login autostart into special:steam (enabled or disabled)",
	)
	.option(
		"--gaming-omakade-autostart <state>",
		"Set Omakade login autostart on workspace 2 (enabled or disabled)",
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
	.option(
		"--discord-theme",
		"Deploy the Omarchy theme's Vencord CSS into Vesktop/Vencord from configs/discord/theme.json",
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

	if (options.agentsBackup) {
		await backupAgentsConfig();
		return;
	}

	if (options.agents) {
		await syncAgentsConfig();
		return;
	}

	if (options.axstack) {
		if (!(await configureAxstack()).ok) process.exitCode = 1;
		return;
	}

	if (options.axstackCheck) {
		if (!(await checkAxstack()).ok) process.exitCode = 1;
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

	if (options.serverPaseo) {
		if (detectOS() !== "debian-server") {
			log.error("--server-paseo requires a Debian-family host.");
			process.exitCode = 2;
			return;
		}
		if (!(await configurePaseoServer())) process.exitCode = 1;
		return;
	}

	if (options.serverHermesRelay) {
		if (detectOS() !== "debian-server") {
			log.error("--server-hermes-relay requires a Debian-family host.");
			process.exitCode = 2;
			return;
		}
		if (!(await configureHermesRelay())) process.exitCode = 1;
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

	if (options.agentSkillsBackup) {
		if (!backupAgentSkills()) process.exit(1);
		return;
	}

	if (options.agentSkills) {
		if (!syncAgentSkills()) process.exit(1);
		return;
	}

	if (options.paseoTasks) {
		if (!ensurePaseoTaskConfig()) process.exitCode = 1;
		return;
	}

	if (options.paseoSchedules) {
		if (!(await configurePaseoSchedules())) process.exitCode = 1;
		return;
	}

	if (options.paseoSchedulesCheck) {
		const result = await runPaseoSchedules("check");
		if (!result.ok) process.exitCode = 1;
		return;
	}

	if (options.paseoSchedulesApply) {
		const result = await runPaseoSchedules("apply");
		if (!result.ok) process.exitCode = 1;
		return;
	}

	if (options.paseoTasksEnabled !== undefined) {
		const enabled = parseEnabledState(options.paseoTasksEnabled);
		if (enabled === null || !setPaseoTaskConfig({ enabled })) {
			if (enabled === null) {
				log.error("Paseo task lifecycle must be enabled or disabled.");
			}
			process.exitCode = 1;
		}
		return;
	}

	if (options.paseoTaskCleanup !== undefined) {
		if (!setPaseoTaskConfig({ cleanup: options.paseoTaskCleanup })) {
			process.exitCode = 1;
		}
		return;
	}

	if (options.paseoTaskRenaming !== undefined) {
		const renameChats = parseEnabledState(options.paseoTaskRenaming);
		if (renameChats === null || !setPaseoTaskConfig({ renameChats })) {
			if (renameChats === null) {
				log.error("Paseo task renaming must be enabled or disabled.");
			}
			process.exitCode = 1;
		}
		return;
	}

	if (options.explainerTheme) {
		if (!setExplainerTheme(options.explainerTheme)) process.exitCode = 1;
		return;
	}

	if (options.paseoProfilesBackup) {
		if (!backupPaseoProfiles()) process.exit(1);
		return;
	}

	if (options.paseoProfiles) {
		if (!(await syncPaseoProfiles())) process.exit(1);
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

	if (options.gaming) {
		if (!ensureGamingConfig()) process.exitCode = 1;
		return;
	}

	if (options.gamingSteamAutostart !== undefined) {
		const steamAutostart = parseEnabledState(options.gamingSteamAutostart);
		if (steamAutostart === null || !setGamingConfig({ steamAutostart })) {
			if (steamAutostart === null) {
				log.error("Steam autostart must be enabled or disabled.");
			}
			process.exitCode = 1;
			return;
		}
		syncDeployedGamingAutostart();
		if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
			await runCommand("hyprctl reload");
		}
		return;
	}

	if (options.gamingOmakadeAutostart !== undefined) {
		const omakadeAutostart = parseEnabledState(options.gamingOmakadeAutostart);
		if (omakadeAutostart === null || !setGamingConfig({ omakadeAutostart })) {
			if (omakadeAutostart === null) {
				log.error("Omakade autostart must be enabled or disabled.");
			}
			process.exitCode = 1;
			return;
		}
		syncDeployedGamingAutostart();
		if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
			await runCommand("hyprctl reload");
		}
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

	if (options.discordTheme) {
		const result = await configureDiscordTheme();
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
