# Omarchy Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Haoshoku's existing Arch setup safe and useful on a fresh Omarchy installation while preserving Omarchy's Bash and visual configuration.

**Architecture:** Keep `src/os_scripts/cachyos.js` as the existing Arch-family orchestration module to avoid a broad rename. Add two focused helpers for managed Bash configuration and monitor restoration, while small pure functions in the Arch module select package commands and Omarchy integrations. Remove KDE/Caelestia CLI surfaces and default-flow calls without restructuring unrelated portable helpers.

**Tech Stack:** Bun, JavaScript ES modules, `bun:test`, Bash, Arch `pacman`, `yay`/`paru`, Omarchy CLI helpers, Hyprland.

## Global Constraints

- Do not overhaul the project or refactor unrelated helpers.
- Bash remains the login shell; Haoshoku must not run `chsh` or install Fish on the Arch/Omarchy path.
- Omarchy exclusively owns themes, terminal configuration, wallpapers, lock screen, and desktop appearance.
- Haoshoku may restore only `~/.config/hypr/monitors.conf` beneath the Omarchy Hyprland configuration.
- Repository packages use `pacman`; AUR packages use `yay` first and `paru` second.
- No command may install the complete `nerd-fonts` group.
- CachyOS gaming meta-packages are forbidden; the gaming set must be portable.
- Existing unrelated user changes must be preserved.

---

## File Structure

- `src/helpers/configure_bash.js`: idempotently deploy and source Haoshoku's Bash fragment.
- `configs/bash/haoshoku.bash`: portable aliases, initializers, and PATH logic ported from Fish.
- `tests/configure_bash.test.js`: behavior tests using a temporary home directory.
- `src/helpers/configure_omarchy_monitors.js`: restore only `monitors.conf`, back up changed content, and validate an active Hyprland session.
- `configs/omarchy/monitors.conf`: exact current working three-monitor layout.
- `tests/configure_omarchy_monitors.test.js`: isolated restoration, idempotence, backup, and validation tests.
- `src/os_scripts/cachyos.js`: minimal Arch/Omarchy package routing, gaming changes, and default-flow removals.
- `tests/cachyos.test.js`: Arch-flow regression tests replacing obsolete KDE/Fish/theme expectations.
- `src/common/cli_utils.js`, `haoshoku.js`, `tests/cli_utils.test.js`, `tests/haoshoku_help.test.js`: Arch naming and removal of obsolete KDE/Caelestia modes.
- `common/paru_applist.txt`: remove desktop-specific KDE packages and packages now handled by focused setup functions.
- `README.md`, `CHANGELOG.md`, relevant `CLAUDE.md` files: document the Omarchy-first Arch behavior and remove obsolete public workflows.

### Task 1: Managed Bash Configuration

**Files:**
- Create: `configs/bash/haoshoku.bash`
- Create: `src/helpers/configure_bash.js`
- Create: `tests/configure_bash.test.js`
- Modify: `configs/CLAUDE.md` if present, otherwise add `configs/bash/CLAUDE.md`

**Interfaces:**
- Consumes: `home`, filesystem implementation, and `safeCopyFile`-compatible copy behavior.
- Produces: `configureBash({ home?, fsImpl?, now? }): { changed: boolean, bashrcChanged: boolean }`.

- [ ] **Step 1: Write failing Bash deployment tests**

Test real temporary files: deployment creates `~/.config/haoshoku/bashrc`, an existing `.bashrc` remains byte-for-byte intact except for one trailing source block, a second run adds nothing, and the fragment contains Bash forms of `ls`, `dog`, `agy`, Git aliases, Starship, zoxide, direnv, pyenv, Conda, and the optional secrets source. Assert it contains no Fish syntax, CachyOS source, Caelestia path, or `chsh`.

- [ ] **Step 2: Verify the new test fails for the missing helper**

Run: `bun test tests/configure_bash.test.js`

Expected: FAIL because `src/helpers/configure_bash.js` does not exist.

- [ ] **Step 3: Implement the minimal Bash fragment and idempotent deployer**

Use a single recognizable block in `.bashrc`:

```bash
# Haoshoku managed shell additions
[[ -r "$HOME/.config/haoshoku/bashrc" ]] && source "$HOME/.config/haoshoku/bashrc"
```

The deployed fragment must guard every optional program with `command -v`, use Bash functions for background-launching `cursor` and `antigravity`, use aliases for Fish abbreviations, add directories only when they exist, and source `~/.config/haoshoku/secrets.bash` only when readable.

- [ ] **Step 4: Run the focused tests and format affected files**

Run: `bun test tests/configure_bash.test.js && bunx biome format src/helpers/configure_bash.js tests/configure_bash.test.js --write`

Expected: PASS with no warnings.

- [ ] **Step 5: Commit the Bash component**

