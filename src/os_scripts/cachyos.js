import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { PROJECT_ROOT } from "../common/paths.js";
import { promptDeviceType } from "../common/device_type.js";
import { withSpinner } from "../common/ui.js";
import {
	commandExists,
	log,
	promptUser,
	readDeviceType,
	runCommand,
	safeCopyFile,
	startSudoSession,
} from "../common/utils.js";
import { syncWorktreeCleanup } from "../helpers/configure_worktree_cleanup.js";
import { syncAgentsConfig } from "../helpers/configure_agents.js";
import { configureAudio } from "../helpers/configure_audio.js";
import { configureAxstack } from "../helpers/configure_axstack.js";
import { configureBash } from "../helpers/configure_bash.js";
import { configureBraveManagedPolicies } from "../helpers/configure_brave_managed_policies.js";
import { configureSplitLockSudoers } from "../helpers/configure_split_lock_sudoers.js";
import { configureChromiumProfiles } from "../helpers/configure_chromium_profiles.js";
import { configureClaude } from "../helpers/configure_claude.js";
import { configureCodex } from "../helpers/configure_codex.js";
import { installGhStack } from "../helpers/configure_gh_stack.js";
import { configureHyprmoncfg } from "../helpers/configure_hyprmoncfg.js";
import { configureKdeConnectCommands } from "../helpers/configure_kde_connect.js";
import { configureGhostty } from "../helpers/configure_ghostty.js";
import { configureMimeapps } from "../helpers/configure_mimeapps.js";
import { configureOmarchyAppearance } from "../helpers/configure_omarchy_appearance.js";
import { configureOmarchyBar } from "../helpers/configure_omarchy_bar.js";
import { configureOmarchyPlugins } from "../helpers/configure_omarchy_plugins.js";
import { configureOmarchyWorkspaces } from "../helpers/configure_omarchy_workspaces.js";
import { configureOmazed } from "../helpers/configure_omazed.js";
import { configureVoxtypeOsd } from "../helpers/configure_voxtype_osd.js";
import { configureTailscaleT3 } from "../helpers/configure_tailscale_t3.js";
import { configureFleetSsh } from "../helpers/configure_fleet_ssh.js";
import { installUserScripts } from "../helpers/install_user_scripts.js";

// URLs
const RUSTUP_URL = "https://sh.rustup.rs";
const PARU_AUR_URL = "https://aur.archlinux.org/paru.git";
const UV_INSTALL_URL = "https://astral.sh/uv/install.sh";
const FOUNDRY_INSTALL_URL = "https://foundry.paradigm.xyz";
const UOSC_INSTALL_URL =
	"https://raw.githubusercontent.com/tomasklaen/uosc/HEAD/installers/unix.sh";

// --- Constants ---
const HOME = homedir();
const _CARGO_HOME = path.join(HOME, ".cargo");
const PARU_BUILD_DIR = "/tmp/paru";
const FASTFETCH_CONFIG_DIR = path.join(HOME, ".config", "fastfetch");
// Project paths (resolved from script location, works from any cwd)
const COMMON_DIR = path.join(PROJECT_ROOT, "common");
const CONFIGS_DIR = path.join(PROJECT_ROOT, "configs");

const PARU_APPLIST_PATH = path.join(COMMON_DIR, "paru_applist.txt");
const IOBOX_APPLIST_PATH = path.join(COMMON_DIR, "paru_applist_iobox.txt");
const FLATPAK_APPLIST_PATH = path.join(COMMON_DIR, "flatpacks_arch.txt");
const CUSTOM_FASTFETCH_CONFIG_PATH = path.join(
	CONFIGS_DIR,
	"fastfetch",
	"config.jsonc",
);

// --- Helper Functions ---

import {
  getInstalledPackages, installArchPackageBatch, installGamingPackages,
  installPackagesFromFile, resolveAurHelper,
} from "./cachyos/packages.js";
export {
  normalizeArchPackageNames, resolveAurHelper, selectArchInstallCommand,
  installGamingPackages, getInstalledPackages, installArchPackageBatch,
} from "./cachyos/packages.js";

// --- Installation Functions ---

