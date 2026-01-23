# Changelog

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
