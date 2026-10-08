#!/usr/bin/env bun

import { Command } from "commander";
import {
	configureExecutorClients,
	validateExecutorClientInput,
	EXECUTOR_CLIENT_USAGE,
} from "./src/helpers/configure_executor_clients.js";
import prompts from "prompts";
import { startRunLog } from "./src/common/run_log.js";
import { detectOS, findActiveModeFlags } from "./src/common/cli_utils.js";
import { promptDeviceType } from "./src/common/device_type.js";
import { getBanner, showBanner } from "./src/common/ui.js";
import { log, promptUser, runCommand } from "./src/common/utils.js";
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
import { configureSplitLockSudoers } from "./src/helpers/configure_split_lock_sudoers.js";
import {
	backupClaudeConfig,
	syncClaudeConfig,
} from "./src/helpers/configure_claude.js";
import {
	backupCodexConfig,
	syncCodexConfig,
} from "./src/helpers/configure_codex.js";
import {
	configureExecutorServer,
	parseExecutorOrigin,
} from "./src/helpers/configure_executor_server.js";
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
import { configureTailscaleT3 } from "./src/helpers/configure_tailscale_t3.js";
import { configureT3CodeServer } from "./src/helpers/configure_t3_code_server.js";
import {
	backupWorktreeCleanup,
	syncWorktreeCleanup,
} from "./src/helpers/configure_worktree_cleanup.js";
import { installUserScripts } from "./src/helpers/install_user_scripts.js";
import { shareLog } from "./src/helpers/share_log.js";
import { runCachyOSSetup } from "./src/os_scripts/cachyos.js";
import { runDebianServerSetup } from "./src/os_scripts/debian_server.js";

// Check raw arguments before parsing or starting logs so retired commands cannot
// fall through to setup, including malformed values and combined modes.
const retiredOption = process.argv
	.slice(2)
	.find((arg) =>
		[
			"--skills",
			"--skills-update",
			"--skills-list",
			"--agent-skills",
			"--explainer-theme",
			"--claude-remote-control",
			"--claude-remote-control-backup",
			"--claude-stay-awake",
			"--claude-stay-awake-backup",
			"--pr-watch",
			"--pr-watch-backup",
		].includes(arg.split("=")[0]),
	);
if (retiredOption) {
	const flag = retiredOption.split("=")[0];
	const guidance =
		flag.startsWith("--claude-") || flag.startsWith("--pr-watch")
			? "Manage existing services and watchers separately; existing installations are left untouched."
			: "Manage independent skills separately; existing skills are left untouched.";
	console.error(
		`${flag} has been retired from Haoshoku. ${guidance} Use haoshoku --axstack for Axstack workflows.`,
	);
	process.exit(2);
}

const clientArgs = process.argv.slice(2);
const clientMode = clientArgs.some(
	(arg) => arg.split("=")[0] === "--executor-clients",
);
let clientEndpoint;
if (clientMode && !clientArgs.some((arg) => ["--help", "-h"].includes(arg))) {
	try {
		const inline = clientArgs[0]?.startsWith("--executor-clients=");
		if (
			!(inline && clientArgs.length === 1) &&
			!(clientArgs[0] === "--executor-clients" && clientArgs.length === 2)
		)
			throw new Error(EXECUTOR_CLIENT_USAGE);
		clientEndpoint = validateExecutorClientInput(
			inline
				? clientArgs[0].slice("--executor-clients=".length)
				: clientArgs[1],
		);
	} catch (error) {
		console.error(error.message);
		process.exit(2);
	}
}

const executorArgs = process.argv.slice(2);
const executorIndex = executorArgs.findIndex(
	(arg) => arg.split("=")[0] === "--server-executor",
);
let executorOrigin;
if (executorIndex !== -1 && !executorArgs.includes("--help")) {
	const flag = executorArgs[executorIndex];
	const value = flag.includes("=")
		? flag.slice(flag.indexOf("=") + 1)
		: executorArgs[executorIndex + 1];
	executorOrigin = parseExecutorOrigin(value);
	const extra = executorArgs.some(
		(arg, index) =>
			index !== executorIndex &&
			index !== executorIndex + (flag.includes("=") ? 0 : 1) &&
			!arg.startsWith("-") &&
			executorArgs[index - 1] !== "--os",
	);
	if (
		!executorOrigin ||
		extra ||
		executorArgs.filter((arg) => arg.split("=")[0] === "--server-executor")
			.length !== 1
	) {
		console.error(
			"Usage: haoshoku --server-executor <https-origin>. Supply HTTPS, a host and optional port only; no credentials, paths, query or fragment.",
		);
		process.exit(2);
	}
	const osOption = executorArgs.find((arg) => arg.startsWith("--os="));
	const explicitOS = osOption
		? osOption.slice(5)
		: executorArgs.includes("--os")
			? executorArgs[executorArgs.indexOf("--os") + 1]
			: undefined;
	if (
		detectOS() !== "debian-server" ||
		(explicitOS !== undefined && explicitOS !== "debian-server")
	) {
		console.error(
			"--server-executor requires a Debian-family host; configure external DNS/TLS/nginx first.",
		);
		process.exit(2);
	}
}

