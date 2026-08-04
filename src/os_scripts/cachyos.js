import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { withSpinner } from "../common/ui.js";
import {
	commandExists,
	log,
	promptUser,
	runCommand,
	safeCopyFile,
} from "../common/utils.js";
import { configureAgentOs } from "../helpers/configure_agent_os.js";
import { configureAudio } from "../helpers/configure_audio.js";
import { configureBash } from "../helpers/configure_bash.js";
import {
	bootstrapClaudePolicy,
	configureClaude,
} from "../helpers/configure_claude.js";
import { configureClaudeStayAwake } from "../helpers/configure_claude_stay_awake.js";
import { configureCodex } from "../helpers/configure_codex.js";
import { configureChromiumProfiles } from "../helpers/configure_chromium_profiles.js";
import { configureMimeapps } from "../helpers/configure_mimeapps.js";
import { configureOmarchyMonitors } from "../helpers/configure_omarchy_monitors.js";
import { configureOmarchyWorkspaces } from "../helpers/configure_omarchy_workspaces.js";
import { configureOmazed } from "../helpers/configure_omazed.js";
import { configurePrWatch } from "../helpers/configure_pr_watch.js";
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
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const COMMON_DIR = path.join(PROJECT_ROOT, "common");
const CONFIGS_DIR = path.join(PROJECT_ROOT, "configs");

const PARU_APPLIST_PATH = path.join(COMMON_DIR, "paru_applist.txt");
const FLATPAK_APPLIST_PATH = path.join(COMMON_DIR, "flatpacks_arch.txt");
const CUSTOM_FASTFETCH_CONFIG_PATH = path.join(
	CONFIGS_DIR,
	"fastfetch",
	"config.jsonc",
);

// --- Helper Functions ---

const ARCH_PACKAGE_NAME_PATTERN = /^(?![-.])[A-Za-z0-9@._+-]+$/;

export function normalizeArchPackageNames(packages) {
	const valid = [];
	const invalid = [];
	const seen = new Set();

	for (const raw of packages) {
		const pkg = raw.trim();
		if (seen.has(pkg)) continue;
		seen.add(pkg);
		if (pkg && ARCH_PACKAGE_NAME_PATTERN.test(pkg)) valid.push(pkg);
		else invalid.push(pkg);
	}
	return { valid, invalid };
}

export async function resolveAurHelper(commandExistsImpl = commandExists) {
	for (const helper of ["yay", "paru"]) {
		if (await commandExistsImpl(helper)) return helper;
	}
	return null;
}

export function selectArchInstallCommand(pkg, inRepository, aurHelper) {
	if (inRepository) {
		return `sudo pacman -S --needed --noconfirm ${pkg}`;
	}
	return aurHelper ? `${aurHelper} -S --needed --noconfirm ${pkg}` : null;
}

async function packageInRepository(pkg) {
	const proc = Bun.spawn(["pacman", "-Si", pkg], {
		stdout: "ignore",
		stderr: "ignore",
	});
	return (await proc.exited) === 0;
}

async function packageInAur(pkg, aurHelper) {
	if (!aurHelper) return false;
	const proc = Bun.spawn([aurHelper, "-Si", "--aur", pkg], {
		stdout: "ignore",
		stderr: "ignore",
	});
	return (await proc.exited) === 0;
}

export async function installGamingPackages({
	aurHelper,
	isOmarchy,
	commandExistsImpl = commandExists,
	runCommandImpl = runCommand,
} = {}) {
	const repositoryOk = await runCommandImpl(
		"sudo pacman -S --needed --noconfirm steam gamemode lib32-gamemode gamescope mangohud lib32-mangohud",
	);
	const protonOk = aurHelper
		? await runCommandImpl(
				`${aurHelper} -S --needed --noconfirm protonup-rs-bin`,
			)
		: false;

	let gpuOk = true;
	if (
		isOmarchy &&
		(await commandExistsImpl("omarchy-install-gaming-gpu-lib32"))
	) {
		gpuOk = await runCommandImpl("omarchy-install-gaming-gpu-lib32");
	} else if (!isOmarchy) {
		log.info("Skipping GPU-specific 32-bit packages outside Omarchy.");
	}
	return Boolean(repositoryOk && protonOk && gpuOk);
}

async function refreshSudo() {
	log.info("Checking sudo access. You may be prompted for your password.");
	return await runCommand("sudo -v");
}

/**
 * Snapshot pacman's local DB once so callers can pre-filter "already installed"
 * packages without paying paru's per-package AUR HTTP roundtrip. AUR packages
 * installed via paru land in the pacman DB the same way repo packages do.
 * Returns an empty Set on failure so callers fall back to "try to install
 * everything", matching pre-optimization behavior.
 */