```bash
git add configs/bash src/helpers/configure_bash.js tests/configure_bash.test.js
git commit -m "feat: port shell configuration to bash"
```

### Task 2: Omarchy Monitor Restoration

**Files:**
- Create: `configs/omarchy/monitors.conf`
- Create: `src/helpers/configure_omarchy_monitors.js`
- Create: `tests/configure_omarchy_monitors.test.js`

**Interfaces:**
- Consumes: bundled monitor template, destination home, `commandExists`, and `runCommand`.
- Produces: `configureOmarchyMonitors({ home?, fsImpl?, now?, commandExistsImpl?, runCommandImpl?, env? }): Promise<{ changed: boolean, backup: string | null, validated: boolean }>`.

- [ ] **Step 1: Write failing restoration tests**

Cover missing destination creation, exact-content no-op, changed-content backup at `monitors.conf.bak.<timestamp>`, preservation of the old bytes, and proof that no sibling Hyprland file is written. Test that active Hyprland calls `hyprctl reload` followed by `hyprctl configerrors`, while missing `HYPRLAND_INSTANCE_SIGNATURE` defers validation.

- [ ] **Step 2: Verify the monitor tests fail for the missing helper**

Run: `bun test tests/configure_omarchy_monitors.test.js`

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Add the exact monitor template and minimal helper**

Copy the current layout values exactly. The helper compares bytes before writing, uses a timestamped adjacent backup only for differing existing content, and never traverses or rewrites the rest of `~/.config/hypr`.

- [ ] **Step 4: Run focused tests and format JavaScript**

Run: `bun test tests/configure_omarchy_monitors.test.js && bunx biome format src/helpers/configure_omarchy_monitors.js tests/configure_omarchy_monitors.test.js --write`

Expected: PASS.

- [ ] **Step 5: Commit monitor restoration**

```bash
git add configs/omarchy src/helpers/configure_omarchy_monitors.js tests/configure_omarchy_monitors.test.js
git commit -m "feat: restore Omarchy monitor layout"
```

### Task 3: Arch/Omarchy Package and Gaming Flow

**Files:**
- Modify: `src/os_scripts/cachyos.js`
- Modify: `tests/cachyos.test.js`
- Modify: `common/paru_applist.txt`

**Interfaces:**
- Consumes: `commandExists`, `runCommand`, `configureBash`, and `configureOmarchyMonitors`.
- Produces: the existing full Arch setup entry point, plus exported pure selection helpers where needed for direct tests.

- [ ] **Step 1: Replace obsolete static tests with failing behavioral invariants**

Add assertions that the setup:

```js
expect(source).not.toContain("paru -S fish");
expect(source).not.toContain("pacman -S $(pacman -Sgq nerd-fonts)");
expect(source).not.toContain("cachyos-gaming-meta");
expect(source).toContain("ttf-jetbrains-mono-nerd");
```

Also test AUR selection order (`yay`, then `paru`, then bootstrap), use of `pacman` for repository packages, the exact portable gaming package set, guarded `omarchy-install-gaming-gpu-lib32`, Bash and monitor helper calls, and absence of default terminal/Zed/wallpaper/KDE/Caelestia mutation calls.

- [ ] **Step 2: Run focused Arch tests and confirm expected failures**

Run: `bun test tests/cachyos.test.js`

Expected: FAIL on the old Fish, font-group, `paru`, gaming-meta, and desktop-config behavior.

- [ ] **Step 3: Implement minimal package-manager selection**

Use `pacman -S --needed --noconfirm` for known repository packages. Resolve the AUR helper once per run by checking `yay`, then `paru`; retain a small bootstrap fallback only if both are absent. Pass the resolved command into the existing per-package installer rather than embedding `paru` strings.

- [ ] **Step 4: Implement the portable gaming prompt**

Install repository packages `steam gamemode lib32-gamemode gamescope mangohud lib32-mangohud` with pacman and `protonup-rs-bin` with the selected AUR helper. If `omarchy` and `omarchy-install-gaming-gpu-lib32` exist, invoke the GPU helper; otherwise log that GPU-specific 32-bit packages were not guessed.

- [ ] **Step 5: Remove desktop ownership violations from the default flow**

Delete calls/imports/constants for terminal config copying, Warp theme activation, Zed config/theme syncing, wallpaper deployment, Fish setup, KDE configuration, and Caelestia-related logic from `cachyos.js`. Add `configureBash()` and conditionally call `configureOmarchyMonitors()` on detected Omarchy. Keep portable Git, MIME, scripts, audio, Fastfetch, Claude, Codex, and developer setup.

- [ ] **Step 6: Trim the application list narrowly**

Remove clearly KDE-specific packages (`partitionmanager`, `dolphin`, `kvantum`, `okular`, `merkuro`) and remove `fish` because Bash setup owns the shell decision. Do not prune unrelated applications.

- [ ] **Step 7: Run focused tests and formatting**

