![Haoshoku](icons/haoshoku-readme.gif)

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

### Option 2: Install via npm (Alternative)
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

# Sync Claude Code config (symlinks shared dirs, copies personal)
haoshoku --claude

# Backup personal Claude config to configs/claude/
haoshoku --claude-backup

# Update cached config and sync Claude config
haoshoku --claude-update

# Sync skills from configured sources
haoshoku --skills

# Update cached skill sources to latest
haoshoku --skills-update

# List available skills from all sources
haoshoku --skills-list

# Sync Zed editor config from configs/zed/ to ~/.config/zed/
haoshoku --zed

# Backup Zed config to configs/zed/ (sanitizes sensitive data)
haoshoku --zed-backup
```

## Features

### Supported Platforms
-   **CachyOS / Arch Linux**: Full desktop environment setup (KDE Plasma), gaming optimizations, and daily driver tools.
-   **Debian Server**: Minimal, secure server setup with Docker, UFW, and Fail2ban.

### What It Does
-   **Terminal & Shell**:
    -   Installs and configures **Fish Shell** as default.
    -   Sets up **Starship** prompt and **Fisher** plugins.
    -   Deploys custom configs for **Ghostty**, **Kitty**, **Alacritty**, and **Fastfetch**.
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
    -   Sets up gaming tools (Steam, Lutris) and media players (mpv).
-   **AI Configuration**:
    -   **Claude Code Sync**: Symlinks agents/conventions from cache, copies personal config (`haoshoku --claude`).
    -   **Claude Backup**: Backs up personal config to `configs/claude/` (`haoshoku --claude-backup`).
    -   **Claude Update**: Updates cached config and syncs (`haoshoku --claude-update`).
    -   **Skill Management**: Runtime git cloning of Claude skills with user priority over community skills.

## Skill Management

Haoshoku manages Claude Code config via runtime git cloning to enable global npm installations.

**Configuration**: Edit `~/.haoshoku.json` to add custom skill sources.

```json
{
  "skillSources": [
    "https://github.com/solatis/claude-config.git",
    "https://github.com/username/custom-skills.git"
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

All configuration templates are stored in the `configs/` directory. Terminal configs (fish, ghostty, kitty, starship, fastfetch) are copied during setup. Claude skills and agents are symlinked:

-   `configs/fish/`: Fish shell configuration and functions.
-   `configs/ghostty/`: Ghostty terminal config.
-   `configs/kitty/`: Kitty terminal config.
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