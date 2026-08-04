# Omarchy Workspace Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the complete Haoshoku/Caelestia-era workspace workflow through an additive Omarchy-native Hyprland overlay with isolated Chromium profiles.

**Architecture:** Add one declarative Hyprland overlay, one fixed-recipe Bash toggle helper, and one idempotent deployment helper. Reuse Omarchy's normal user configuration and launch tooling without editing Omarchy source or visual configuration.

**Tech Stack:** Bun, JavaScript ES modules, `bun:test`, Bash, Hyprland IPC, `jq`, `uwsm-app`, Omarchy launch helpers, Chromium.

## Global Constraints

- Never modify `~/.local/share/omarchy/`.
- Do not alter Omarchy themes, terminals, Waybar, Walker, wallpapers, lock screen, or look-and-feel.
- Do not unbind existing Omarchy shortcuts.
- Special workspaces use only the approved `Super+Ctrl+Shift` namespace.
- Browser recipes use Chromium with separate `--user-data-dir` paths and distinct classes.
- Deployment must preserve unrelated user configuration and back up a differing managed overlay.
- Follow red-green-refactor for every behavior change.

---

### Task 1: Hyprland Workspace Overlay

**Files:**
- Create: `configs/omarchy/workspaces.conf`
- Create: `tests/fixtures/omarchy-workspaces.expected.json`
- Create: `tests/omarchy_workspaces_config.test.js`
- Modify: `configs/omarchy/CLAUDE.md`

**Interfaces:**
- Consumes: monitor connector names `DP-1`, `DP-2`, and `HDMI-A-1`.
- Produces: declarative workspace rules, window rules, numbered-key supersets, and special-workspace bindings.

- [ ] Write a failing parser-backed test that reads the real overlay and asserts the literal workspace/monitor map, default/persistent flags, app classes, exact approved shortcuts, and absence of Caelestia/Brave/theme directives.
- [ ] Run `bun test tests/omarchy_workspaces_config.test.js` and confirm failure because the overlay is missing.
- [ ] Add the minimal overlay with workspace declarations, narrow window rules, app-aware `Super+2/4/5/0` commands, and conflict-free special-workspace bindings calling `haoshoku-special-workspace`.
- [ ] Run the focused test and format the JavaScript test.
- [ ] Commit with `feat: add Omarchy workspace overlay`.

### Task 2: Hyprland-Native Special Workspace Helper

**Files:**
- Create: `configs/scripts/haoshoku-special-workspace`
- Create: `tests/haoshoku_special_workspace.test.js`
- Modify: `configs/scripts/CLAUDE.md`

**Interfaces:**
- Consumes: one recipe name from `agents`, `claude-desktop`, `music`, `1password`, `communication`, `browser-flux`, `browser-defi`, or `stash`.
- Produces: a visible/hidden special workspace and a nonzero exit for unknown recipes or unavailable required commands.

- [ ] Write failing executable integration tests with fake `hyprctl`, `jq`, `uwsm-app`, notification, and application commands on a temporary `PATH`. Assert unknown recipe rejection, visible-workspace hiding, existing-workspace showing, missing-app launch, no duplicate communication apps, and exact Chromium arguments/classes.
- [ ] Run `bun test tests/haoshoku_special_workspace.test.js` and confirm failure because the script is missing.
- [ ] Implement the minimal fixed-recipe Bash script with no arbitrary command evaluation.
- [ ] Run the focused tests plus `bash -n configs/scripts/haoshoku-special-workspace`.
- [ ] Commit with `feat: add Omarchy special workspace toggles`.

### Task 3: Idempotent Workspace Deployment

**Files:**
- Create: `src/helpers/configure_omarchy_workspaces.js`
- Create: `tests/configure_omarchy_workspaces.test.js`
- Modify: `src/os_scripts/cachyos.js`
- Modify: `tests/cachyos.test.js`

**Interfaces:**
- Consumes: `home`, filesystem implementation, timestamp, environment, and command runner.
- Produces: `configureOmarchyWorkspaces(options): Promise<{ overlayChanged: boolean, scriptChanged: boolean, sourceChanged: boolean, validated: boolean }>`.

- [ ] Write failing tests using a temporary home: preserve pre-existing `hyprland.conf`, insert the source once, reject a missing main config, back up differing overlay content, install the executable helper, remain idempotent, and validate only during an active Hyprland session.
- [ ] Run `bun test tests/configure_omarchy_workspaces.test.js` and confirm the missing-module failure.
- [ ] Implement the deployer with `safeCopyFile`, executable mode enforcement, and exact source-line matching.
- [ ] Add a failing Arch-flow assertion that workspace deployment occurs only when Omarchy is detected and after monitor deployment.
- [ ] Wire the helper into `runCachyOSSetup()` and run focused tests.
- [ ] Commit with `feat: deploy Omarchy workspace setup`.

### Task 4: Documentation and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `src/helpers/README.md`

**Interfaces:**
- Consumes: completed behavior.
- Produces: accurate user-facing shortcut, browser-profile, and ownership documentation.

- [ ] Document the numbered workspace map, special-workspace key table, isolated Chromium paths, and Omarchy ownership boundary.
- [ ] Add an unreleased changelog entry and helper documentation.
- [ ] Run focused tests, `bash -n`, the complete `bun test` suite, `bun run lint`, changed-file formatting checks, `git diff --check`, and static searches for forbidden Caelestia/Brave/theme behavior in the new active path.
- [ ] Inspect the complete diff against the base branch and correct only migration-related issues.
- [ ] Commit verification corrections if needed.

## Fresh-Install Result

After the branch is integrated, a fresh Omarchy install uses:

```bash
cd ~/personal/Haoshoku
bun install
bun link
haoshoku --os arch
```

The normal Omarchy setup path deploys monitors first and workspace behavior second, then validates Hyprland when a session is active.