export async function prepareArchPackageManager({
	isOmarchy = false,
	runCommandImpl = runCommand,
} = {}) {
	log.info(
		"Refreshing package databases and performing a full system upgrade...",
	);
	const updateCommand = isOmarchy
		? "omarchy update -y"
		: "sudo -n pacman -Syu --noconfirm";
	if (!(await runCommandImpl(updateCommand))) {
		log.error(
			"System refresh and full upgrade failed. Aborting Arch setup before package installation.",
		);
		return false;
	}

	log.info(
		"Installing base-devel and git (required for makepkg / AUR builds)...",
	);
	if (
		!(await runCommandImpl(
			"sudo -n pacman -S --needed --noconfirm base-devel git",
		))
	) {
		log.error(
			"base-devel/git installation failed. Aborting Arch setup before AUR package installation.",
		);
		return false;
	}
	return true;
}

export async function ensureRustToolchain({
	commandExistsImpl = commandExists,
	runCommandImpl = runCommand,
	withSpinnerImpl = withSpinner,
} = {}) {
	if (
		(await commandExistsImpl("rustc")) &&
		(await commandExistsImpl("cargo"))
	) {
		log.info("Rust is already installed.");
		return true;
	}

	log.info("Installing Rust via rustup...");
	return Boolean(
		await withSpinnerImpl("Installing Rust", () =>
			runCommandImpl(`curl ${RUSTUP_URL} -sSf | sh -s -- -y`),
		),
	);
}

async function installAurHelper() {
	if (await commandExists("paru")) {
		log.info("Paru is already installed.");
		return;
	}
	log.info("Installing paru...");
	// Remove any leftover build dir from a prior failed run so git clone succeeds.
	fs.rmSync(PARU_BUILD_DIR, { recursive: true, force: true });
	const paruOk = await withSpinner("Installing paru", () =>
		runCommand(
			`git clone ${PARU_AUR_URL} ${PARU_BUILD_DIR} && cd ${PARU_BUILD_DIR} && makepkg -si --noconfirm`,
		),
	);
	if (!paruOk) {
		log.warning(
			"paru installation failed — AUR package installs will be unavailable.",
		);
	}
}

async function ensureAurHelper() {
	const existing = await resolveAurHelper();
	if (existing) {
		log.info(`${existing} is available for AUR packages.`);
		return existing;
	}
	await installAurHelper();
	return await resolveAurHelper();
}

async function installDevTools() {
	if (!(await commandExists("uv"))) {
		log.info("Installing uv...");
		await withSpinner("Installing uv", () =>
			runCommand(`curl -LsSf ${UV_INSTALL_URL} | sh`),
		);
	} else {
		log.info("uv already installed.");
	}

	if (!(await commandExists("foundryup"))) {
		log.info("Installing Foundry...");
		await withSpinner("Installing Foundry", () =>
			runCommand(`curl -L ${FOUNDRY_INSTALL_URL} | bash`),
		);
	} else {
		log.info("Foundry (foundryup) already installed.");
	}
}

async function setupFlatpakRemotes() {
	if (await commandExists("flatpak")) {
		log.info("Setting up Flatpak remotes...");
		await runCommand(
			"flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo",
		);
		await runCommand("flatpak update --user -y");
	} else {
		log.warning("Flatpak not found. Skipping remote setup.");
	}
}

// --- Configuration Functions ---

async function enableServices({
	deviceType,
	promptUserImpl = promptUser,
	commandExistsImpl = commandExists,
	runCommandImpl = runCommand,
} = {}) {
	if (
		deviceType !== "iobox" &&
		(await promptUserImpl("Enable Bluetooth?", false))
	) {
		log.info("Enabling Bluetooth service...");
		await runCommandImpl("sudo -n systemctl enable --now bluetooth");
	}

	if (
		(await commandExistsImpl("docker")) &&
		(await promptUserImpl("Enable Docker?", true))
	) {
		log.info("Enabling and starting Docker service...");
		await runCommandImpl("sudo -n systemctl enable --now docker");
		const user = process.env.USER;
		if (user) {
			await runCommandImpl(`sudo -n usermod -aG docker ${user}`);
			log.warning(
				`User ${user} added to docker group. Please log out and back in.`,
			);
		}
	}
}

async function configureFastfetch() {
	if (!(await commandExists("fastfetch"))) {
		log.warning("Fastfetch command not found. Skipping configuration.");
		return;
	}

	log.info("Configuring Fastfetch...");
	fs.mkdirSync(FASTFETCH_CONFIG_DIR, { recursive: true });
	if (fs.existsSync(CUSTOM_FASTFETCH_CONFIG_PATH)) {
		safeCopyFile(
			CUSTOM_FASTFETCH_CONFIG_PATH,
			path.join(FASTFETCH_CONFIG_DIR, "config.jsonc"),
		);
		log.info("Fastfetch user config updated.");
	} else {
		log.warning(
			`Custom Fastfetch config not found at ${CUSTOM_FASTFETCH_CONFIG_PATH}`,
		);
	}
}

