# Changelog

## 5.5.3 - 2026-05-31

- Pin the FIFINE USB mic as the default capture source. New `configs/audio/wireplumber/pc/52-fifine-default-source.conf` raises the FIFINE's `priority.session` to 3000 so it wins default-source selection deterministically. Without it the default input is fragile: by stock `priority.session` the Lenovo webcam mic (2109) outranks the FIFINE (2100), so a WirePlumber configured-default state reset, a fresh setup, or a newly-enumerated device would silently route the default mic to the webcam. The rule auto-deploys via the existing device-routed `wireplumber/pc/` path in `configure_audio.js` (no code change needed) and is documented in `configs/audio/CLAUDE.md`. Regression coverage in `tests/configure_audio.test.js` asserts the drop-in ships with the FIFINE `node.name` and `priority.session = 3000`. Live-verified: WirePlumber restarts cleanly with the drop-in, the default source is the FIFINE at priority 3000, and audio output is intact.

## 5.5.2 - 2026-05-31

- Add the agents split-workspace for `Super+A`. The `claude` cli.json toggle (a single-pane `kitty --class=kitty-claude` running `claude -r io`) is replaced by an `agents` toggle that launches `kitty --class=kitty-agents --session=~/.config/kitty/agents.session` — a horizontal split running `claude -r io` (left) alongside a `codex resume` of the shared "io" thread (right). The new `configs/kitty/agents.session` ships the kitty session recipe, and `configureTerminals()` in `cachyos.js` now deploys it to `~/.config/kitty/agents.session` (file-by-file, alongside `kitty.conf`) so the toggle's `--session=` path is never a dangling reference on a fresh install. On the PC variant `Super+A` runs `hyprctl dispatch focusmonitor DP-2` before toggling so the split always lands on the leftmost portrait monitor, and `Super+D` (communication) is rebound with a `focusmonitor HDMI-A-1` prefix so it always opens on the rightmost screen; the laptop variant keeps the bare `caelestia toggle agents` with no monitor forcing (single eDP-1 panel). Regression coverage in `tests/configure_caelestia_prefs.test.js` for the `agents` toggle shape, the session-file content, and the PC/laptop bind routing.
- Restore work that previously lived only in the live `~/.config/caelestia/` and was never committed, so the v5.5.1 config sync reverted `Super+A` to the old single-pane `claude` toggle. Landing it in the repo (cli.json + both hypr-user variants + the session file + deploy wiring) makes the agents split survive future `apply` runs.

## 5.5.1 - 2026-05-25

- Revert the Vivaldi browser trial introduced in PR #7. `Super+W` is rebound from `caelestia toggle vivaldi` back to `caelestia toggle brave-work` (matching Brave's `Profile 1` "Defi" titled window), and `Super+B` is restored for `caelestia toggle brave-personal` (Brave's `Default` "Flux" titled window). The `brave-personal` and `brave-work` cli.json toggle entries and the matching `special:brave-personal` / `special:brave-work` windowrules (with fullscreen-override opacity) are re-added. `vivaldi` is removed from `common/paru_applist.txt` and uninstalled from the machine. ZapZap (WhatsApp Flatpak in `special:communication`) and Cohesion (Notion app on workspace 10) — also from PR #7 — remain untouched; they're stable in daily use.

## 5.5.0 - 2026-05-23

- Back up the current Zed Caelestia theme transparency model. The vendored `configs/zed/themes/caelestia.json` now carries `background.appearance: "blurred"` plus alpha/transparent backgrounds for the editor, gutter, terminal, panel, toolbar, and tab surfaces. The older `experimental.theme_overrides` block is removed from `configs/zed/settings.json`, keeping the Zed settings file focused on selecting the Caelestia theme while the theme file owns its own visual styling.

## 5.4.0 - 2026-05-22

