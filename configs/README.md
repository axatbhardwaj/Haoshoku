# Configuration Templates

This directory contains template configuration files that are deployed to the user's home directory (usually under `~/.config/`) during the setup process.

## Overview

Haoshoku uses a "Copy-on-Setup" strategy for configuration management. Unlike some dotfile managers that use symlinks, Haoshoku copies the files to their destination. This ensures that the installed system remains functional even if the source repository is moved or deleted, although it means that changes to the local repo won't be reflected in the system until the setup script is run again.

## Architecture

- **Isolation**: Each application has its own subdirectory (e.g., `fish/`, `kitty/`).
- **Standardization**: Configs are pre-configured with sensible defaults, nerd fonts, and color schemes (often matching the Haoshoku theme).
- **Submodules**: Some complex configurations, like `claude-config`, are managed as Git submodules to allow for independent versioning and reuse.

## Design Decisions

- **Copy vs Symlink**: Copying was chosen for robustness and simplicity, avoiding broken symlink issues.
- **Subdirectory Structure**: Mirrors the standard `~/.config/` structure for easier mental mapping.

## Invariants

- All configuration files in this directory should be platform-agnostic where possible, or handled specifically in the `os_scripts`.
- Sensitive information (API keys, personal tokens) MUST NEVER be committed to this directory.
