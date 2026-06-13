# Configuration Templates

This directory contains template configuration files that are deployed to the user's home directory (usually under `~/.config/`) during the setup process.

## Overview

Haoshoku uses a hybrid approach for configuration management:

- **Regular configs** (fish, warp, alacritty, zed): Copied to destination. Ensures the system remains functional even if the source repository is moved or deleted, though changes to the local repo won't be reflected until setup runs again.
- **Claude skills/agents** (from runtime git clone): Symlinked from cache to destination. Allows updates to skills without re-running setup.
- **Claude personal config** (claude.json, settings.json): Copied to destination for user-specific customization.

## Architecture

- **Isolation**: Each application has its own subdirectory (e.g., `fish/`, `warp/`).
- **Standardization**: Configs are pre-configured with sensible defaults, nerd fonts, and color schemes (often matching the Haoshoku theme).
- **Runtime Cloning**: Claude config (agents, conventions, skills) is fetched via git clone to `~/.cache/haoshoku/` at runtime, enabling npm global installs.

## Design Decisions

- **Copy vs Symlink**: Hybrid approach balances robustness and flexibility. Copying used for user-modifiable configs (terminal, editor), symlinks for shared resources (Claude skills) that benefit from synchronized updates.
- **Subdirectory Structure**: Mirrors the standard `~/.config/` structure for easier mental mapping.

## Invariants

- All configuration files in this directory should be platform-agnostic where possible, or handled specifically in the `os_scripts`.
- Sensitive information (API keys, personal tokens) MUST NEVER be committed to this directory.
