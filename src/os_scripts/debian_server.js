import { log, runCommand, commandExists } from "../common/utils.js";
import prompts from "prompts";
import path from "path";
import fs from "fs";
import { homedir } from "os";
import net from "net";
import { fileURLToPath } from "url";

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
  await runCommand("sudo apt update && sudo apt upgrade -y");
  // Split installation to ensure core tools are installed even if optional ones fail
  await runCommand("sudo apt install -y curl wget git vim ufw fail2ban");
  // Try installing software-properties-common separately as it might not be available on all minimal images
  const spcResult = await runCommand("sudo apt install -y software-properties-common", { check: false });
  if (!spcResult) {
    log.warning("Could not install software-properties-common. Some PPAs might not work.");
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
  
  log.info("SSH setup complete. Remember to add your public key to ~/.ssh/authorized_keys");
}

async function configureFishShell() {
  if (!(await commandExists("fish"))) {
    log.info("Installing Fish shell...");
    // Only try adding PPA if add-apt-repository is available
    if (await commandExists("add-apt-repository")) {
      await runCommand("sudo apt-add-repository -y ppa:fish-shell/release-3");
      await runCommand("sudo apt update");
    } else {
      log.warning("add-apt-repository not found. Installing fish from default repositories (might be older version).");
    }
    await runCommand("sudo apt install -y fish");
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
  await runCommand('fish -c "curl -sL https://raw.githubusercontent.com/jorgebucaran/fisher/main/functions/fisher.fish | source && fisher install jorgebucaran/fisher"');

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
  await runCommand(`starship preset nerd-font-symbols -o ${STARSHIP_CONFIG_PATH}`);

  if (fs.existsSync(CUSTOM_FISH_CONFIG_PATH)) {
    fs.copyFileSync(CUSTOM_FISH_CONFIG_PATH, path.join(FISH_CONFIG_DIR, "config.fish"));
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

function checkPortAvailability(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err) => {
      resolve(false);
    });
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

async function installDashy() {
  if (await promptUser("Install Dashy (Personal Dashboard)?", true)) {
    const servicesDir = path.join(HOME, "services");
    const dashyDir = path.join(servicesDir, "dashy");
    const sourceDir = path.join(PROJECT_ROOT, "services", "dashy");

    if (!fs.existsSync(sourceDir)) {
      log.error(`Dashy source not found at ${sourceDir}`);
      return;
    }

    // Port selection
    let port = 8080;
    let isAvailable = await checkPortAvailability(port);

    if (!isAvailable) {
      log.warning(`Port ${port} is already in use.`);
      const response = await prompts({
        type: "number",
        name: "port",
        message: "Enter a different port for Dashy:",
        initial: 8081,
        validate: async (p) => (await checkPortAvailability(p)) ? true : "Port is still in use",
      });
      port = response.port;
    }

    log.info(`Installing Dashy on port ${port}...`);

    // Copy files
    if (!fs.existsSync(servicesDir)) {
      fs.mkdirSync(servicesDir, { recursive: true });
    }

    // Using cp -r for simplicity and preserving permissions
    await runCommand(`cp -r ${sourceDir} ${servicesDir}`);

    // Update port in docker-compose.yml if changed
    if (port !== 8080) {
      const composePath = path.join(dashyDir, "docker-compose.yml");
      if (fs.existsSync(composePath)) {
        let content = fs.readFileSync(composePath, "utf-8");
        content = content.replace("8080:80", `${port}:80`);
        fs.writeFileSync(composePath, content);
        log.info(`Updated Dashy port to ${port} in docker-compose.yml`);
      }
    }

    // Start service
    log.info("Starting Dashy...");
    // We need to run docker compose in the dashy directory
    // runCommand doesn't support cwd option directly based on usage seen, 
    // so we construct the command to change dir or use -f and -p? 
    // Actually runCommand implementation in utils.js likely supports options or we can chain cd.
    // Let's check utils.js or just chain.
    // Assuming runCommand takes options based on standard exec wrappers, but looking at previous file view, 
    // I don't see the definition of runCommand. 
    // Let's assume `cd ... && ...` works for shell commands.
    await runCommand(`cd ${dashyDir} && docker compose up -d`);

    log.success(`Dashy installed! Access it at http://localhost:${port}`);
  }
}

export async function runDebianServerSetup() {
  await installEssentials();
  await setupSsh();
  await configureFishShell();
  await installDocker();
  await installDashy();
  await setupFirewall();

  log.success("Debian Server setup finished.");
}