export async function installSystemPackages(
	aurHelper,
	isOmarchy,
	{
		deviceType = "pc",
		installArchPackageBatchImpl = installArchPackageBatch,
		getInstalledPackagesImpl = getInstalledPackages,
		readFileImpl = fs.readFileSync,
		runCommandImpl = runCommand,
		promptUserImpl = promptUser,
		installGamingPackagesImpl = installGamingPackages,
		configureSplitLockSudoersImpl = configureSplitLockSudoers,
	} = {},
) {
	log.info("Preparing for package installation...");
	log.info("Installing packages from file lists...");
	const content = readFileImpl(
		deviceType === "iobox" ? IOBOX_APPLIST_PATH : PARU_APPLIST_PATH,
		"utf8",
	);
	const requested = content
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"));
	const result = await installArchPackageBatchImpl(requested, { aurHelper });
	for (const [label, packages] of [
		["failed", result.failed],
		["missing", result.missing],
		["invalid", result.invalid],
	]) {
		if (packages.length > 0) {
			log.warning(
				`${packages.length} package(s) ${label}:\n  ${packages.join("\n  ")}`,
			);
		}
	}

	const installed = await getInstalledPackagesImpl();
	if (
		!installed.has("ttf-jetbrains-mono-nerd") &&
		!installed.has("ttf-jetbrains-mono-nerd-basic")
	) {
		log.info("Installing JetBrains Mono Nerd Font...");
		await runCommandImpl(
			"sudo -n pacman -S --needed --noconfirm ttf-jetbrains-mono-nerd",
		);
	}

	if (
		deviceType !== "iobox" &&
		(await promptUserImpl("Enable gaming configuration?", false))
	) {
		await installGamingPackagesImpl({ aurHelper, isOmarchy });
		await configureSplitLockSudoersImpl({ nonInteractiveSudo: true });
	}
}

async function installFlatpakApps() {
	if (!(await commandExists("flatpak"))) {
		log.info("Installing Flatpak...");
		await runCommand("sudo -n pacman -S flatpak --noconfirm");
	}
	await setupFlatpakRemotes();
	await installPackagesFromFile(
		FLATPAK_APPLIST_PATH,
		"flatpak install --user -y flathub",
	);
}

export async function configureBrowserIntegration({
	deviceType = "pc",
	configureChromiumProfilesImpl = configureChromiumProfiles,
	configureMimeappsImpl = configureMimeapps,
	installUserScriptsImpl = installUserScripts,
} = {}) {
	if (deviceType !== "iobox") await configureChromiumProfilesImpl();
	await installUserScriptsImpl();
	if (deviceType !== "iobox") await configureMimeappsImpl();
}