- Trial Vivaldi, ZapZap, and Cohesion as Brave-PWA replacements (PR #7). The Super+W browser toggle is rebound from `caelestia toggle brave-work` to `caelestia toggle vivaldi` (matching class `vivaldi-stable`), and the Super+B personal Brave toggle plus the Brave personal/work special workspaces are removed. WhatsApp Web (previously a Brave PWA at `brave-hnpfjngllnobngcgfapefoaidbinmjnm-Default`) is replaced by the ZapZap Flatpak in the Caelestia communication toggle and the hypr-user special-workspace rules. The Notion workspace (previously the Brave PWA `brave-adaalabfemebkikihnkbonlockjjpbml-Default` on named workspace `0`) is replaced by `cohesion-git`, routed by class `cohesion` on workspace 10 with Super+0 launch/switch behaviour. Brave stays installed as a fallback while the new stack is trialed. Regression coverage in `tests/cachyos.test.js` and `tests/configure_caelestia_prefs.test.js` for the new toggles, removed Brave routing, the ZapZap/Cohesion migrations, and the fullscreen opacity rule.

- Track the `caelestia-sddm` SDDM login theme + its auto-sync posthook inside Haoshoku's CachyOS setup. `installCaelestia()` now installs `caelestia-sddm-minimalistv2-git` via `paru` (outside the `skipHyprlandPackages` branch — the SDDM theme is not a Hyprland compositor package; non-fatal — a failed install warns and continues). `configs/caelestia/cli.json` ships `wallpaper.postHook` + `theme.postHook` entries so Caelestia re-runs the SDDM sync on every wallpaper/colour change. A new `configureSddm()` helper writes `/etc/sudoers.d/caelestia-sddm-sync` (scoped to exactly `sync.sh --posthook` — least privilege) so the posthook runs without a password. The sudoers write is a single validated root transaction (`visudo -c -f <tmpfile>` before `install`, same-shell `rm` on failure) so a syntax error can never lock the user out of sudo. All three pieces — package, postHooks, sudoers — are gated together by the Caelestia install decision; a CachyOS user who declines Hyprland gets none of them. New `--sddm-posthook` CLI flag re-writes just the sudoers rule.

## 5.3.1 - 2026-05-22

- Make the Zed editor background transparent and blurred. A new `experimental.theme_overrides` block in `configs/zed/settings.json` sets `background.appearance` to `"blurred"` and drops the editor/panel/tab/terminal backgrounds to 60%-opacity alpha, so the editor background is frosted-translucent (the compositor blurs through it) while text stays fully opaque. Done at the app layer rather than via a Hyprland window-opacity rule — that route dimmed the text itself and hurt readability.

## 5.3.0 - 2026-05-22

- Add audio config tracking. New `configs/audio/` holds the PipeWire/WirePlumber drop-ins for bit-perfect lossless playback; `src/helpers/configure_audio.js` provides `syncAudioConfig`/`backupAudioConfig`/`configureAudio`, exposed as `--audio` / `--audio-backup` and run as part of the CachyOS setup. The portable PipeWire drop-ins (`pipewire.conf.d/`, `pipewire-pulse.conf.d/`) deploy on any machine; the WirePlumber drop-in is device-routed under `wireplumber/<deviceType>/` because it hard-pins a specific output device. `readDeviceType` was extracted from `configure_caelestia_prefs.js` into `src/common/utils.js` so both helpers share it.
- Add `mimeapps` config tracking. New `configs/mimeapps/mimeapps.list` + `src/helpers/configure_mimeapps.js` (`syncMimeappsConfig`/`backupMimeappsConfig`) + `--mimeapps` / `--mimeapps-backup` version-control the XDG default-application associations (default image viewer, URI scheme handlers). Single portable file, no device routing.
- Add the Caelestia lock-screen portrait-fix kit. New `configs/caelestia-lockfix/` ships `apply.sh` plus two QML patches that fix the Caelestia lock screen on portrait monitors (a workaround for an upstream Caelestia bug). `src/helpers/configure_lockfix.js` (`--lockfix` / `--lockfix-backup`) deploys the kit to `~/.local/share/caelestia-lockfix/`, and `installCaelestia()` now runs `apply.sh` automatically after `caelestia-shell` is installed — non-fatally, so a patch failure never aborts setup.
- Add a sysmon (btop) toggle to the Caelestia config.
- Stop tracking `~/.claude.json`. `backupClaudeConfig` was copying it raw into this public repo, but `~/.claude.json` is Claude Code runtime state (caches, usage stats, per-project session metadata, `oauthAccount`) — not reproducible config. Removed `claude.json` from `PERSONAL_FILES` and deleted `configs/claude/claude.json`; the genuine Claude config (`settings.json`, `CLAUDE.md`, `conventions/`, `output-styles/`) stays tracked.
- Loosen value-pinned config tests. The zed-theme and caelestia workspace-routing tests asserted exact personal-config values (theme hex, app classes/commands) and broke whenever a `--*-backup` captured legitimate config drift. They now assert structure — a valid hex color, and the launch-if-missing bind shape — so backups no longer fight the test suite.
- Refresh the tracked config snapshot from the current machine: `hypr-user-pc.conf` (workspace 0 migrated from the Cohesion Flatpak to the Notion Brave-PWA, plus a `Super+Print` per-monitor screenshot bind), Zed settings + theme, and Claude `settings.json`.

## 5.2.7 - 2026-05-21

- Fix `installCaelestia()` silently leaving stock CachyOS Hyprland configs in place, which orphans the deployed `~/.config/caelestia/hypr-user.conf`. CachyOS Hyprland edition ships `/etc/skel/.config/hypr/` containing a stock `hyprland.conf` (no `source = $cConf/hypr-user.conf` line). That stock dir lands in every fresh user's home before haoshoku ever runs. Caelestia's `install.fish` then refuses to clobber the existing `~/.config/hypr/` and skips its own symlink step entirely. Result: Hyprland reads CachyOS's `hyprland.conf` which never sources `hypr-user.conf`, so `haoshoku --caelestia-prefs` deploys monitor/keybind/exec-once overrides that no Hyprland session can see. New `moveStockHyprConfigAside()` helper detects this case (regular dir or symlink-to-elsewhere at `~/.config/hypr/`) and renames it to `~/.config/hypr.bak.<timestamp>` before invoking install.fish. Idempotent: an existing correct symlink (`~/.config/hypr` → `~/.local/share/caelestia/hypr`) is left alone. Existing installs can recover by running `mv ~/.config/hypr ~/.config/hypr.cachyos-default.bak; fish ~/.local/share/caelestia/install.fish; haoshoku --caelestia-prefs; hyprctl reload`.
- Add 3 tests in `tests/configure_hyprland.test.js`: stock dir gets moved aside with original content preserved in `.bak.<ts>`, correct Caelestia symlink is left untouched (no spurious backups), and a wrong-target symlink is moved aside as defense against leftover state.

## 5.2.6 - 2026-05-21

- Fix the default `bun haoshoku.js` Hyprland step to match what `haoshoku --hyprland` already does. The prompt copy ("Install Hyprland + Caelestia rice (parallel to KDE)?") was hardcoded around an assumption of a current KDE session, defaulted to NO regardless of detected DE, and never asked the user's device type or current DE. As a result: Hyprland-edition CachyOS installs got a misleading prompt + a redundant `pacman -S hyprland …` install, and laptop users got the PC `hypr-user.conf` (NVIDIA + multi-monitor pins) because `syncCaelestiaPrefs()` fell back to the PC variant without a `deviceType` in `~/.haoshoku.json`. Now `configureHyprland()` detects `$XDG_CURRENT_DESKTOP`, defaults the prompt to YES when Hyprland is already running, and on confirm calls `promptDesktopEnvironment()` + `promptDeviceType()` before bootstrapping Caelestia. The DE answer is forwarded as `skipHyprlandPackages: de === "hyprland"`; the device answer is persisted to `~/.haoshoku.json` so the PC vs laptop hypr-user variant deploys correctly on first install. The post-install SDDM hint now only mentions the Plasma fallback when the user actually came from KDE.
- Add `deployWallpapers()` to copy `deskback/*` into `~/Pictures/Wallpapers/` as part of the Hyprland setup. Idempotent — existing files in the destination are skipped so user-added wallpapers and re-runs both survive. Runs after `installUserScripts()` so the rest of the Hyprland install path is unchanged.
- Add `thunar` to `common/paru_applist.txt` for users who want a graphical file manager on the Hyprland session (Caelestia doesn't bundle one).
- Add 9 tests in `tests/cachyos.test.js`: no more "parallel to KDE" copy, `promptDesktopEnvironment` + `promptDeviceType` imported and called before `installCaelestia`, `skipHyprlandPackages` forwarded based on DE answer, `deployWallpapers` runs after `installCaelestia` and targets `~/Pictures/Wallpapers`, `deskback/` ships at least one file, and `thunar` is in the AUR list.

## 5.2.5 - 2026-05-21

- Skip the paru per-package install loop for packages already in pacman's local DB. `installPackagesFromFile()` now snapshots `pacman -Qq` once and filters `common/paru_applist.txt` down to the missing set before invoking paru. AUR packages installed via paru land in the same local DB as repo packages, so the snapshot covers both. On a fresh CachyOS install nothing changes — every package is missing, every package gets installed. On a re-run or partial install, the loop drops from ~75 paru invocations (each paying an AUR HTTP roundtrip for AUR packages) to only the truly missing ones. Failure of the snapshot itself (e.g. pacman lock contention) falls back to the prior "try to install everything" behavior so no regression. The pre-filter only fires when the installer command contains `paru` or `pacman` — flatpak invocations skip it.
- Add `--needed` to the paru install command. Catches the edge case where exact-name pre-filter misses a `provides` relationship: e.g. the list pins `bun-bin` but the user already has a different package providing `bun`. `--needed` lets paru resolve the provides graph and skip cleanly instead of installing a redundant `-bin` variant.

## 5.2.4 - 2026-05-21

- Fix CachyOS shells crashing after every command with `test: Missing argument at index 3` from `/usr/share/cachyos-fish-config/conf.d/done.fish` line 229. `configureFishShell()` was installing `franciscolourenco/done`, `meaningful-ooo/sponge`, `jorgebucaran/nvm.fish`, and `joseluisq/gitnow` via fisher — but `configs/fish/config.fish` line 1 already sources `/usr/share/cachyos-fish-config/cachyos-config.fish`, which CachyOS ships with the same four plugins pre-installed under `/usr/share/cachyos-fish-config/conf.d/`. Both copies loaded on every shell start, double-registered `__done_ended` for `fish_postexec`, and tripped over each other's state so `__done_min_cmd_duration` was empty by the time the handler fired. `configureFishShell()` now installs only `jorgebucaran/fisher` (the manager itself, so users can still add unrelated plugins later) and skips the four duplicates. Users with the old install can recover by running `fisher remove franciscolourenco/done meaningful-ooo/sponge jorgebucaran/nvm.fish joseluisq/gitnow` then `exec fish`.

## 5.2.3 - 2026-05-20

- Add Caelestia app-workspace launch behavior to the persisted `hypr-user` variants. App-routed normal workspaces now switch first, then launch any missing mapped app: `Super+0` opens Cohesion, `Super+2` opens Steam on the PC template, `Super+4` opens Vesktop, and `Super+5` opens both Teams and Telegram. The bindings are guarded with `hyprctl clients -j` checks so repeated workspace activations do not spawn duplicate windows.
- Make the special-workspace mapping explicit in both `hypr-user` variants and `cli.json`: Signal + WhatsApp Web live in `special:communication`, 1Password in `special:1password`, Spotify in `special:music` via `Super+M`, Brave personal in `special:brave-personal`, and Brave work in `special:brave-work`.
- Extend the PC Caelestia monitor policy so VRR is disabled on every output, not just the rotated NVIDIA portrait monitor. The existing PowerMizer pin remains the mechanism that keeps the multi-monitor setup stable.
- Add a deployed `game-performance` PATH-shadow wrapper for CachyOS game launches. The wrapper enables DP-1 VRR and Caelestia game mode for the lifetime of the game process, then reverts both on exit.
- Expand `tests/configure_caelestia_prefs.test.js` to lock the normal-workspace launch bindings and special-workspace toggle/routing model.

## 5.2.2 - 2026-05-20

- Apply the Brave personal/work profile directory swap to `configs/caelestia/cli.json` so fresh `haoshoku --hyprland` installs deploy the same corrected Caelestia CLI toggle commands already used locally: personal opens Brave's `Default` profile and work opens `Profile 3`.

## 5.2.1 - 2026-05-20

- Add `uwsm` to `haoshoku --hyprland`'s pacman package set so manual Haoshoku Hyprland installs match CachyOS' installer profile and include the runtime needed for the `Hyprland (uwsm-managed)` SDDM session.
- Keep the `skipHyprlandPackages` path unchanged: users already running Hyprland still skip the full Hyprland package install.
- Include the existing unreleased follow-ups already on `stable`: kitty/Claude terminal theming via OSC sequences, KDE Connect autostart in both per-device Caelestia `hypr-user` variants, and the Brave personal/work profile directory mapping repair.

## 5.2.0 - 2026-05-20

- Replace v5.1.2's skip-on-laptop stopgap with a **per-device hypr-user variant router**. `configs/caelestia/hypr-user.conf` is renamed to `hypr-user-pc.conf` (existing PC content unchanged) and a new `hypr-user-laptop.conf` ships alongside it (eDP-1 @ 2880x1800@120 scale 1.6, no monitor-pinned workspaces, no NVIDIA exec-once — fits the actual single-screen Intel-iGPU laptop topology). `syncCaelestiaPrefs()` now reads `deviceType` from `~/.haoshoku.json` and routes to the matching variant, deploying it as `~/.config/caelestia/hypr-user.conf`. `backupCaelestiaPrefs()` mirrors this: snapshots from `~/.config/caelestia/hypr-user.conf` back to the variant file matching the local deviceType (so a laptop backup doesn't overwrite the PC variant).
- Variant resolution: `deviceType === "pc"` or `"laptop"` → that variant. Anything else (unset, `"other"`, malformed `~/.haoshoku.json`, missing key) → falls back to `pc` (safer default for the legacy / mainstream case). If the chosen variant file doesn't exist in the repo (e.g. deleted), `hypr-user.conf` deploy is skipped with a warning; `cli.json` still deploys.
- Update `tests/configure_caelestia_prefs.test.js` from 16 tests covering v5.1.2's skip behavior to 20 tests covering the router: both deviceType branches deploy their correct variant, four fallback paths land on PC, missing-variant skips gracefully, idempotent re-run, and static-config validation now asserts both `hypr-user-pc.conf` and `hypr-user-laptop.conf` ship with their expected shape (PC has `monitor:` pinned workspaces; laptop has eDP-1 + no monitor pins + no `nvidia-settings`).
- Update `configs/caelestia/CLAUDE.md` to document the per-device variant model and the deviceType resolution rules.

## 5.1.2 - 2026-05-20

- Fix `syncCaelestiaPrefs()` deploying the PC's `hypr-user.conf` onto laptop installs. The auto-deployed file carries machine-specific monitor lines (`DP-1`/`DP-2`/`HDMI-A-1`), workspace-to-monitor pins, and an NVIDIA `nvidia-settings GPUPowerMizerMode=1` exec-once that all fail or no-op on a single-screen laptop with an iGPU. `syncCaelestiaPrefs` now reads `deviceType` from `~/.haoshoku.json` (populated by `--hyprland`'s `promptDeviceType`) and skips machine-specific files when `deviceType === "laptop"`. `cli.json` (portable special-workspace toggle defs) deploys regardless. Missing / malformed / unset `~/.haoshoku.json` falls back to the existing "deploy everything" behavior — safer default for unknown machines.
- Add 6 regression tests in `tests/configure_caelestia_prefs.test.js` covering: laptop skips `hypr-user.conf` (the new behavior), pc deploys both files (current behavior preserved), missing `~/.haoshoku.json` deploys both, unset `deviceType` key deploys both, malformed JSON deploys both, unknown `deviceType` value (`"other"`) deploys both.
- Per-device template work is still tracked in `docs/hyprland-monitor-multihost-todo.md`; v5.1.2 is the safety patch that prevents broken first-run experience on laptops while we figure out the proper laptop template (likely v5.2.0 once the laptop install captures its topology).

