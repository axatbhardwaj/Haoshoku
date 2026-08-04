# Omazed Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install and configure Omazed on Omarchy so Zed follows the active Omarchy theme, then validate Haoshoku on the current desktop.

**Architecture:** Add Omazed to the existing Arch package path and encapsulate user setup in one injected, idempotent helper. Retire only Haoshoku's legacy Caelestia theme, preserve portable Zed settings, and exercise the same helper during live validation.

**Tech Stack:** Bun, JavaScript ES modules, `bun:test`, Bash, pacman, Omazed, Omarchy hooks, Hyprland IPC.

## Global Constraints

- Never run upstream `install.sh`.
- Never edit `~/.local/share/omarchy/`.
- Never remove an unrelated Zed theme or setting.
- Omazed setup failures remain non-fatal to the main installer.
- Back up live files before changing them.
- Validate every Hyprland edit with reload and config-error checks.

---

### Task 1: Omazed package and user setup

**Files:**
- Create: `src/helpers/configure_omazed.js`
- Create: `tests/configure_omazed.test.js`
- Modify: `common/paru_applist.txt`
- Modify: `src/os_scripts/cachyos.js`

**Interfaces:**
- Consumes: injected `home`, filesystem, command-existence checker, and command runner.
- Produces: `configureOmazed(options): Promise<{configured: boolean, retiredLegacyTheme: boolean}>`.

- [ ] Write tests that require package inclusion, skip outside Omarchy or without the binary, run `omazed setup`, retire only `caelestia.json`, preserve other themes, remain idempotent, and convert setup failure into a warning result.
- [ ] Run `bun test tests/configure_omazed.test.js` and confirm the missing-module/behavior failure.
- [ ] Implement the minimal injected helper and Omarchy-only installer wiring after application configuration.
- [ ] Run the focused tests and formatter, then commit.

### Task 2: Replace active Caelestia Zed theme selection

**Files:**
- Modify: `configs/zed/settings.json`
- Delete: `configs/zed/themes/caelestia.json`
- Modify: `tests/configure_zed.test.js`

**Interfaces:**
- Consumes: Omazed's generated theme named `Omazed`.
- Produces: portable Zed settings selecting `Omazed` in both modes, without a vendored desktop theme.

- [ ] Change tests first to require `Omazed` and absence of the vendored Caelestia theme; run them and confirm failure.
- [ ] Update only the theme selector and remove the obsolete tracked theme.
- [ ] Run the focused Zed and Omazed tests, then commit.

### Task 3: Documentation and repository verification

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `src/helpers/README.md`

**Interfaces:**
- Documents package origin, ownership boundaries, and recovery behavior.

- [ ] Document packaged installation, generated theme ownership, and the prohibition on the manual installer.
- [ ] Run focused tests, full `bun test`, lint, format checks, Bash syntax, and `git diff --check`.
- [ ] Review the complete diff and commit documentation/corrections.

### Task 4: Live Omarchy validation

**Files:**
- Live user files only under `~/.config/{zed,omarchy,hypr}` and `~/.local/bin`.

**Interfaces:**
- Consumes: merged `stable` implementation.
- Produces: evidence that fresh-install operations work on the current environment.

- [ ] Record the current theme, Hyprland errors, affected file hashes, package state, and timestamped backup paths.
- [ ] Install `omazed` using `sudo pacman -S --needed --noconfirm omazed` and run the repository helper.
- [ ] Deploy Omarchy monitors/workspaces through the repository helpers.
- [ ] Run `hyprctl reload`, require empty `hyprctl configerrors`, and inspect active binds/workspace rules.
- [ ] Run `omazed sync`, parse `omazed.json`, confirm settings select `Omazed`, and invoke the installed theme hook with the unchanged current theme.
- [ ] Exercise workspace helper behavior with non-launching/isolated checks, confirm Chromium command paths, and report any app that cannot safely be launched during validation.
- [ ] Re-run focused verification and record the final clean/dirty repository state.