const program = new Command();

function parseEnabledState(value) {
	if (value === "enabled") return true;
	if (value === "disabled") return false;
	return null;
}

program
	.name("haoshoku")
	.description("Haoshoku: portable setup for Arch / Omarchy and Debian Server.")
	.version("12.3.1")
	.addHelpText("before", getBanner());

const informational = process.argv
	.slice(2)
	.some(
		(arg) =>
			["--help", "-h", "--version", "-V", "--share-log"].includes(arg) ||
			arg.startsWith("--share-log="),
	);
const runLog = informational
	? null
	: startRunLog({
			version: program.version(),
			argv: clientMode
				? [
						process.argv[0],
						process.argv[1],
						"--executor-clients",
						"[https-endpoint]",
					]
				: executorIndex === -1
					? process.argv
					: [
							process.argv[0],
							process.argv[1],
							"--server-executor",
							"[public-origin]",
						],
		});
if (runLog) process.once("exit", (code) => runLog.finish(code));

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
	.option("--claude-update", "Redeploy the packaged Claude Code config")
	.option(
		"--codex",
		"Deploy Codex AGENTS.md and native status line to ~/.codex/",
	)
	.option(
		"--codex-backup",
		"Backup Codex AGENTS.md and status line to configs/codex/",
	)
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
		"Configure the T3 Code headless service over Tailscale on Debian (keeps Grok CLI on PATH)",
	)
	.option(
		"--tailscale-t3",
		"Configure Tailscale login and T3 Code phone access on Arch",
	)
	.option("--server-hermes-relay", "Configure Hermes relay transport on Debian")
	.option(
		"--server-executor <https-origin>",
		"Provision Executor on Debian (opt-in; external HTTPS proxy required)",
	)
	.option(
		"--executor-clients <https-endpoint>",
		"Register Executor HTTP MCP for Claude Code and Codex (user scope, opt-in)",
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
	.option("--device-type <type>", "Set device type (pc or laptop)")
	.option(
		"--scripts",
		"Deploy user scripts (configs/scripts/ → ~/.local/bin/) and prune retired entries",
	)
	.option(
		"--workspaces",
		"Deploy the Lua workspace overlays and app helpers, create ~/.config/haoshoku/primary-app, and register the overlay requires in ~/.config/hypr/hyprland.lua",
	)
	.option(
		"--gaming",
		"Ensure the gaming autostart defaults (Steam on, Omakade off) in ~/.config/haoshoku/gaming.json",
	)
	.option(
		"--gaming-split-lock",
		"Install the sudoers rule that lets game launches lift the kernel split-lock penalty while they run",
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
	.option("--share-log [path]", "Share the latest run log, or a specified log")
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

	if (options.executorClients) {
		if (!configureExecutorClients(clientEndpoint)) process.exitCode = 1;
		return;
	}

	if (options.serverExecutor) {
		if (!(await configureExecutorServer(executorOrigin))) process.exitCode = 1;
		return;
	}

	if (options.shareLog) {
		if (
			!(await shareLog(
				typeof options.shareLog === "string" ? options.shareLog : undefined,
			))
		)
			process.exitCode = 1;
		return;
	}

	if (options.claudeUpdate) {
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

	if (options.tailscaleT3) {
		if (detectOS() !== "arch") {
			log.error("--tailscale-t3 requires an Arch-family host.");
			process.exitCode = 2;
			return;
		}
		if (!(await configureTailscaleT3())) process.exitCode = 1;
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

	if (options.gamingSplitLock) {
		if (!(await configureSplitLockSudoers())) process.exitCode = 1;
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
