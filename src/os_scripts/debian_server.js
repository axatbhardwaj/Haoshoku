import fs from "node:fs";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withSpinner } from "../common/ui.js";
import {
	commandExists,
	log,
	promptUser,
	runCommand,
	safeCopyFile,
} from "../common/utils.js";
import { configureClaude } from "../helpers/configure_claude.js";
import { configureCodex } from "../helpers/configure_codex.js";
import { configureAgentOs } from "../helpers/configure_agent_os.js";

// --- Constants ---
const HOME = homedir();
const FISH_CONFIG_DIR = path.join(HOME, ".config", "fish");
const STARSHIP_CONFIG_PATH = path.join(HOME, ".config", "starship.toml");

// Project paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CONFIGS_DIR = path.join(PROJECT_ROOT, "configs");
const CUSTOM_FISH_CONFIG_PATH = path.join(CONFIGS_DIR, "fish", "config.fish");

// --- Helper Functions ---

/**
 * Return true when the host is Ubuntu (or an Ubuntu derivative). Reads
 * /etc/os-release and checks `ID=ubuntu` or `ID_LIKE` containing `ubuntu`.
 *
 * The fish-shell PPA (`ppa:fish-shell/release-3`) is an Ubuntu Launchpad PPA;
 * on actual Debian it 404s and `apt update` then fails, which can leave apt in
 * a broken state. So we only add it on Ubuntu-family hosts.
 *
 * `osReleasePath` is injectable for tests.
 */