## 5.1.1 - 2026-05-20

- Fix `runCachyOSSetup()` not deploying the user's saved Caelestia preferences. v5.1.0 added `--caelestia-prefs` as a standalone flag but forgot to call `configureCaelestiaPrefs()` from `configureHyprland()` in `src/os_scripts/cachyos.js`, so a fresh `haoshoku` install (no flags) booted Hyprland with upstream Caelestia defaults instead of the user's `configs/caelestia/{hypr-user.conf, cli.json}`. Now `configureHyprland()` calls `configureCaelestiaPrefs()` immediately after `installCaelestia()`, mirroring how `configureZed()` runs after its install step. Manually re-running `haoshoku --caelestia-prefs` is still supported as the explicit path.
- Add 2 regression tests in `tests/cachyos.test.js`: one asserts `configureCaelestiaPrefs` is called exactly once after `installCaelestia`, the other asserts the import line resolves to `../helpers/configure_caelestia_prefs.js`. Both follow the existing static-source-analysis pattern used for the fish/fastfetch ordering tests.

## 5.1.0 - 2026-05-20

- Add `--caelestia-prefs` and `--caelestia-prefs-backup` CLI flags for syncing personal Caelestia overrides (`hypr-user.conf`, `cli.json`) between `configs/caelestia/` and `~/.config/caelestia/`. Mirrors the `--zed` / `--zed-backup` pattern, so workspace pins, keybind rebinds, and special-workspace toggle config (the `caelestia toggle <ws>` entries used by Super+M music, Super+D communication, Super+O 1Password, Super+W/B brave-work/personal, Super+A claude, Super+H stash, etc.) are now versioned in-tree and redeployable on fresh installs. `hypr-user.conf` still carries machine-specific `monitor = ...` lines — edit those on different hardware per the new `configs/caelestia/CLAUDE.md`.
- Add `src/helpers/configure_caelestia_prefs.js` exporting `syncCaelestiaPrefs` / `backupCaelestiaPrefs` / `configureCaelestiaPrefs`. Helpers accept optional `home` / `projectRoot` so tests can inject temp dirs while production callers stay zero-arg.
- Add 10 tests in `tests/configure_caelestia_prefs.test.js` covering module shape, both sync directions, idempotency, missing-file tolerance, and static-config validation of the seeded `configs/caelestia/{hypr-user.conf, cli.json}` snapshots.