export async function configureUserApps({
	syncWorktreeCleanupImpl = syncWorktreeCleanup,
	isOmarchy = false,
	deviceType = "pc",
	commandExistsImpl = commandExists,
	promptUserImpl = promptUser,
	configureGitImpl,
	configureBrowserIntegrationImpl = configureBrowserIntegration,
	configureAudioImpl = configureAudio,
	configureBashImpl = configureBash,
	configureFastfetchImpl = configureFastfetch,
	configureGhosttyImpl = configureGhostty,
	runCommandImpl = runCommand,
	enableServicesImpl = enableServices,
	configureClaudeImpl = configureClaude,
	installGhStackImpl = installGhStack,
	configureCodexImpl = configureCodex,
	syncAgentsConfigImpl = syncAgentsConfig,
	configureAxstackImpl = configureAxstack,
} = {}) {
	if (!isOmarchy && (await promptUserImpl("Configure git?", true))) {
		const configureGit =
			configureGitImpl ??
			(await import("../helpers/configure_git.js")).configureGit;
		await configureGit();
	}

	await configureBrowserIntegrationImpl({ deviceType });
	try {
		if (deviceType !== "iobox") await configureAudioImpl();
	} catch (err) {
		log.warning(
			`Audio config sync failed (${err?.message ?? err}) — continuing with remaining app setup.`,
		);
	}

	configureBashImpl();
	await configureFastfetchImpl();
	await configureGhosttyImpl();

	if (deviceType !== "iobox") {
		log.info("Installing uosc for MPV...");
		await runCommandImpl(`curl -fsSL ${UOSC_INSTALL_URL} | bash`);
	}

	await enableServicesImpl({
		deviceType,
		promptUserImpl,
		commandExistsImpl,
		runCommandImpl,
	});
	const claudeResult = await configureClaudeImpl();
	if (claudeResult?.ok === false) {
		log.warning(
			`Claude CLI installation failed: ${claudeResult.reason} — continuing without syncing Claude config.`,
		);
	}
	try {
		await installGhStackImpl();
	} catch (err) {
		log.warning(
			`GitHub gh-stack extension installation failed (${err?.message ?? err}) — continuing with remaining app setup.`,
		);
	}
	try {
		await syncWorktreeCleanupImpl();
	} catch (err) {
		log.warning(
			`Disk cleanup setup failed (${err?.message ?? err}). Retry: haoshoku --worktree-cleanup`,
		);
	}
	let codexResult;
	try {
		codexResult = await configureCodexImpl();
	} catch (err) {
		log.warning(
			`Codex config sync failed (${err?.message ?? err}) — continuing with remaining app setup.`,
		);
	}
	if (codexResult?.ok === false) {
		log.warning(
			`Codex CLI installation failed: ${codexResult.reason} — continuing without syncing Codex config.`,
		);
	}
	try {
		await syncAgentsConfigImpl();
	} catch (error) {
		log.warning(
			`Shared agent profile sync failed (${error?.message ?? error}).`,
		);
	}
	let axstackResult = { ok: false };
	try {
		axstackResult = await configureAxstackImpl();
	} catch (error) {
		log.warning(`Axstack setup failed (${error?.message ?? error}).`);
	}
	if (!axstackResult.ok) {
		log.warning(
			"Axstack setup was not completed — continuing. Retry with: haoshoku --axstack",
		);
	}
	return { claude: claudeResult, codex: codexResult };
}

