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