function isUbuntuFamily(osReleasePath = "/etc/os-release") {
	let content;
	try {
		content = fs.readFileSync(osReleasePath, "utf-8");
	} catch {
		return false;
	}

	const fields = {};
	for (const line of content.split("\n")) {
		const eq = line.indexOf("=");
		if (eq === -1) continue;
		const key = line.slice(0, eq).trim();
		// Strip surrounding quotes from the value (os-release allows them).
		const value = line
			.slice(eq + 1)
			.trim()
			.replace(/^["']|["']$/g, "");
		fields[key] = value;
	}

	if (fields.ID === "ubuntu") return true;
	if (fields.ID_LIKE) {
		return fields.ID_LIKE.split(/\s+/).includes("ubuntu");
	}
	return false;
}

async function installEssentials() {
	log.info("Updating system and installing essentials...");
	await withSpinner("Updating system & installing essentials", async () => {
		await runCommand("sudo apt update && sudo apt upgrade -y");
		await runCommand("sudo apt install -y curl wget git vim ufw fail2ban");
	});
	// Try installing software-properties-common separately as it might not be available on all minimal images
	const spcResult = await runCommand(
		"sudo apt install -y software-properties-common",
		{ check: false },
	);
	if (!spcResult) {
		log.warning(
			"Could not install software-properties-common. Some PPAs might not work.",
		);
	}
}

async function setupSsh() {
	log.info("Setting up SSH...");
	// User requested NOT to disable SSH login, so we just ensure keys are added.
	const sshDir = path.join(HOME, ".ssh");
	if (!fs.existsSync(sshDir)) {
		fs.mkdirSync(sshDir, { mode: 0o700 });
	}

	const authorizedKeysPath = path.join(sshDir, "authorized_keys");
	if (!fs.existsSync(authorizedKeysPath)) {
		fs.writeFileSync(authorizedKeysPath, "", { mode: 0o600 });
	}

	// We could prompt to add a key here, or just leave it for manual addition.
	// For now, we'll just ensure the service is enabled.
	await runCommand("sudo systemctl enable ssh");
	await runCommand("sudo systemctl start ssh");

	log.info(
		"SSH setup complete. Remember to add your public key to ~/.ssh/authorized_keys",
	);
}

async function configureFishShell() {
	if (!(await commandExists("fish"))) {
		log.info("Installing Fish shell...");
		// The fish-shell PPA is an Ubuntu Launchpad PPA — only add it on the
		// Ubuntu family. On real Debian it 404s and can break apt, so we fall
		// back to the default repos there (might be an older fish).
		if ((await commandExists("add-apt-repository")) && isUbuntuFamily()) {
			await runCommand("sudo apt-add-repository -y ppa:fish-shell/release-3");
			await runCommand("sudo apt update");
		} else {
			log.info(
				"Not an Ubuntu host (or add-apt-repository missing). Installing fish from default repositories (might be older version).",
			);
		}
		await withSpinner("Installing fish", () =>
			runCommand("sudo apt install -y fish"),
		);
	}

	if (await promptUser("Set Fish as the default shell?", true)) {
		const fishPath = Bun.which("fish") ?? "";

		// Resolve the real login user from os.userInfo() rather than $USER:
		// an unset $USER yields the literal string "undefined" as the chsh
		// target (and risks falling through to root). Skip when falsy.
		const username = userInfo().username;
		if (!fishPath) {
			log.warning("Could not find fish executable.");
		} else if (!username) {
			log.warning(
				"Could not determine the current user — skipping default-shell change.",
			);
		} else {
			log.info("Setting Fish as the default shell...");
			await runCommand(`sudo chsh -s ${fishPath} ${username}`);
		}
	}

	log.info("Installing Fisher and plugins...");
	// Ensure fish config dir exists
	fs.mkdirSync(FISH_CONFIG_DIR, { recursive: true });

	// Install Fisher itself first
	await runCommand(
		'fish -c "curl -sL https://raw.githubusercontent.com/jorgebucaran/fisher/main/functions/fisher.fish | source && fisher install jorgebucaran/fisher"',
	);

	const fisherPlugins = [
		"meaningful-ooo/sponge",
		"jorgebucaran/nvm.fish",
		"franciscolourenco/done",
		"joseluisq/gitnow@2.12.0",
	];

	for (const plugin of fisherPlugins) {
		await runCommand(`fish -c "fisher install ${plugin}"`);
	}

	// Starship
	if (!(await commandExists("starship"))) {
		log.info("Installing Starship...");
		await runCommand("curl -sS https://starship.rs/install.sh | sh -s -- -y");
	}

	log.info("Configuring Starship prompt...");
	await runCommand(
		`starship preset nerd-font-symbols -o ${STARSHIP_CONFIG_PATH}`,
	);

	if (fs.existsSync(CUSTOM_FISH_CONFIG_PATH)) {
		// safeCopyFile backs up any existing live config.fish to .bak before
		// overwriting (and no-ops when already in sync).
		safeCopyFile(
			CUSTOM_FISH_CONFIG_PATH,
			path.join(FISH_CONFIG_DIR, "config.fish"),
		);
		log.info("Copied custom fish config.");
	}
}

async function installDocker() {
	if (await promptUser("Install Docker?", true)) {
		if (await commandExists("docker")) {
			log.info("Docker already installed.");
			return;
		}

		log.info("Installing Docker...");
		await runCommand("curl -fsSL https://get.docker.com | sh");

		const user = process.env.USER;
		if (user) {
			await runCommand(`sudo usermod -aG docker ${user}`);
			log.warning(`User ${user} added to docker group.`);
		}
	}
}

export async function setupFirewall({
	run = runCommand,
	prompt = promptUser,
} = {}) {
	log.info("Setting up UFW...");
	await run("sudo ufw default deny incoming");
	await run("sudo ufw default allow outgoing");

	// LOCKOUT GATE: on a remote/headless server, enabling UFW with a
	// default-deny policy but no working SSH allow rule locks us out for good.
	// Capture the allow-ssh result and refuse to enable (or even prompt) if it
	// failed — better to leave UFW disabled than to brick remote access.
	const sshAllowed = await run("sudo ufw allow ssh");
	if (!sshAllowed) {
		log.error(
			"SSH allow rule failed — NOT enabling UFW (remote lockout risk). Fix and re-run.",
		);
		return;
	}

	await run("sudo ufw allow http");
	await run("sudo ufw allow https");

	if (await prompt("Enable UFW now?", true)) {
		await run("sudo ufw enable");
	}
}

async function installNodejs() {
	if (await commandExists("node")) {
		log.info("Node.js already installed.");
		return;
	}

	log.info("Installing Node.js LTS...");
	await withSpinner("Installing Node.js", async () => {
		await runCommand(
			"curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo bash -",
		);
		await runCommand("sudo apt install -y nodejs");
	});
}

/**
 * Build the fail2ban `jail.local` content for the [sshd] jail.
 *
 * `backend = systemd` is required on Debian 12+ / minimal images: there's no
 * rsyslog by default, so `/var/log/auth.log` never gets written and the
 * file-tailing backend makes fail2ban fail to start. The systemd backend reads
 * the journal directly and ignores `logpath` (kept for readability and for
 * hosts that do populate auth.log).
 *
 * Pure function (no I/O) so it's testable.
 *
 * @returns {string}
 */
export function buildFail2banJail() {
	return `[sshd]
enabled = true
port = ssh
filter = sshd
backend = systemd
logpath = /var/log/auth.log
maxretry = 5
bantime = 3600
findtime = 600
`;
}

async function configureFail2ban() {
	log.info("Configuring Fail2ban for SSH protection...");

	fs.writeFileSync("/tmp/jail.local", buildFail2banJail());

	const moved = await runCommand(
		"sudo mv /tmp/jail.local /etc/fail2ban/jail.local",
	);
	if (!moved) {
		log.warning(
			"Could not install /etc/fail2ban/jail.local — skipping fail2ban enable/restart.",
		);
		return;
	}

	await runCommand("sudo systemctl enable fail2ban");
	await runCommand("sudo systemctl restart fail2ban");
	log.success("Fail2ban configured for SSH protection.");
}

export async function runDebianServerSetup() {
	// SUDO PREFLIGHT: nearly every step shells out via `sudo`. Without a valid
	// sudo session each one fails individually yet the run still reports
	// "setup finished". Validate (and cache) credentials up front and bail
	// early with a clear error instead.
	if (!(await runCommand("sudo -v"))) {
		log.error(
			"Could not obtain sudo privileges — aborting Debian server setup.",
		);
		return;
	}

	await installEssentials();
	await setupSsh();
	await configureFishShell();
	await installNodejs();
	await installDocker();
	await setupFirewall();
	await configureFail2ban();
	await configureClaude();
	await configureCodex();
	await configureAgentOs();

	log.success("Debian Server setup finished.");
}
