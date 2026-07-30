<p align="center">
  <img src="icons/haoshoku-readme.gif" alt="Haoshoku" width="100%">
</p>

# Haoshoku: Color of the Supreme King

**Haoshoku** (formerly Bankai) is a modular, multi-distro Linux setup and configuration toolkit. It automates the installation of essential applications, developer tools, terminal configs, and user environment tweaks.

> [!NOTE]
> **Haoshoku** (referencing ["Supreme King Haki"](https://onepiece.fandom.com/wiki/Haki/Supreme_King_Haki) from *One Piece*) serves as an authoritative configuration manager, enforcing a strict and consistent environment setup across your Linux systems.

> [!IMPORTANT]
> **Rebranding & Migration**: This project was previously known as **Bankai** and was available on **PyPI** (Python). It has been renamed to **Haoshoku** and is now available on **NPM** (JavaScript/Bun). Please uninstall old Python versions (`pipx uninstall bankai`) before installing.

## Quick Start

### Option 1: Run with Bun (Recommended)
```bash
# Clone the repo
git clone https://github.com/axatbhardwaj/haoshoku.git
cd haoshoku

# Install dependencies
bun install

# Run the setup
bun haoshoku.js
```

### Option 2: Install Globally with Bun
```bash
bun install -g haoshoku
haoshoku
```

### Option 3: Install via npm (Alternative)
```bash
npm install -g haoshoku
haoshoku
```

## CLI Usage

Haoshoku provides command-line options for non-interactive use or specific tasks.

```bash
# Run for a specific OS (skips detection/prompt)
haoshoku --os cachyos
haoshoku --os debian-server

# Deploy Claude Code personal config (CLAUDE.md, statusline, .gitignore)
haoshoku --claude

# Back up the same three personal files to configs/claude/
haoshoku --claude-backup

# Update cached config and sync Claude config
haoshoku --claude-update

# Sync skills from configured sources
haoshoku --skills

# Update cached skill sources to latest
haoshoku --skills-update

# List available skills from all sources
haoshoku --skills-list

# Enable Superpowers plugin (idempotent)
haoshoku --superpowers

# Sync Zed editor config from configs/zed/ to ~/.config/zed/
haoshoku --zed

# Backup Zed config to configs/zed/ (sanitizes sensitive data)
haoshoku --zed-backup

# Install/reinstall KDE Glass blur effect (CachyOS/Arch only)
haoshoku --kde-glass

# Install Hyprland + upstream Caelestia rice (CachyOS/Arch only).
# Asks about your current DE and which device this is (PC / laptop);
# persists the device answer to ~/.haoshoku.json for future per-host configs.
haoshoku --hyprland
```

## Features

### Supported Platforms
-   **CachyOS / Arch Linux**: Full desktop environment setup (KDE Plasma), gaming optimizations, and daily driver tools.
-   **Debian Server**: Minimal, secure server setup with Docker, UFW, and Fail2ban.

### What It Does
-   **Terminal & Shell**:
    -   Installs and configures **Fish Shell** as default.
    -   Sets up **Starship** prompt and **Fisher** plugins.
    -   Deploys custom configs for **Warp**, **Alacritty**, and **Fastfetch**.
-   **Developer Ecosystem**:
    -   **Languages**: Rust (Rustup), Python (Uv/Conda), Node.js (Volta/NVM).
    -   **Tools**: Docker, Git (with signing), Neovim/VS Code, Foundry (Smart Contracts).
-   **System Hardening (Debian)**:
    -   Configures **UFW** firewall (allow SSH/HTTP/HTTPS).
    -   Sets up **Fail2ban** for SSH protection.
    -   Enables auto-updates and essential system utilities.
-   **Desktop Experience (Arch)**:
    -   Installs curated Flatpaks (Obsidian, Discord, Spotify).
    -   Optimizes KDE Plasma settings.
    -   **KDE Glass Blur**: Optional installation of glass blur effect for KDE Plasma 6 (reinstall easily after KDE updates with `--kde-glass`).
    -   Sets up gaming tools (Steam, Lutris) and media players (mpv).
-   **AI Configuration**:
    -   **Claude Code Config**: Deploys exactly `CLAUDE.md`, the statusline, and `.gitignore` (`haoshoku --claude`).
    -   **Claude Backup**: Backs up exactly those three personal files to `configs/claude/`, refusing literal absolute home-path leaks (`haoshoku --claude-backup`).
    -   **Executable Policy**: Deliberately not bundled. Bootstrap a private policy repository you own in place at `~/.claude/`; this public installer does not deploy or capture `agents/` or `workflows/`.
    -   **Skill Management**: Runtime git cloning of Claude skills and agents (`haoshoku --skills`).
    -   **Superpowers**: Idempotently enables the Superpowers plugin in `~/.claude/settings.json` (`haoshoku --superpowers`).

Executable policy comes from a private policy repository the user owns; follow the [canonical in-place bootstrap procedure](configs/claude/README.md#executable-policy-bootstrap).

## Hyprland (parallel to KDE)

Bootstraps upstream Caelestia rice. KDE Plasma stays installed; SDDM shows both sessions.

```bash
haoshoku --hyprland
```

The command:
1. Asks for your current desktop environment (auto-detected via `$XDG_CURRENT_DESKTOP`; you can override). When the answer is `hyprland`, the Hyprland package install is skipped — Caelestia still gets cloned and installed.
2. Asks which device this is (Main PC / Laptop / Other / Skip). Non-skip answers persist to `~/.haoshoku.json` as `deviceType`. The answer isn't consumed today — it's the seed for future per-host configuration (e.g., per-device monitor layouts).
3. Installs Hyprland packages (when not skipped), clones [upstream Caelestia](https://github.com/caelestia-dots/caelestia), and runs `install.fish`. Recovers automatically when an AUR mirror failure leaves `caelestia-cli`/`caelestia-shell` uninstalled.

After install, monitor configuration is your responsibility. Caelestia sources `~/.config/caelestia/hypr-user.conf` last from its `hyprland.conf`, so any `monitor = ...` directives you put in that file override Caelestia's catch-all without dirtying the symlinked Caelestia tree.

Releases prior to 5.0.0 (`haoshoku <= 4.6.6`) shipped an opinionated "Ocean" overlay on top of Caelestia — KDE→Hyprland keybind translation, window rules, autostart, custom borders/blur, hyprlock/hypridle/hyprpaper/mako configs, plus monitor presets — under `--hyprland-keybinds` / `--hyprland-rules` / `--hyprland-backup`. 5.0.0 drops all of it. Pin `haoshoku@4.6.6` if you need it back.

### Rollback

If Hyprland breaks, log out and pick "Plasma" at SDDM. No haoshoku command required.

### Manual uninstall

```bash
# Remove Caelestia itself
rm -rf ~/.local/share/caelestia

# Optional: clear your monitor / user overrides
: > ~/.config/caelestia/hypr-user.conf
```

Haoshoku deliberately does not delete `~/.config/hypr/`; Caelestia owns that symlinked tree.

## Skill Management

Haoshoku manages Claude Code skills and cache-backed agents via runtime git cloning to enable global npm installations.

**Configuration**: Edit `~/.haoshoku.json` to add custom skill sources.

```json
{
  "skillSources": [
    "https://github.com/axatbhardwaj/claude-skills.git"
  ]
}
```

**Priority Rules**: User sources take precedence over community sources. If multiple sources provide the same skill name, the first source in the array wins.

**Cache Location**: Skills are cloned to `~/.cache/haoshoku/` (or `$XDG_CACHE_HOME/haoshoku/`) and symlinked to `~/.claude/skills/`.

**Usage**:
- `--skills`: Clone/sync all configured sources
- `--skills-update`: Pull latest changes from cached sources
- `--skills-list`: Display available skills by source

**Tradeoffs**:
- **Git dependency**: Requires git installed on system (standard for developer environments)
- **Network requirement**: Skills unavailable until first sync (offline operation supported after initial clone)
- **Separate config file**: `~/.haoshoku.json` adds another config to manage (avoids coupling with Claude config structure)

## Configuration

All configuration templates are stored in the `configs/` directory. Terminal configs (fish, warp, starship, fastfetch) are copied during setup. The public Claude bundle contains only three personal files. Claude skills and non-shadowed cache-backed agents are symlinked, while executable policy comes from a private policy repository the user bootstraps in place at `~/.claude/`:

-   `configs/fish/`: Fish shell configuration and functions.
-   `configs/warp/`: Warp terminal tab config (theme is activated in `settings.toml`).
-   `configs/starship.toml`: Cross-shell prompt theme.
-   `configs/fastfetch/`: System information fetch tool config.
-   `deskback/`: Assets and wallpapers.

## Development

### Testing

Run the test suite using Bun's native test runner:

```bash
bun test
```

### Linting & Formatting

This project uses [Biome](https://biomejs.dev/) for fast linting and formatting.

```bash
# Format code
bun run format

# Lint code
bun run lint
```

## For Developers

To modify or extend the scripts:

1.  Clone the repository.
2.  Install dependencies: `bun install`
3.  Run locally: `bun haoshoku.js`

**Project Structure:**
-   `src/os_scripts/`: OS-specific logic (`cachyos.js`, `debian_server.js`).
-   `configs/`: Configuration files to be deployed.
-   `common/`: Package lists and shared utilities.

## License
MIT
