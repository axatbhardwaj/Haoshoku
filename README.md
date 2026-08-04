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

# Deploy untracked Claude Code personal config (CLAUDE.md, statusline, .gitignore)
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

# Merge portable Haoshoku settings and shortcuts into KDE Plasma.
haoshoku --plasma
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
    -   **Claude Code Config**: Considers exactly `CLAUDE.md`, the statusline, and `.gitignore`, skipping any destination tracked by a git repository rooted at `~/.claude` (`haoshoku --claude`).
    -   **Claude Backup**: Backs up exactly those three personal files to `configs/claude/`, refusing literal absolute home-path leaks (`haoshoku --claude-backup`).
    -   **Executable Policy**: Deliberately not bundled. Bootstrap a private policy repository you own in place at `~/.claude/`; this public installer does not deploy or capture `agents/` or `workflows/`.
    -   **Skill Management**: Runtime git cloning of Claude skills and agents (`haoshoku --skills`).
    -   **Superpowers**: Idempotently enables the Superpowers plugin in `~/.claude/settings.json` (`haoshoku --superpowers`).

Executable policy comes from a private policy repository the user owns; follow the [canonical in-place bootstrap procedure](configs/claude/README.md#executable-policy-bootstrap).

## KDE Plasma migration

Haoshoku uses KDE Plasma as its desktop environment. The migration is merge-only:
existing unrelated Plasma settings are preserved and first-capture backups are
written beside changed KDE configuration files.

```bash
haoshoku --plasma
```

The command installs portable launch shortcuts for Kitty, Dolphin, Zed, Claude,
the agents terminal, and microphone mute, and unbinds the KDE/KWin defaults that
would otherwise collide with them. The default paths do not write `kwinrc` or
`kwinrulesrc` and do not manage virtual desktops.

Window placement is available separately as an opt-in:

**Warning:** `--activities` repoints the Brave launchers at **BRAND-NEW EMPTY
profile directories**, so the flux and defi browsers start with no cookies,
history, extensions, or passwords and remain separate from existing Brave
profiles.

```bash
haoshoku --activities
```

This creates the `flux`, `defi`, and `palmUSD` activities when they are missing,
preserves every existing activity, writes activity-scoped window rules, writes
the one `kwinrc` `[Plugins]` key needed to enable the Haoshoku placement script,
and installs that KWin script. Rules for windows intended to appear everywhere
use every activity discovered after provisioning. No activity is deleted.

To opt out of the isolated Brave launcher recipes, clear the saved opt-in and
restore the original Default/Profile 1 launchers:

```bash
haoshoku --activities-off
```

This retires the DeFi launcher and restores the Brave Work launcher; it does not
delete any activity. The placement matrix is specific to the author's
three-monitor rig and is not portable. Hyprland-specific VRR mutation,
Caelestia recovery, special workspaces, and the portrait lock-screen patch are
deliberately not part of the Plasma path.

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
