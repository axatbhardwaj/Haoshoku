# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Haoshoku is a modular, multi-distro Linux setup and configuration toolkit. It automates installation of applications, developer tools, terminal configs, and system tweaks. Built with JavaScript (ES Modules) and runs on **Bun**.

## Commands

```bash
# Install dependencies
bun install

# Run setup locally
bun haoshoku.js

# Run with specific OS target
bun haoshoku.js --os cachyos
bun haoshoku.js --os debian-server
```

## Architecture

**Entry point**: `haoshoku.js` - CLI using Commander, detects OS via `/etc/os-release` or prompts user, then routes to OS-specific setup.

**OS Scripts** (`src/os_scripts/`):
- `cachyos.js` - Arch/CachyOS desktop setup: Rust, paru AUR helper, Fish shell, Flatpaks, KDE config, gaming tools
- `debian_server.js` - Debian server setup: SSH, UFW firewall, Docker, Fish shell

**Utilities** (`src/common/utils.js`):
- `runCommand(cmd, options)` - Execute shell commands via Bun.spawn, auto-detects when shell is needed
- `commandExists(cmd)` - Check if command is available
- `log` - Colorized console output (info/success/warning/error/dim)

**Helpers** (`src/helpers/`):
- `configure_git.js` - Interactive Git setup with SSH keys and conditional profiles (work/personal)

**Config files** (`configs/`): Templates for Fish, Ghostty, Kitty, Alacritty, Fastfetch - copied to user's `~/.config/` during setup.

**Package lists** (`common/`):
- `paru_applist.txt` - AUR packages for CachyOS
- `flatpacks_arch.txt` - Flatpak apps for CachyOS

## Key Patterns

- OS scripts use `prompts` for interactive user confirmations
- Configs are copied (not symlinked) to user home directories
- `runCommand` automatically uses `sh -c` when command contains shell operators (`|`, `&&`, `>`, etc.)
- All setup functions are async and export a single `run*Setup()` entry point