export async function runCachyOSSetup({
	prepareArchPackageManagerImpl = prepareArchPackageManager,
	ensureRustToolchainImpl = ensureRustToolchain,
	ensureAurHelperImpl = ensureAurHelper,
	installDevToolsImpl = installDevTools,
	commandExistsImpl = commandExists,
	installSystemPackagesImpl = installSystemPackages,
	installFlatpakAppsImpl = installFlatpakApps,
	configureUserAppsImpl = configureUserApps,
	configureTailscaleT3Impl = configureTailscaleT3,
	configureFleetSshImpl = configureFleetSsh,
	promptDeviceTypeImpl = promptDeviceType,
	readDeviceTypeImpl = readDeviceType,
	configureBraveManagedPoliciesImpl = configureBraveManagedPolicies,
	configureHyprmoncfgImpl = configureHyprmoncfg,
	configureOmarchyWorkspacesImpl = configureOmarchyWorkspaces,
	configureOmarchyPluginsImpl = configureOmarchyPlugins,
	configureVoxtypeOsdImpl = configureVoxtypeOsd,
	configureKdeConnectCommandsImpl = configureKdeConnectCommands,
	configureOmarchyBarImpl = configureOmarchyBar,
	configureOmazedImpl = configureOmazed,
	configureOmarchyAppearanceImpl = configureOmarchyAppearance,
	startSudoSessionImpl = startSudoSession,
} = {}) {
	const configureBraveManagedPolicies = configureBraveManagedPoliciesImpl;
	const configureHyprmoncfg = configureHyprmoncfgImpl;
	const configureOmarchyWorkspaces = configureOmarchyWorkspacesImpl;
	const configureOmarchyPlugins = configureOmarchyPluginsImpl;
	const configureVoxtypeOsd = configureVoxtypeOsdImpl;
	const configureKdeConnectCommands = configureKdeConnectCommandsImpl;
	const configureOmarchyBar = configureOmarchyBarImpl;
	const configureOmazed = configureOmazedImpl;
	const configureOmarchyAppearance = configureOmarchyAppearanceImpl;

	await promptDeviceTypeImpl();
	const deviceType = readDeviceTypeImpl(HOME);
	const isIobox = deviceType === "iobox";
	const stopSudoSession = await startSudoSessionImpl();
	if (!stopSudoSession) {
		log.error("Sudo authentication failed. Aborting Arch setup.");
		return false;
	}

	try {
		const isOmarchy = await commandExistsImpl("omarchy");
		if (!(await prepareArchPackageManagerImpl({ isOmarchy }))) return false;
		await ensureRustToolchainImpl();
		const aurHelper = await ensureAurHelperImpl();
		await installDevToolsImpl();

		await installSystemPackagesImpl(aurHelper, isOmarchy, { deviceType });
		if (!isIobox) await installFlatpakAppsImpl();
		const userAppsResult = await configureUserAppsImpl({
			isOmarchy,
			deviceType,
		});

		try {
			if (!(await configureTailscaleT3Impl({ deviceType }))) {
				if (isIobox) {
					log.error(
						"Tailscale/T3 setup failed. Aborting iobox setup. Retry: haoshoku --tailscale-t3",
					);
					return false;
				}
				log.error(
					"Tailscale/T3 setup incomplete — continuing. Retry: haoshoku --tailscale-t3",
				);
			}
		} catch (err) {
			if (isIobox) {
				log.error(
					`Tailscale/T3 setup failed (${err?.message ?? err}). Aborting iobox setup. Retry: haoshoku --tailscale-t3`,
				);
				return false;
			}
			log.error(
				`Tailscale/T3 configuration failed (${err?.message ?? err}) — continuing. Retry: haoshoku --tailscale-t3`,
			);
		}
		try {
			if (
				!(await configureFleetSshImpl({ deviceType, throwOnFailure: true }))
			) {
				throw new Error("Fleet SSH setup incomplete");
			}
		} catch (err) {
			const message = `Fleet SSH setup failed (${err?.message ?? err}). Retry: haoshoku --fleet-ssh`;
			if (isIobox) {
				log.error(`${message}. Aborting iobox setup.`);
				return false;
			}
			log.warning(`${message} — continuing setup.`);
		}
		if (isOmarchy && !isIobox) {
			try {
				await configureBraveManagedPolicies({ nonInteractiveSudo: true });
			} catch (err) {
				log.warning(
					`Brave managed-policy configuration failed (${err?.message ?? err}) — continuing with remaining Omarchy setup.`,
				);
			}
			try {
				await configureHyprmoncfg();
			} catch (err) {
				log.warning(
					`Hyprmoncfg configuration failed (${err?.message ?? err}) — continuing with remaining Omarchy setup.`,
				);
			}
			try {
				await configureOmarchyWorkspaces();
			} catch (err) {
				log.warning(
					`Omarchy workspace configuration failed (${err?.message ?? err}) — continuing with remaining Omarchy setup.`,
				);
			}
			try {
				await configureOmarchyPlugins();
			} catch (err) {
				log.warning(
					`Omarchy plugin configuration failed (${err?.message ?? err}) — continuing with remaining Omarchy setup.`,
				);
			}
			try {
				await configureVoxtypeOsd();
			} catch (err) {
				log.warning(
					`voxtype OSD configuration failed (${err?.message ?? err}) — continuing with remaining Omarchy setup.`,
				);
			}
			try {
				await configureKdeConnectCommands();
			} catch (err) {
				log.warning(
					`KDE Connect command configuration failed (${err?.message ?? err}) — continuing with remaining Omarchy setup.`,
				);
			}
			try {
				await configureOmarchyBar();
			} catch (err) {
				log.warning(
					`Omarchy bar configuration failed (${err?.message ?? err}) — continuing with remaining Omarchy setup.`,
				);
			}
		}
		if (isOmarchy) await configureOmazed();
		if (isOmarchy) {
			try {
				await configureOmarchyAppearance();
			} catch (err) {
				log.warning(
					`Omarchy appearance configuration failed (${err?.message ?? err}) — continuing with remaining setup.`,
				);
			}
		}

		const cliFailures = [
			["Claude", userAppsResult?.claude],
			["Codex", userAppsResult?.codex],
		]
			.filter(([, result]) => result?.ok === false)
			.map(([name, result]) => `${name} (${result.reason})`);
		if (cliFailures.length > 0) {
			log.warning(
				`Arch setup finished with developer CLI warnings: ${cliFailures.join("; ")}.`,
			);
		}
		log.success(
			"Arch setup finished. Please restart your terminal or log out.",
		);
		return true;
	} finally {
		stopSudoSession();
	}
}