## 5.0.1 - 2026-05-20

- Make Zed follow the Caelestia desktop theme by default. `configs/zed/settings.json` now selects `Caelestia` for both light and dark modes, and Haoshoku vendors `configs/zed/themes/caelestia.json` so fresh `haoshoku --zed` installs do not depend on a pre-existing local Zed theme.
- Add regression coverage ensuring the Zed template continues to select Caelestia and the vendored theme remains parseable.
- Make `haoshoku --hyprland` explicitly set Caelestia to 24-hour time by merging `services.useTwelveHourClock: false` into `~/.config/caelestia/shell.json` while preserving existing shell settings.

## 5.0.0 - 2026-05-20

**Breaking change.** Removes the haoshoku-managed "Ocean" Hyprland overlay layer (curated borders/blur/keybinds/window-rules/autostart/hyprlock/hypridle/hyprpaper/mako) on top of upstream Caelestia. `--hyprland` now installs Caelestia + nothing else. Monitor configuration becomes the user's responsibility.

- Remove CLI subcommands `--hyprland-keybinds`, `--hyprland-rules`, `--hyprland-backup`. The functions backing them (`syncHyprlandOverlay`, `backupHyprland`, the KDE→Hyprland translators for shortcuts/window-rules/autostart, the Ocean palette parser, `kdeRgbToHyprlandRgba`, `sanitizeDesktopExec`, `ensureLineInFile`, the `OVERLAY_SOURCE_LINE` / `CAELESTIA_USER_INCLUDE` / `OCEAN_OVERLAY_DIR` / `HYPR_BUNDLE_DIR` constants) are gone with them. `src/helpers/configure_hyprland.js` shrinks from 987 LOC to ~270.
- Delete `configs/hypr/` (8 `conf.d/` files + `hyprpaper.conf` + `hyprlock.conf` + `hypridle.conf` + `mako/config`) — Caelestia's Quickshell ships its own lockscreen / idle / wallpaper / notification handling (the Quickshell daemon `qs -c caelestia -n -d` owns `org.freedesktop.Notifications` directly).
- Delete `docs/hyprland-parity-gap.md` (KDE shortcut → Hyprland bind translation tracker — no longer relevant without the translators).
- `installCaelestia` no longer writes a `source = ~/.config/hypr-ocean/conf.d/*.conf` line into `~/.config/caelestia/hypr-user.conf` and no longer creates `~/.config/hypr-ocean/`. `hypr-user.conf` is now pure user-owned space (pre-created empty so Hyprland's first `source =` doesn't error before Caelestia's lazy-init exec hook runs).
- `installCaelestia` accepts a new `skipHyprlandPackages` option to bypass the `pacman -S hyprland …` step when the caller is already running Hyprland. Also drops `mako` from `HYPRLAND_PACKAGES` (Caelestia covers notifications).
- `--hyprland` now prompts for two things up front:
  - **Current desktop environment** (auto-detected via `$XDG_CURRENT_DESKTOP`; user can override). When the answer is `hyprland`, `installCaelestia` runs with `skipHyprlandPackages: true`.
  - **Device type** (Main PC / Laptop / Other / Skip). Non-skip answers persist to `~/.haoshoku.json` as `deviceType`, merging with any existing keys. The answer isn't consumed yet — it's the seed for future per-device monitor configuration (see `docs/hyprland-monitor-multihost-todo.md`).
- Add 20 tests in `tests/configure_hyprland.test.js` covering `installCaelestia` (happy path, `skipHyprlandPackages`, idempotent re-run, recovery, two regression guards against re-introducing Ocean), `promptDesktopEnvironment` (4 cases including cancel), `promptDeviceType` (4 cases including merge-don't-overwrite), and the existing `checkoutPinnedCaelestia` / `recoverCaelestiaPackages` paths. Full project suite drops from 80 to 38 tests — the 50+ removed tests exercised the deleted KDE translators and overlay sync.
- Update `README.md`, `docs/CLAUDE.md`, and `docs/hyprland-monitor-multihost-todo.md` to reflect the slimmed scope and the `deviceType` workflow. Refresh `cachyos.js` to stop calling `syncHyprlandOverlay()`.

**Rollback / pinning.** `npm install -g haoshoku@4.6.6` (or checkout `v4.6.6` from git) restores the Ocean overlay. No deprecation branch — the git tag is the rollback point.

**Known caveat on existing installs.** `~/.config/hypr/scheme/default.conf` may contain alpha-suffixed Caelestia color variants (`$primarye6` etc.) added during the 4.6.x color-scheme fix. They're in Caelestia's symlinked tree and Caelestia normally regenerates `current.conf` dynamically from your wallpaper — a future Caelestia update will clobber them. Not addressed by 5.0.0; flagged here for visibility.

## 4.6.6 - 2026-05-20
- Fix `translateKdeWindowRulesToHyprland` emitting deprecated `windowrulev2 =` lines. Hyprland 0.45+ renamed the keyword to `windowrule =` and changed the matcher grammar: inline `class:^(foo)$` selectors became space-separated `match:class ^foo$` after a comma, and boolean rules now require an explicit value (`float` → `float true`). Output now reads `windowrule = float true, match:class ^foo$` / `windowrule = opacity 0.90, match:class ^foo$` / `windowrule = workspace N, match:class ^foo$`. Regex metacharacters in the class name are still escaped, and explicit `^...$` anchors are kept to preserve v2's exact-class match semantics. On current Hyprland (0.55.2), the prior v2 output was both spamming `configerrors` and on track to stop applying entirely in a future release.
- Update the 6 test assertions that pinned the old syntax (including 2 in the "Adversarial coverage" block that asserted on the bare `class:^(b)$` substring), and regenerate `configs/hypr/conf.d/30-windowrules.conf` via `bun haoshoku.js --hyprland-rules`.
- Add `docs/hyprland-monitor-multihost-todo.md` capturing the deferred multi-host monitor work: today's live topology on host `io` (positions, transforms, EDIDs so it's reconstructable), already-made decisions (per-host strategy, primary monitor, vertical alignment, portrait rotation), and open questions for the next pass on `configs/hypr/conf.d/50-monitors.conf`.

## 4.6.5 - 2026-05-19
- Fix `--hyprland` Caelestia recovery when CachyOS package mirrors or sync databases are stale. If the explicit `paru -S caelestia-cli caelestia-shell` retry fails, Haoshoku now runs one CachyOS mirror refresh plus forced pacman database refresh, then retries the Caelestia leaf packages before failing.
- Add regression coverage for the mirror/database refresh retry path so the installer no longer gives up immediately on transient CachyOS `.sig` retrieval failures.

## 4.6.2 - 2026-05-19
- Fix 14 KDE→Hyprland translation bugs found via adversarial test coverage of `src/helpers/configure_hyprland.js`. Most produced malformed Hyprland directives that would cause Hyprland to silently reject the entire `conf.d/` file, dropping every keybind or rule it contained.
- Security: `checkoutPinnedCaelestia` now validates `pinnedSha` against `/^[a-f0-9]{7,40}$/i` before interpolating it into the `git checkout` command. The shared `runCommand` helper auto-routes commands containing shell metacharacters through `sh -c`, so an unvalidated SHA like `"abc; rm -rf $HOME"` would have executed shell injection.
- `kdeRgbToHyprlandRgba`: reject components outside 0–255 (e.g. `256` → `rgba(1000000ff)` 9-char body) and reject `alphaHex` that isn't exactly 2 hex chars (`"xyz"` → `rgba(000000xyz)`).
- `translateKdeWindowRulesToHyprland`: pick the second token (class) of multi-token `wmclasscomplete=true` values per KDE spec — `.pop()` was wrong for 3-token Qt app names; escape regex metacharacters in `wmclass` so `foo(bar` doesn't break Hyprland's PCRE; clamp `opacityactive` to 0–100 so `-50` / `150` no longer emit `opacity -0.50` / `opacity 1.50`.
- `sanitizeDesktopExec`: strip adjacent field codes like `%f%u` (the prior regex required whitespace boundaries and silently passed concatenated codes); broaden the Flatpak `@@<letter> … @@` wrapper match so unknown prefixes like `@@x` are also stripped; preserve `%%` literal-percent via negative lookbehind.
- `translateKdeShortcutsToHyprland`: reject empty keys (e.g. `Meta+` trailing-`+`) which otherwise emitted `bind = SUPER, , dispatcher`; dedupe modifier tokens so `Ctrl+Alt+Ctrl+X` collapses to `CTRL_ALT, X` instead of the malformed `CTRL_ALT_CTRL, X`.
- `translateKdeAutostartToHyprland`: peel known shim binaries (`env`, `dbus-run-session`, `dbus-launch`, `nohup`, `setsid`, `stdbuf`) and their flag / `NAME=VAL` args before checking the denylist. Without this, `Exec=env DISPLAY=:0 kdeconnectd` and `Exec=dbus-run-session -- kdeconnectd` bypassed the KDE-service denylist.
- `ensureLineInFile`: throw when the `line` argument contains a newline. The trim-based dedupe would always miss a multi-line input, then write the blob verbatim — silently appending extra Hyprland directives into `hypr-user.conf`.
- Add 17 new adversarial test cases (red/blue/green workflow) covering each confirmed bug surface plus positive companion tests. Total hyprland tests: 39 → 58; full project suite: 56 → 77, all green.

## 4.6.1 - 2026-05-19
- Exclude local agent/runtime state (`.claude/`, `.dvandva/`, `superpowers/`) and generated video output from package dry-runs/publishes.
- Fix lint-only issues in the Remotion video components so the release branch passes `bun run lint` cleanly.

## 4.6.0 - 2026-05-19
- Add `--hyprland`: bootstrap Hyprland plus upstream Caelestia rice and deploy the Ocean overlay on CachyOS/Arch. KDE Plasma remains installed as the SDDM fallback session.
- Add `--hyprland-keybinds`: regenerate `configs/hypr/conf.d/20-keybinds.conf` from `configs/kde_shortcuts.kksrc` with translated Hyprland binds.
- Add `--hyprland-rules`: regenerate `configs/hypr/conf.d/30-windowrules.conf` and `40-autostart.conf` from live KDE config with KDE-only autostart services denylisted.
- Add `--hyprland-backup`: pull live `~/.config/hypr-ocean/` and `~/.config/mako/` overlay state back into `configs/hypr/`.
- Bundle the Ocean Hyprland overlay: Ocean borders, KDE Glass-style blur, Wayland env, keybind/rule/autostart translations, hyprpaper, hyprlock, hypridle, mako, and a safe monitor fallback.

## 4.5.0 - 2026-05-14
- Fix `--claude` aborting before deploying any config on a fresh install. When the cache was empty, the auto-skill-sync was treating an empty `skillSources` array as "all sources failed" and calling `process.exit(1)` — so `syncClaudeConfig()` never ran and `~/.claude/CLAUDE.md`, `~/.claude/settings.json`, `~/.claude/statusline-command.sh`, and `~/.claude.json` all silently failed to deploy.
- `syncSkills` now returns `{ status, merged }` (one of `"ok" | "no-sources" | "all-failed"`) instead of calling `process.exit`. The `--claude` and `--claude-update` paths treat non-`ok` as a warning and continue with the config deploy; `--skills` and `--skills-update` translate `"all-failed"` into a non-zero exit code, preserving direct-CLI exit semantics.
- `syncClaudeConfig` no longer silently skips when a source file is missing from the bundle — it now logs `⚠ Missing <file> in source bundle — skipped` so a partial/broken package is visible instead of looking like a successful sync. Added regression tests for the `PERSONAL_FILES` manifest (must include `statusline-command.sh`) and the missing-source warning.
- Inject `srcDir`/`claudeHome` options into `syncClaudeConfig`/`backupClaudeConfig` and `configPath`/`cacheDir` into `syncSkills` (defaults unchanged) so tests can drive them against tmp dirs without touching live `~/.claude/`.

## 4.4.0 - 2026-05-14
- Sync personal Claude config snapshot (`settings.json`, `CLAUDE.md`, `claude.json` runtime state, `statusline-command.sh`) from live `~/.claude/`.
- CLAUDE.md: add a `## PR Reviews` routing section codifying the local-markdown-as-deliverable workflow — never auto-post; explicit per-session approval required; medium-shape format (verdict + severity table + condensed strengths + per-finding paragraphs) when posting to GitHub; verbatim code-block fixes go inline rather than expanding the body; `~/defi/misc/reviews/review-PR-<num>.md` is the canonical defi-com path.
- settings.json: migrate effort selection from top-level `effortLevel: "xhigh"` to env-driven `env.CLAUDE_CODE_EFFORT_LEVEL: "max"`; drop the disabled `openai-codex` plugin (entry + source); add `editorMode: "normal"`.
- statusline: render the new `max` effort tier with a per-character green → cyan → purple Dracula gradient (`#50FA7B` → `#8BE9FD` → `#BD93F9`). Refactor the effort branch to compose a full pre-colored token (`eff_render`) instead of computing only a color, which is what unlocks per-character rainbow rendering.

## 4.3.0 - 2026-05-11
- Replace `--gsd` with `--superpowers`. The new flag idempotently enables the Superpowers plugin via a direct edit to `~/.claude/settings.json` (different shape from `--gsd`'s npx shell-out).
- Remove dead `gsd-*` agent emoji entries from the Claude Code statusline (live + backed-up copy).
- Update README, helpers README, and configs/claude/README to reflect the migration.

## 4.2.1 - 2026-05-10
- Add reasoning effort indicator to Claude Code statusline (`💭 <level>` color-coded by tier — dim/blue/green/magenta for low/medium/high/xhigh; shows `⚡ fast` when fast mode bypasses thinking).
- Sync personal Claude config snapshot (`settings.json`, `CLAUDE.md`, `claude.json` runtime state) from live `~/.claude/`. CLAUDE.md transitions from GSD-era routing to Superpowers framework.

## 4.2.0 - 2026-04-28
- Remove Ghostty integration end-to-end (config templates, `--ghostty-theme` flag, per-OS deploy block). Kitty replaces it as the default terminal.
- Port deep-ocean theme to Kitty (palette, 0xProto Nerd Font Mono, opacity 0.85, KDE-honored `background_blur`, shift+enter Claude Code newline keybind).
- Backup before overwrite for fish, kitty, and alacritty configs (closes ROB-02). Existing configs are preserved as `<dest>.bak` on each deploy. Single rolling backup matches the existing KDE-shortcuts pattern.
- Add `safeCopyFile` helper to `common/utils.js` with three test specs.

## 4.1.1 - 2026-04-17
- Fix Claude Code statusline branch + path display.
- Require web search for current package/library versions in Claude conventions.

## 4.1.0 - 2026-04-16
- Add Claude Code statusline support (sync + deploy).
- Add Node.js install and Claude config deployment to Debian server setup.
- Refactor `CLAUDE.md` template for Claude 4.7.
- Bump GitHub Actions versions in CI.

## 4.0.0 - 2026-03-16
- Add `--gsd` flag to install GSD (get-shit-done) for Claude Code.
- Deploy conventions and output-styles via `--claude` (previously unmanaged).
- Agents now deployed from skills repo via `--skills` (no longer bundled in haoshoku).
- Remove solatis/claude-config as default skill source.
- Update all documentation to reflect new architecture.

## 3.2.0 - 2026-02-07
- Add KDE Ocean theme deployment (`--kde-theme`, `--kde-theme-backup`).
- Bundle Ocean LAF theme assets (look-and-feel, Kvantum, Aurorae, desktop theme, color scheme).
- Add `copyDirRecursive` utility for nested directory operations.

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
