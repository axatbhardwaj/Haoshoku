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
import { configureClaude } from "../helpers/configure_claude.js";
import { configureClaudeStayAwake } from "../helpers/configure_claude_stay_awake.js";
import { configureCodex } from "../helpers/configure_codex.js";
import { configureMimeapps } from "../helpers/configure_mimeapps.js";
import { configurePrWatch } from "../helpers/configure_pr_watch.js";
import { installUserScripts } from "../helpers/install_user_scripts.js";
import { configureOmarchyMonitors } from "../helpers/configure_omarchy_monitors.js";

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
async function getInstalledPackages() {
	try {
		const proc = Bun.spawn(["pacman", "-Qq"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const output = await new Response(proc.stdout).text();
		await proc.exited;
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

async function installBaseDependencies() {
	log.info("Refreshing keyrings...");
	// // Initialize and populate keys first to ensure we can verify signatures
	// await runCommand("sudo pacman-key --init");
	// await runCommand("sudo pacman-key --populate archlinux cachyos");
	// // Then update the keyring packages
	// await runCommand("sudo pacman -Sy --noconfirm archlinux-keyring cachyos-keyring");

	log.info(
		"Installing base-devel and git (required for makepkg / paru build)...",
	);
	const baseDevelOk = await runCommand(
		"sudo pacman -S --needed --noconfirm base-devel git",
	);
	if (!baseDevelOk) {
		log.warning(
			"base-devel/git install failed — paru build and AUR installs may fail.",
		);
	}

	log.info("Installing Rust via rustup...");
	await withSpinner("Installing Rust", () =>
		runCommand(`curl ${RUSTUP_URL} -sSf | sh -s -- -y`),
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

async function installSystemPackages(aurHelper, isOmarchy) {
	log.info("Preparing for package installation...");
	if (!(await refreshSudo())) {
		log.error(
			"Sudo authentication failed. Skipping sudo-dependent installations.",
		);
		return;
	}

	log.info("Installing packages from file lists...");
	const content = fs.readFileSync(PARU_APPLIST_PATH, "utf8");
	const requested = content
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"));
	const failed = [];
	for (const pkg of requested) {
		const command = selectArchInstallCommand(
			pkg,
			await packageInRepository(pkg),
			aurHelper,
		);
		if (!command || !(await runCommand(command))) failed.push(pkg);
	}
	if (failed.length > 0) {
		log.warning(
			`${failed.length} package(s) failed to install:\n  ${failed.join("\n  ")}`,
		);
	}

	log.info("Installing Nerd Fonts...");
	await runCommand(
		"sudo pacman -S --needed --noconfirm ttf-jetbrains-mono-nerd",
	);

	if (await promptUser("Enable gaming configuration?", false)) {
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

async function configureUserApps() {
	if (await promptUser("Configure git?", true)) {
		const { configureGit } = await import("../helpers/configure_git.js");
		await configureGit();
	}

	await configureMimeapps();
	await installUserScripts();
	try {
		await configureAudio();
	} catch (err) {
		log.warning(
			`Audio config sync failed (${err?.message ?? err}) — continuing with remaining app setup.`,
		);
	}

	configureBash();
	await configureFastfetch();

	log.info("Installing uosc for MPV...");
	await runCommand(`curl -fsSL ${UOSC_INSTALL_URL} | bash`);

	await enableServices();
	await configureClaude();
	await configureClaudeStayAwake();
	await configurePrWatch();
	await configureCodex();
	await configureAgentOs();
}

export async function runCachyOSSetup() {
	await installBaseDependencies();
	const aurHelper = await ensureAurHelper();
	await installDevTools();

	const isOmarchy = await commandExists("omarchy");
	await installSystemPackages(aurHelper, isOmarchy);
	await installFlatpakApps();
	await configureUserApps();
	if (isOmarchy) await configureOmarchyMonitors();

	log.success("Arch setup finished. Please restart your terminal or log out.");
}