Run: `bun test tests/cachyos.test.js tests/configure_bash.test.js tests/configure_omarchy_monitors.test.js && bunx biome format src/os_scripts/cachyos.js tests/cachyos.test.js --write`

Expected: PASS.

- [ ] **Step 8: Commit the Arch/Omarchy setup change**

```bash
git add src/os_scripts/cachyos.js tests/cachyos.test.js common/paru_applist.txt
git commit -m "feat: adapt Arch setup for Omarchy"
```

### Task 4: Remove KDE/Caelestia CLI Surface and Update Naming

**Files:**
- Modify: `haoshoku.js`
- Modify: `src/common/cli_utils.js`
- Modify: `tests/cli_utils.test.js`
- Modify: `tests/haoshoku_help.test.js`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: existing Commander setup and OS detector.
- Produces: `--os arch` as the documented Arch-family target, with `cachyos` retained as a compatibility alias if passed explicitly.

- [ ] **Step 1: Write failing CLI and detection expectations**

Tests must assert that help and mode flags no longer expose Plasma, Activities, KDE theme/glass, Caelestia preferences/lockfix/SDDM, or Zed theme deployment. Assert that Arch detection returns the Arch-family target and the interactive label says `Arch / Omarchy`. Preserve unrelated one-shot flags.

- [ ] **Step 2: Verify CLI tests fail against the old surface**

Run: `bun test tests/cli_utils.test.js tests/haoshoku_help.test.js`

Expected: FAIL because obsolete flags and CachyOS labels remain.

- [ ] **Step 3: Remove obsolete options, imports, and dispatch branches**

Remove only KDE/Caelestia/appearance-specific CLI paths. Keep portable audio, MIME, Bash-independent Zed settings backup/sync only if it does not deploy Haoshoku's theme; otherwise remove that mode too. Ensure Commander mode exclusivity tests match the remaining registered flags.

- [ ] **Step 4: Update Arch naming compatibly**

Return `arch` for Arch-family auto-detection, list `Arch / Omarchy` in the prompt, dispatch `arch` to the existing Arch setup, and accept explicit legacy `--os cachyos` as an alias with a deprecation note rather than breaking existing automation.

- [ ] **Step 5: Rewrite user documentation around Omarchy ownership**

Document Bash, monitor restoration, package-helper selection, focused gaming packages, Omarchy appearance preservation, fresh-install invocation, and the legacy CachyOS alias. Remove KDE Activities, Plasma migration, Caelestia, Fish-default, custom terminal theme, Zed-theme, and wallpaper claims from the active README. Add an unreleased changelog entry.

- [ ] **Step 6: Run CLI tests and formatting**

Run: `bun test tests/cli_utils.test.js tests/haoshoku_help.test.js && bunx biome format haoshoku.js src/common/cli_utils.js tests/cli_utils.test.js tests/haoshoku_help.test.js --write`

Expected: PASS.

- [ ] **Step 7: Commit the CLI and documentation change**

```bash
git add haoshoku.js src/common/cli_utils.js tests/cli_utils.test.js tests/haoshoku_help.test.js README.md CHANGELOG.md
git commit -m "chore: retire KDE and Caelestia setup paths"
```

### Task 5: Full Verification and Installed Bun Link

**Files:**
- Modify only files required by failures directly caused by Tasks 1-4.

**Interfaces:**
- Consumes: complete repository state.
- Produces: verified source tree and a documented command for installing the fixed local package after the OS reinstall.

- [ ] **Step 1: Run the complete automated suite**

Run: `bun test`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Run lint and formatting checks**

Run: `bun run lint && bunx biome format .`

Expected: lint passes and formatter reports no required changes. If formatting changes are required, run `bun run format`, inspect the diff, and rerun both checks.

- [ ] **Step 3: Run static safety searches**

Run searches proving the active Arch/default CLI path contains no `cachyos-gaming-meta`, full `nerd-fonts` group install, `paru -S fish`, Fisher, KDE/Caelestia dispatch, terminal-theme copy, wallpaper deploy, or Zed-theme activation. Confirm `configs/omarchy/monitors.conf` exactly matches the intended current layout.

- [ ] **Step 4: Inspect the final diff and repository state**

Run: `git diff HEAD~4 --check && git status --short --branch`

Expected: no whitespace errors and only intentional changes.

- [ ] **Step 5: Commit any verification-only corrections**

```bash
git add <only-files-corrected-during-verification>
git commit -m "fix: complete Omarchy migration verification"
```

Skip this commit when no correction is needed.

- [ ] **Step 6: Record the fresh-install command in the handoff**

Use the local repository after reinstall:

```bash
cd ~/personal/Haoshoku
bun install
bun link
haoshoku --os arch
```

Do not mutate the currently installed global Bun package during development; the user intends to reinstall Omarchy before using the fixed installer.