export async function getInstalledPackages(spawnImpl = Bun.spawn) {
	try {
		const proc = spawnImpl(["pacman", "-Qq"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const output = await new Response(proc.stdout).text();
		const exitCode = await proc.exited;
		if (exitCode !== 0) {
			log.warning("pacman -Qq failed; skipping pre-install filter.");
			return new Set();
		}
		return new Set(
			output
				.split("\n")
				.map((s) => s.trim())
				.filter(Boolean),
		);
	} catch (_e) {
		log.warning("pacman -Qq failed; skipping pre-install filter.");
		return new Set();
	}
}

async function installBatchWithFallback({
	packages,
	batchCommand,
	individualCommand,
	status,
	getInstalledPackagesImpl,
	runCommandImpl,
}) {
	if (packages.length === 0) return;
	if (await runCommandImpl(batchCommand)) {
		for (const pkg of packages) status.set(pkg, "installed");
		return;
	}

	const installedAfterBatch = await getInstalledPackagesImpl();
	for (const pkg of packages) {
		if (installedAfterBatch.has(pkg)) {
			status.set(pkg, "installed");
		} else if (await runCommandImpl(individualCommand(pkg))) {
			status.set(pkg, "installed");
		} else {
			status.set(pkg, "failed");
		}
	}
}

export async function installArchPackageBatch(packages, options = {}) {
	const {
		aurHelper,
		packageInRepositoryImpl = packageInRepository,
		packageInAurImpl = packageInAur,
		getInstalledPackagesImpl = getInstalledPackages,
		runCommandImpl = runCommand,
	} = options;
	const { valid, invalid } = normalizeArchPackageNames(packages);
	const status = new Map();
	const initiallyInstalled = await getInstalledPackagesImpl();
	const repositoryPackages = [];
	const aurPackages = [];

	for (const pkg of valid) {
		if (initiallyInstalled.has(pkg)) {
			status.set(pkg, "skipped");
		} else if (await packageInRepositoryImpl(pkg)) {
			repositoryPackages.push(pkg);
		} else if (!aurHelper) {
			status.set(pkg, "missing");
		} else if (await packageInAurImpl(pkg, aurHelper)) {
			aurPackages.push(pkg);
		} else {
			status.set(pkg, "missing");
		}
	}

	await installBatchWithFallback({
		packages: repositoryPackages,
		batchCommand: `sudo pacman -S --needed --noconfirm ${repositoryPackages.join(" ")}`,
		individualCommand: (pkg) => `sudo pacman -S --needed --noconfirm ${pkg}`,
		status,
		getInstalledPackagesImpl,
		runCommandImpl,
	});
	await installBatchWithFallback({
		packages: aurPackages,
		batchCommand: `${aurHelper} -S --needed --noconfirm --batchinstall ${aurPackages.join(" ")}`,
		individualCommand: (pkg) => `${aurHelper} -S --needed --noconfirm ${pkg}`,
		status,
		getInstalledPackagesImpl,
		runCommandImpl,
	});

	return {
		installed: valid.filter((pkg) => status.get(pkg) === "installed"),
		failed: valid.filter((pkg) => status.get(pkg) === "failed"),
		missing: valid.filter((pkg) => status.get(pkg) === "missing"),
		invalid,
		skipped: valid.filter((pkg) => status.get(pkg) === "skipped"),
	};
}

async function installPackagesFromFile(filePath, installerCmd) {
	if (!fs.existsSync(filePath)) {
		log.warning(`Package file not found at ${filePath}`);
		return;
	}

	const content = fs.readFileSync(filePath, "utf-8");
	const requested = content
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"));

	if (requested.length === 0) return;

	// Pre-filter against pacman's local DB so paru isn't invoked for packages
	// that are already installed — the big saving is skipping AUR HTTP lookups
	// on re-runs. `--needed` on the install command catches the edge cases this
	// exact-name match misses (e.g. a package satisfying a `provides` we want).
	// Only applied when installerCmd routes through pacman/paru.
	let toInstall = requested;
	let skipped = 0;
	if (installerCmd.includes("paru") || installerCmd.includes("pacman")) {
		const installed = await getInstalledPackages();
		toInstall = requested.filter((pkg) => !installed.has(pkg));
		skipped = requested.length - toInstall.length;
	}

	if (skipped > 0) {
		log.info(
			`${skipped} of ${requested.length} packages already installed — skipping.`,
		);
	}

	if (toInstall.length === 0) {
		log.success("All requested packages already installed.");
		return;
	}

	log.info(`Installing ${toInstall.length} packages individually...`);
	const failed = [];

	for (const pkg of toInstall) {
		const ok = await runCommand(`${installerCmd} ${pkg}`);
		if (ok) {
			log.success(`Installed ${pkg}`);
		} else {
			log.warning(`Failed to install ${pkg}, continuing...`);
			failed.push(pkg);
		}
	}

	if (failed.length > 0) {
		log.warning(
			`${failed.length} package(s) failed to install:\n  ${failed.join("\n  ")}`,
		);
	}
}

// --- Installation Functions ---

export async function prepareArchPackageManager({
	runCommandImpl = runCommand,
} = {}) {
	log.info("Refreshing package databases and performing a full system upgrade...");
	if (!(await runCommandImpl("sudo pacman -Syu --noconfirm"))) {
		log.error(
			"Pacman refresh and full upgrade failed. Aborting Arch setup before package installation.",
		);
		return false;
	}

	log.info("Installing base-devel and git (required for makepkg / AUR builds)...");
	if (
		!(await runCommandImpl(
			"sudo pacman -S --needed --noconfirm base-devel git",
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

async function enableServices() {
	if (await promptUser("Enable Bluetooth?", false)) {
		log.info("Enabling Bluetooth service...");
		await runCommand("sudo systemctl enable --now bluetooth");
	}

	if (
		(await commandExists("docker")) &&
		(await promptUser("Enable Docker?", true))
	) {
		log.info("Enabling and starting Docker service...");
		await runCommand("sudo systemctl enable --now docker");
		const user = process.env.USER;
		if (user) {
			await runCommand(`sudo usermod -aG docker ${user}`);
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
		refreshSudoImpl = refreshSudo,
		installArchPackageBatchImpl = installArchPackageBatch,
		readFileImpl = fs.readFileSync,
		runCommandImpl = runCommand,
		promptUserImpl = promptUser,
	} = {},
) {
	log.info("Preparing for package installation...");
	if (!(await refreshSudoImpl())) {
		log.error(
			"Sudo authentication failed. Skipping sudo-dependent installations.",
		);
		return;
	}

	log.info("Installing packages from file lists...");
	const content = readFileImpl(PARU_APPLIST_PATH, "utf8");
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

	log.info("Installing Nerd Fonts...");
	await runCommandImpl(
		"sudo pacman -S --needed --noconfirm ttf-jetbrains-mono-nerd",
	);

	if (await promptUserImpl("Enable gaming configuration?", false)) {
		await installGamingPackages({ aurHelper, isOmarchy });
	}
}

async function installFlatpakApps() {
	if (!(await commandExists("flatpak"))) {
		log.info("Installing Flatpak...");
		await runCommand("sudo pacman -S flatpak --noconfirm");
	}
	await setupFlatpakRemotes();
	await installPackagesFromFile(
		FLATPAK_APPLIST_PATH,
		"flatpak install --user -y flathub",
	);
}

export async function configureBrowserIntegration({
	configureChromiumProfilesImpl = configureChromiumProfiles,
	configureMimeappsImpl = configureMimeapps,
	installUserScriptsImpl = installUserScripts,
} = {}) {
	await configureChromiumProfilesImpl();
	await installUserScriptsImpl();
	await configureMimeappsImpl();
}

export async function configureUserApps({
	promptUserImpl = promptUser,
	configureGitImpl,
	configureBrowserIntegrationImpl = configureBrowserIntegration,
	configureAudioImpl = configureAudio,
	configureBashImpl = configureBash,
	configureFastfetchImpl = configureFastfetch,
	runCommandImpl = runCommand,
	enableServicesImpl = enableServices,
	configureClaudeImpl = configureClaude,
	bootstrapClaudePolicyImpl = bootstrapClaudePolicy,
	configureClaudeStayAwakeImpl = configureClaudeStayAwake,
	configurePrWatchImpl = configurePrWatch,
	configureCodexImpl = configureCodex,
	configureAgentOsImpl = configureAgentOs,
} = {}) {
	if (await promptUserImpl("Configure git?", true)) {
		const configureGit =
			configureGitImpl ??
			(await import("../helpers/configure_git.js")).configureGit;
		await configureGit();
	}

	await configureBrowserIntegrationImpl();
	try {
		await configureAudioImpl();
	} catch (err) {
		log.warning(
			`Audio config sync failed (${err?.message ?? err}) — continuing with remaining app setup.`,
		);
	}

	configureBashImpl();
	await configureFastfetchImpl();

	log.info("Installing uosc for MPV...");
	await runCommandImpl(`curl -fsSL ${UOSC_INSTALL_URL} | bash`);

	await enableServicesImpl();
	await configureClaudeImpl();
	if (
		await promptUserImpl("Bootstrap private Claude policy repository?", true)
	) {
		try {
			if (!(await bootstrapClaudePolicyImpl({ strict: false }))) {
				log.warning(
					"Claude policy bootstrap failed — continuing. Retry with: haoshoku --claude-bootstrap",
				);
			}
		} catch (err) {
			log.warning(
				`Claude policy bootstrap failed (${err?.message ?? err}) — continuing. Retry with: haoshoku --claude-bootstrap`,
			);
		}
	}
	await configureClaudeStayAwakeImpl();
	if (configurePrWatchImpl === configurePrWatch) await configurePrWatch();
	else await configurePrWatchImpl();
	await configureCodexImpl();
	await configureAgentOsImpl();
}

export async function runCachyOSSetup({
	prepareArchPackageManagerImpl = prepareArchPackageManager,
} = {}) {
	if (!(await prepareArchPackageManagerImpl())) return false;
	await ensureRustToolchain();
	const aurHelper = await ensureAurHelper();
	await installDevTools();

	const isOmarchy = await commandExists("omarchy");
	await installSystemPackages(aurHelper, isOmarchy);
	await installFlatpakApps();
	await configureUserApps();
	if (isOmarchy) await configureOmarchyMonitors();
	if (isOmarchy) await configureOmarchyWorkspaces();
	if (isOmarchy) await configureOmazed();

	log.success("Arch setup finished. Please restart your terminal or log out.");
	return true;
}
