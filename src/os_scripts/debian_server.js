import fs from "fs";
import { homedir } from "os";
import path from "path";
import prompts from "prompts";
import { fileURLToPath } from "url";
import { withSpinner } from "../common/ui.js";
import { commandExists, log, runCommand } from "../common/utils.js";

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

async function promptUser(message, initial = false) {
	const response = await prompts({
		type: "confirm",
		name: "value",
		message: message,
		initial: initial,
	});
	return response.value;
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
		// Only try adding PPA if add-apt-repository is available
		if (await commandExists("add-apt-repository")) {
			await runCommand("sudo apt-add-repository -y ppa:fish-shell/release-3");
			await runCommand("sudo apt update");
		} else {
			log.warning(
				"add-apt-repository not found. Installing fish from default repositories (might be older version).",
			);
		}
		await withSpinner("Installing fish", () =>
			runCommand("sudo apt install -y fish"),
		);
	}

	if (await promptUser("Set Fish as the default shell?", true)) {
		const fishPathProc = Bun.spawn(["which", "fish"]);
		const fishPath = (await new Response(fishPathProc.stdout).text()).trim();

		if (fishPath) {
			log.info("Setting Fish as the default shell...");
			await runCommand(`sudo chsh -s ${fishPath} ${process.env.USER}`);
		} else {
			log.warning("Could not find fish executable.");
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
		fs.copyFileSync(
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

async function setupFirewall() {
	log.info("Setting up UFW...");
	await runCommand("sudo ufw default deny incoming");
	await runCommand("sudo ufw default allow outgoing");
	await runCommand("sudo ufw allow ssh");
	await runCommand("sudo ufw allow http");
	await runCommand("sudo ufw allow https");

	if (await promptUser("Enable UFW now?", true)) {
		await runCommand("sudo ufw enable");
	}
}

export async function runDebianServerSetup() {
	await installEssentials();
	await setupSsh();
	await configureFishShell();
	await installDocker();
	await setupFirewall();

	log.success("Debian Server setup finished.");
}
