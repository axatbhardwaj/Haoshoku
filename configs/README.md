# Configuration Templates

This directory contains template configuration files that are deployed to the user's home directory (usually under `~/.config/`) during the setup process.

## Overview

Haoshoku uses a hybrid approach for configuration management:

- **Regular configs** (fish, warp, alacritty, zed): Copied to destination. Ensures the system remains functional even if the source repository is moved or deleted, though changes to the local repo won't be reflected until setup runs again.
- **Claude bundled config** (`CLAUDE.md`, `statusline-command.sh`, `gitignore.template`, `agents/`, `workflows/`): The files are copied and the two directories are merge-deployed by `--claude`; the template is deployed as `~/.claude/.gitignore`.
- **Claude skills and external agents** (from runtime git clones): Synced separately with `--skills` and symlinked from the cache; real bundled or local agents with the same name take priority.

## Architecture

- **Isolation**: Each application has its own subdirectory (e.g., `fish/`, `warp/`).
- **Standardization**: Configs are pre-configured with sensible defaults, nerd fonts, and color schemes (often matching the Haoshoku theme).
- **Runtime Cloning**: Claude skills and external agents are fetched from configured sources to `~/.cache/haoshoku/` by `--skills`, enabling npm global installs without bundling those repositories.

## Design Decisions

- **Copy vs Symlink**: Hybrid approach balances robustness and flexibility. User-modifiable configs are copied, bundled Claude agents/workflows are merge-deployed, and externally sourced Claude skills and non-shadowed agents are symlinked.
- **Subdirectory Structure**: Mirrors the standard `~/.config/` structure for easier mental mapping.

## Invariants

- All configuration files in this directory should be platform-agnostic where possible, or handled specifically in the `os_scripts`.
- Sensitive information (API keys, personal tokens) MUST NEVER be committed to this directory.
