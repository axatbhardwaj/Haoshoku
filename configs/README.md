# Configuration Templates

This directory contains template configuration files that are deployed to the user's home directory (usually under `~/.config/`) during the setup process.

## Overview

Haoshoku uses a hybrid approach for configuration management:

- **Regular configs** (fish, warp, alacritty, zed): Copied to destination. Ensures the system remains functional even if the source repository is moved or deleted, though changes to the local repo won't be reflected until setup runs again.
- **Claude bundled config** (`CLAUDE.md`, `statusline-command.sh`, `gitignore.template`): Exactly these three files are copied by `--claude` and captured by `--claude-backup`; the template is mapped to `~/.claude/.gitignore`.
- **Claude runtime state** (`settings.json`, credentials, plugins, agents, sessions): Machine-owned and never imported into the public bundle.
- **Claude and Codex skills**: Installed from `mattpocock/skills` through the upstream Skills CLI; no skill source is bundled here.

## Architecture

- **Isolation**: Each application has its own subdirectory (e.g., `fish/`, `warp/`).
- **Standardization**: Configs are pre-configured with sensible defaults, nerd fonts, and color schemes (often matching the Haoshoku theme).
- **External skills**: `--skills` delegates the declared `mattpocock/skills` source to the upstream Skills CLI.

## Design Decisions

- **Copy vs external ownership**: User-modifiable configs are copied; the Skills CLI owns external skill placement.
- **Subdirectory Structure**: Mirrors the standard `~/.config/` structure for easier mental mapping.

## Invariants

- All configuration files in this directory should be platform-agnostic where possible, or handled specifically in the `os_scripts`.
- Sensitive information (API keys, personal tokens) MUST NEVER be committed to this directory.
