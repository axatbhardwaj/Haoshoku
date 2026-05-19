# Hyprland Monitor Multihost TODO

Captured 2026-05-19, refreshed 2026-05-20 after the Ocean overlay removal (`haoshoku 5.0.0`).

## Why this is open

`haoshoku --hyprland` now installs upstream Caelestia and stops. Monitor configuration is fully delegated to the user (edit `~/.config/caelestia/hypr-user.conf` by hand) — but the same `--hyprland` run prompts for `deviceType` (`pc` / `laptop` / `other`) and persists it to `~/.haoshoku.json`. That answer is captured but not yet consumed. The next pass turns it into per-device monitor configuration that haoshoku writes for you.

## Topology captured on `io` (2026-05-19, still current)

Three connected outputs, vertically centered around y=960. Used as the seed for whatever per-host scheme we land on for the PC.

| Output | Native res @ Hz | Position | Scale | Transform | VRR | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `DP-2` | 1920x1080@179.96 | `0x0` | 1 | 1 (90° CW, portrait) | on | LG UltraGear, EDID `LG Electronics LG ULTRAGEAR 512NTPCER888`. |
| `DP-1` | 2560x1440@143.97 | `1080x240` | 1 | 0 | on | LG UltraGear 1440p, EDID `LG Electronics LG ULTRAGEAR 303NTZN9K909`. Primary monitor (workspace 1 lives here). |
| `HDMI-A-1` | 1920x1080@74.97 | `3640x420` | 1 | 0 | off (panel doesn't support VRR) | LG FHD 75Hz IPS, EDID `LG Electronics LG FHD 0x01010101`. |

Catch-all `monitor = , preferred, auto, 1` at the end for any future unknown output.

Live state on `io` currently sits in `~/.config/caelestia/hypr-user.conf` (port-name keyed). EDID strings are recorded above so a future haoshoku-managed version of this config can swap to `desc:` matching without re-capturing the topology.

## What's already done (no longer open)

- `haoshoku --hyprland` no longer deploys an Ocean overlay — monitors are no longer in the wrong layer; user-owned space (`hypr-user.conf`) is where they live.
- `--hyprland` prompts for `deviceType` and persists `{ deviceType: "pc"|"laptop"|"other" }` to `~/.haoshoku.json`, merging with existing keys (e.g. `skillSources`). This is the seed for per-device handling.
- `~/.config/hypr/scheme/default.conf` alpha-suffixed variants (`$primarye6` etc.) added during the earlier color-scheme fix are still in Caelestia's symlinked tree and will be clobbered by a Caelestia update. Not monitor-related, kept here for visibility — Caelestia's color daemon should normally regenerate `current.conf` dynamically.

## Open questions (decide before implementing)

1. **Selection mechanism.** Two viable shapes for haoshoku to ship per-device monitor configs:
   - **`deviceType`-keyed files in the repo** (`configs/caelestia/hypr-user-pc.conf`, `hypr-user-laptop.conf`). `--hyprland` reads `deviceType` from `~/.haoshoku.json` (or re-prompts if absent) and copies the matching file to `~/.config/caelestia/hypr-user.conf`. Pro: one file per role, no fancy matching. Con: idempotent re-run overwrites any manual edits — needs a "skip if existing differs from shipped" check or a `--monitors` subcommand to make redeployment explicit.
   - **Single shared EDID-keyed file** (`configs/caelestia/hypr-user.conf`) — uses `monitor = desc:LG Electronics LG ULTRAGEAR 303NTZN9K909, …` everywhere plus a catch-all. Unknown EDIDs fall through to `auto`. Same file works on every device. Pro: zero per-host logic, monitor metadata travels with the file. Con: every monitor across every household device needs to land in one shared file; positions are static (laptop docked vs. undocked gets weird unless we add the dock as a separate scenario).
   - Earlier session decision (2026-05-19) leaned toward the per-device-file approach. Worth re-considering once the laptop arrives.

2. **`--monitors` as a separate subcommand?** A dedicated subcommand to write/refresh `~/.config/caelestia/hypr-user.conf` is cleaner than coupling it to `--hyprland` (which is a once-per-machine install command). Argues for splitting after we have the second device to validate against.

3. **Manual-edit protection.** If `hypr-user.conf` exists and contains lines NOT in the shipped template, refuse to overwrite without `--force` (or back up to `hypr-user.conf.bak`). The current `installCaelestia` only pre-creates an empty file when missing, so this only matters once we start writing real content.

4. **Backup flow.** The deleted `--hyprland-backup` previously captured live overlay state back into the repo. The new equivalent would be `--monitors-backup`: read live `~/.config/caelestia/hypr-user.conf`, write it to `configs/caelestia/hypr-user-<deviceType>.conf` in the repo. Skip until we actually need it.

## Related code / files

- `src/helpers/configure_hyprland.js` — owns `installCaelestia()`, `promptDesktopEnvironment()`, `promptDeviceType()`. The next pass adds a `deployMonitorConfig()` (or similar) that consumes `deviceType`.
- `~/.haoshoku.json` — the persisted state file. Already used by skill_manager (`skillSources`); now also stores `deviceType` after `--hyprland`. Reading & merging utility lives in `promptDeviceType`.
- `~/.config/caelestia/hypr-user.conf` — Caelestia's documented user-override hook. Sourced last from Caelestia's `hyprland.conf`. Haoshoku doesn't write to this file in 5.0.0 (apart from pre-creating it empty so Caelestia's `source =` line doesn't error on first reload).

## What is NOT in scope

- Caelestia color scheme regeneration. The alpha-suffixed variants in `~/.config/hypr/scheme/default.conf` are local to one machine, in Caelestia's tree, and unrelated to monitor configuration. Separate cleanup if Caelestia ever clobbers them.
- Workspace-to-monitor pinning. User hasn't asked.
- Display scaling beyond 1.0. Becomes a question once the laptop arrives.
