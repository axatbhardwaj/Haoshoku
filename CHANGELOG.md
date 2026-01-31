# Changelog

## 3.0.1 - 2026-02-01
- Add animated intro video for README.
- Add new Conqueror's Haki themed logo.
- Add Remotion video project for intro generation.

## 2.13.0 - 2026-01-30
- Add runtime skill manager for Claude skills.
- Add CLI commands for skill management (`--skills`, `--skills-update`).
- Add skill management documentation.
- Prompt to sync skills after OS setup.
- Track shared skill resources independently.
- Remove skills from submodule symlinks (use runtime git clone).

## 2.12.1 - 2026-01-28
- Improve Zed theme readability for context menus.

## 2.12.0 - 2026-01-27
- Add Zed Deep Ocean theme.
- Add Zed theme configuration to CachyOS setup.
- Add Zed to package list.

## 2.11.1 - 2026-01-26
- Sync fish config (add go/bin path, envman, zeditor alias).

## 2.11.0 - 2026-01-25
- Backup personal Claude config.

## 2.10.0 - 2026-01-23
- Remove OpenCode support (deprecated in favor of Claude Code).
- Add hybrid Claude config sync (symlink submodule dirs, copy personal files).
- Add `--claude-backup` flag to backup personal Claude config.
- Add `--claude-update` flag to update submodule and sync.
- Add Fail2ban SSH configuration to Debian server setup.
- Consolidate `promptUser()` to common/utils.js (DRY).
- Add JSDoc comments to configure_claude.js functions.
- Fix README Quick Start to use correct repo name (haoshoku).

## 2.9.0 - 2026-01-15
- Version bump with minor improvements.

## 2.8.0 - 2026-01-10
- Add Claude Code configuration support.
- Add solatis/claude-config as git submodule.

## 2.3.0 - 2025-12-20
- Migrate from Python/PyPI to JavaScript/Bun/npm.
- Rename project from Bankai to Haoshoku.

## 2.2.0 - 2025-12-12
- Remove Dashy provisioning from Debian server setup script.
- Remove Dashy service template from the repository.
