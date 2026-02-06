import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { withSpinner } from "../common/ui.js";
import { commandExists, log, promptUser, runCommand } from "../common/utils.js";
import { configureClaude } from "../helpers/configure_claude.js";
import { configureZed } from "../helpers/configure_zed.js";

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
const STARSHIP_CONFIG_PATH = path.join(HOME, ".config", "starship.toml");
const FISH_CONFIG_DIR = path.join(HOME, ".config", "fish");
const PYENV_ROOT = path.join(HOME, ".pyenv");
const GHOSTTY_CONFIG_DIR = path.join(HOME, ".config", "ghostty");
const FASTFETCH_CONFIG_DIR = path.join(HOME, ".config", "fastfetch");
const KITTY_CONFIG_DIR = path.join(HOME, ".config", "kitty");
const ALACRITTY_CONFIG_DIR = path.join(HOME, ".config", "alacritty");
// Project paths (resolved from script location, works from any cwd)
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const COMMON_DIR = path.join(PROJECT_ROOT, "common");
const CONFIGS_DIR = path.join(PROJECT_ROOT, "configs");

const _PARU_APPLIST_PATH = path.join(COMMON_DIR, "paru_applist.txt");
const FLATPAK_APPLIST_PATH = path.join(COMMON_DIR, "flatpacks_arch.txt");
const KDE_SHORTCUTS_PATH = path.join(CONFIGS_DIR, "kde_shortcuts.kksrc");
const CUSTOM_FISH_CONFIG_PATH = path.join(CONFIGS_DIR, "fish", "config.fish");
const CUSTOM_GHOSTTY_CONFIG_PATH = path.join(CONFIGS_DIR, "ghostty", "config");
const CUSTOM_FASTFETCH_CONFIG_PATH = path.join(
  CONFIGS_DIR,
  "fastfetch",
  "config.jsonc",
);
const CUSTOM_KITTY_CONFIG_PATH = path.join(CONFIGS_DIR, "kitty", "kitty.conf");
const CUSTOM_ALACRITTY_CONFIG_PATH = path.join(
  CONFIGS_DIR,
  "alacritty",
  "alacritty.toml",
);

// --- Helper Functions ---

async function refreshSudo() {
  log.info("Checking sudo access. You may be prompted for your password.");
  return await runCommand("sudo -v");
}

async function installPackagesFromFile(filePath, installerCmd) {
  if (!fs.existsSync(filePath)) {
    log.warning(`Package file not found at ${filePath}`);
    return;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const packages = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (packages.length > 0) {
    log.info(`Installing ${packages.length} packages...`);
    await runCommand(`${installerCmd} ${packages.join(" ")}`);
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

  log.info("Updating system and installing base-devel...");
  //   await runCommand("sudo pacman -Syu base-devel --noconfirm");

  log.info("Installing Rust via rustup...");
  await withSpinner("Installing Rust", () =>
    runCommand(`curl ${RUSTUP_URL} -sSf | sh -s -- -y`),
  );

  if ((await commandExists("pyenv")) && (await commandExists("fish"))) {
    log.info("Configuring Pyenv for Fish...");
    await runCommand(`fish -c 'set -Ux PYENV_ROOT "${PYENV_ROOT}"'`);
    // Use set -U fish_user_paths as it is more robust than fish_add_path in some environments
    await runCommand(
      `fish -c 'if not contains "${PYENV_ROOT}/bin" $fish_user_paths; set -Ua fish_user_paths "${PYENV_ROOT}/bin"; end'`,
    );
  }
}

async function installAurHelper() {
  if (await commandExists("paru")) {
    log.info("Paru is already installed.");
    return;
  }
  log.info("Installing paru...");
  await withSpinner("Installing paru", () =>
    runCommand(
      `git clone ${PARU_AUR_URL} ${PARU_BUILD_DIR} && cd ${PARU_BUILD_DIR} && makepkg -si --noconfirm`,
    ),
  );
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
      "flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo",
    );
    await runCommand("flatpak update -y");
  } else {
    log.warning("Flatpak not found. Skipping remote setup.");
  }
}

// --- Configuration Functions ---

async function configureFishShell() {
  if (!(await commandExists("fish"))) {
    log.info("Installing Fish shell...");
    await runCommand("paru -S fish --noconfirm");
  }

  if (await promptUser("Set Fish as the default shell?", true)) {
    const fishPathProc = Bun.spawn(["which", "fish"]);
    const fishPath = (await new Response(fishPathProc.stdout).text()).trim();

    if (fishPath) {
      log.info("Setting Fish as the default shell...");
      await runCommand(`chsh -s ${fishPath}`);
    } else {
      log.warning("Could not find fish executable.");
    }
  }

  log.info("Installing Fisher and plugins...");
  const fisherPlugins = [
    "jorgebucaran/fisher",
    "meaningful-ooo/sponge",
    "jorgebucaran/nvm.fish",
    "franciscolourenco/done",
    "joseluisq/gitnow@2.12.0",
  ];

  for (const plugin of fisherPlugins) {
    await runCommand(`fish -c "fisher install ${plugin}"`);
  }

  if (await commandExists("starship")) {
    log.info("Configuring Starship prompt...");
    await runCommand(
      `starship preset nerd-font-symbols -o ${STARSHIP_CONFIG_PATH}`,
    );
  }

  fs.mkdirSync(FISH_CONFIG_DIR, { recursive: true });
  if (fs.existsSync(CUSTOM_FISH_CONFIG_PATH)) {
    fs.copyFileSync(
      CUSTOM_FISH_CONFIG_PATH,
      path.join(FISH_CONFIG_DIR, "config.fish"),
    );
    log.info("Copied custom fish config.");
  }
}

