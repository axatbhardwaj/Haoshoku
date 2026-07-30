# Configuration Templates

This directory contains template configuration files that are deployed to the user's home directory (usually under `~/.config/`) during the setup process.

## Overview

Haoshoku uses a hybrid approach for configuration management:

- **Regular configs** (fish, warp, alacritty, zed): Copied to destination. Ensures the system remains functional even if the source repository is moved or deleted, though changes to the local repo won't be reflected until setup runs again.
- **Claude bundled config** (`CLAUDE.md`, `statusline-command.sh`, `gitignore.template`): Exactly these three files are copied by `--claude` and captured by `--claude-backup`; the template is mapped to `~/.claude/.gitignore`.
- **Claude executable policy** (`~/.claude/agents/`, `~/.claude/workflows/`): Intentionally absent from this public bundle. Bootstrap a private policy repository the user owns in place inside the existing `~/.claude/` directory.
- **Claude skills and cache-backed agents** (from runtime git clones): Synced separately with `--skills` and symlinked from the cache; real local agents from the private policy checkout take priority.

## Claude executable policy bootstrap

On a fresh machine, bootstrap a private policy repository the user owns inside
the existing `~/.claude/` directory with the following in-place sequence.
Because the forced checkout overwrites any existing live file whose path is
tracked by the private repository, copy or review anything you need before
running these commands.

```bash
policy_repo='REPLACE_WITH_PRIVATE_POLICY_REPOSITORY_CLONE_URL'
git -C ~/.claude init
git -C ~/.claude remote add origin "$policy_repo"
git -C ~/.claude fetch origin
git -C ~/.claude remote set-head origin --auto
policy_branch="$(git -C ~/.claude symbolic-ref --short refs/remotes/origin/HEAD)"
git -C ~/.claude checkout -f -B "${policy_branch#origin/}" "$policy_branch"
```

Haoshoku deliberately cannot discover or fetch that private repository, so the
three-file deploy does not produce a complete policy checkout by itself.

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
