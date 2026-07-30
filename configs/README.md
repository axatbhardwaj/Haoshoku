# Configuration Templates

This directory contains template configuration files that are deployed to the user's home directory (usually under `~/.config/`) during the setup process.

## Overview

Haoshoku uses a hybrid approach for configuration management:

- **Regular configs** (fish, warp, alacritty, zed): Copied to destination. Ensures the system remains functional even if the source repository is moved or deleted, though changes to the local repo won't be reflected until setup runs again.
- **Claude bundled config** (`CLAUDE.md`, `statusline-command.sh`, `gitignore.template`): Exactly these three files are copied by `--claude` and captured by `--claude-backup`; the template is mapped to `~/.claude/.gitignore`.
- **Claude executable policy** (`~/.claude/agents/`, `~/.claude/workflows/`): Intentionally absent from this public bundle. A fresh machine must clone a private policy repository the user owns directly into `~/.claude/`; Haoshoku deliberately cannot fetch it.
- **Claude skills and cache-backed agents** (from runtime git clones): Synced separately with `--skills` and symlinked from the cache; real local agents from the private policy checkout take priority.

## Architecture

- **Isolation**: Each application has its own subdirectory (e.g., `fish/`, `warp/`).
- **Standardization**: Configs are pre-configured with sensible defaults, nerd fonts, and color schemes (often matching the Haoshoku theme).
- **Runtime Cloning**: Claude skills and external agents are fetched from configured sources to `~/.cache/haoshoku/` by `--skills`, enabling npm global installs without bundling those repositories.

## Design Decisions

- **Copy vs Symlink**: User-modifiable configs are copied, externally sourced Claude skills and non-shadowed agents are symlinked, and private executable policy remains outside the public package.
- **Subdirectory Structure**: Mirrors the standard `~/.config/` structure for easier mental mapping.

## Invariants

- All configuration files in this directory should be platform-agnostic where possible, or handled specifically in the `os_scripts`.
- Sensitive information (API keys, personal tokens) MUST NEVER be committed to this directory.