async function configureTerminals() {
  log.info("Configuring Kitty terminal...");
  fs.mkdirSync(KITTY_CONFIG_DIR, { recursive: true });
  if (fs.existsSync(CUSTOM_KITTY_CONFIG_PATH)) {
    fs.copyFileSync(
      CUSTOM_KITTY_CONFIG_PATH,
      path.join(KITTY_CONFIG_DIR, "kitty.conf"),
    );
    log.info("Copied custom Kitty config.");
  } else {
    log.warning(`Custom Kitty config not found at ${CUSTOM_KITTY_CONFIG_PATH}`);
  }

  log.info("Configuring Alacritty terminal...");
  fs.mkdirSync(ALACRITTY_CONFIG_DIR, { recursive: true });
  if (fs.existsSync(CUSTOM_ALACRITTY_CONFIG_PATH)) {
    fs.copyFileSync(
      CUSTOM_ALACRITTY_CONFIG_PATH,
      path.join(ALACRITTY_CONFIG_DIR, "alacritty.toml"),
    );
    log.info("Copied custom Alacritty config.");
  } else {
    log.warning(
      `Custom Alacritty config not found at ${CUSTOM_ALACRITTY_CONFIG_PATH}`,
    );
  }

  log.info("Configuring Ghostty terminal...");
  fs.mkdirSync(GHOSTTY_CONFIG_DIR, { recursive: true });
  if (fs.existsSync(CUSTOM_GHOSTTY_CONFIG_PATH)) {
    fs.copyFileSync(
      CUSTOM_GHOSTTY_CONFIG_PATH,
      path.join(GHOSTTY_CONFIG_DIR, "config"),
    );
    log.info("Copied custom Ghostty config.");
  }
}

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
    fs.copyFileSync(
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

async function configureKde() {
  if (await promptUser("Apply custom KDE Shortcuts?", false)) {
    log.info("Applying custom KDE shortcuts...");
    if (fs.existsSync(KDE_SHORTCUTS_PATH)) {
      const kglobalshortcutsrc = path.join(
        HOME,
        ".config",
        "kglobalshortcutsrc",
      );
      if (fs.existsSync(kglobalshortcutsrc)) {
        fs.copyFileSync(kglobalshortcutsrc, `${kglobalshortcutsrc}.bak`);
        log.info(`Backed up existing shortcuts to ${kglobalshortcutsrc}.bak`);
      }
      fs.copyFileSync(KDE_SHORTCUTS_PATH, kglobalshortcutsrc);
      log.info("KDE shortcuts applied. Please log out and log back in.");
    } else {
      log.warning(`KDE shortcuts file not found at ${KDE_SHORTCUTS_PATH}`);
    }
  }

  log.info("Applying KDE Connect fix...");
  await runCommand("sudo iptables -I INPUT -p tcp --dport 1714:1764 -j ACCEPT");
  await runCommand("sudo iptables -I INPUT -p udp --dport 1714:1764 -j ACCEPT");
  if (await commandExists("ufw")) {
    await runCommand("sudo ufw allow 1714:1764/udp");
    await runCommand("sudo ufw allow 1714:1764/tcp");
    await runCommand("sudo ufw reload");
  }

  if (
    await promptUser("Install KDE Glass blur effect (requires build)?", false)
  ) {
    await installKdeGlass();
  }
}

export async function installKdeGlass() {
  log.info("Installing prerequisites for KDE Glass blur effect...");
  await runCommand(
    "paru -S base-devel git extra-cmake-modules qt6-tools kwin --noconfirm",
  );

  log.info("Cloning and building KDE Glass blur effect...");
  const buildDir = "/tmp/kwin-effects-glass";

  // Remove old build directory if it exists
  await runCommand(`rm -rf ${buildDir}`);

  await runCommand(
    `cd /tmp && ` +
      `git clone https://github.com/4v3ngR/kwin-effects-glass && ` +
      `cd kwin-effects-glass && ` +
      `mkdir build && cd build && ` +
      `cmake .. -DCMAKE_INSTALL_PREFIX=/usr && ` +
      `make -j$(nproc) && ` +
      `sudo make install`,
  );

  log.success(
    "KDE Glass blur effect installed successfully!\n" +
      "Open System Settings > Desktop Effects, disable other blur effects, and enable Glass.",
  );
}

async function installSystemPackages() {
  log.info("Preparing for package installation...");
  if (!(await refreshSudo())) {
    log.error(
      "Sudo authentication failed. Skipping sudo-dependent installations.",
    );
    return;
  }

  log.info("Installing packages from file lists...");
  //   await installPackagesFromFile(
  //     PARU_APPLIST_PATH,
  //     "paru -S --noconfirm --sudoloop --batchinstall"
  //   );

  log.info("Installing Nerd Fonts...");
  //   await runCommand("sudo pacman -S $(pacman -Sgq nerd-fonts) --noconfirm");

  if (await promptUser("Enable gaming configuration?", false)) {
    // await runCommand(
    //   "paru -S cachyos-gaming-meta cachyos-gaming-applications protonup-rs-bin --noconfirm"
    // );
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
  await configureFishShell();

  if (await promptUser("Configure git?", true)) {
    const { configureGit } = await import("../helpers/configure_git.js");
    await configureGit();
  }

  await configureTerminals();
  await configureZed();
  await configureKde();

  log.info("Installing uosc for MPV...");
  await runCommand(`curl -fsSL ${UOSC_INSTALL_URL} | bash`);

  await enableServices();
  await configureFastfetch();
  await configureClaude();
}

export async function runCachyOSSetup() {
  await installBaseDependencies();
  await installAurHelper();
  await installDevTools();

  await installSystemPackages();
  await installFlatpakApps();
  await configureUserApps();

  log.success(
    "CachyOS setup finished. Please restart your terminal or log out.",
  );
}
