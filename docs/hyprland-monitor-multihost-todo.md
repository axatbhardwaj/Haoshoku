# Hyprland Monitor Multihost TODO

Captured 2026-05-19. Graduates `configs/hypr/conf.d/50-monitors.conf` from its v1 placeholder (`monitor = , preferred, auto, 1`) to a real per-host monitor layout, and decides how to keep that layout sane across multiple machines.

## Why this is open

`configs/hypr/conf.d/50-monitors.conf` is still the safe-auto-layout fallback from the v1 release note ("until a live topology can be captured from the real Hyprland session"). The live topology has now been captured on host `io` (2026-05-19) but it lives in the wrong place — inside Caelestia's `~/.config/hypr/hyprland.conf` directly — so it isn't owned by the haoshoku repo and will be overwritten on the next Caelestia install / update.

Goal: move the captured topology into the Ocean overlay (`configs/hypr/conf.d/50-monitors.conf`) so haoshoku owns it, and design a per-host selection scheme so the laptop and any future PC don't trample each other.

## Topology captured on `io` (2026-05-19)

Three connected outputs, vertically centered around y=960:

| Output | Native res @ Hz | Position | Scale | Transform | VRR | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `DP-2` | 1920x1080@179.96 | `0x0` | 1 | 1 (90° CW, portrait) | on | LG UltraGear, EDID `LG Electronics LG ULTRAGEAR 512NTPCER888`. Primary monitor (workspace 1) is **not** this. |
| `DP-1` | 2560x1440@143.97 | `1080x240` | 1 | 0 | on | LG UltraGear 1440p, EDID `LG Electronics LG ULTRAGEAR 303NTZN9K909`. **Primary monitor** (workspace 1 lives here). |
| `HDMI-A-1` | 1920x1080@74.97 | `3640x420` | 1 | 0 | off (panel doesn't support VRR) | LG FHD 75Hz IPS, EDID `LG Electronics LG FHD 0x01010101`. |

Catch-all `monitor = , preferred, auto, 1` retained at the end for any future unknown monitor.

Currently live (wrong layer) at: `/home/xzat/.config/hypr/hyprland.conf` lines 16–26. Move to the Ocean overlay before next Caelestia sync.

## User decisions already made

- **Strategy:** per-host files selected by hostname (not a single shared EDID-keyed file, not a hybrid defaults+overrides setup). Each machine gets its own monitor layout file.
- **Primary monitor on `io`:** DP-1 (1440p UltraGear).
- **Vertical alignment on `io`:** center-aligned (cost: cursor walls in the top/bottom 240px of DP-2 and top/bottom 180px of DP-1; user accepted).
- **Portrait rotation on `io`:** `transform, 1` (90° clockwise). Confirmed correct visually after first reload — if a future rebuild ever lands upside-down, flip to `transform, 3`.

## Open questions (resolve before implementing)

1. **Hostname identifier convention.** Current static hostname on this machine is `io`. Future hosts are "more PC" and "laptop" — what are their canonical names? Should haoshoku use raw `os.hostname()` from Node, `hostnamectl --static`, or a haoshoku-internal alias mapped via `.haoshoku.json`? Decision affects the filename pattern: `50-monitors-io.conf` vs `50-monitors-main-desktop.conf` vs `50-monitors-$(role).conf`.
2. **Selection mechanism.** Two viable spots:
   - haoshoku's `syncHyprlandOverlay()` filters by hostname during the repo-to-`~/.config/hypr-ocean/` copy, so only the matching `50-monitors-<host>.conf` lands on disk.
   - All `50-monitors-*.conf` files ship to every machine; selection happens inside Hyprland via `exec`-driven symlink. (More fragile, prefer option 1.)
3. **Unknown-host behavior.** If a brand new machine syncs the overlay before its `50-monitors-<host>.conf` exists, do we ship a generic `50-monitors.conf` fallback (same as today's `monitor = , preferred, auto, 1`)? Recommendation: yes — keeps Hyprland bootable on a fresh host while the operator captures the live topology.
4. **EDID-vs-port matching within each host file.** On `io` we used port names (`DP-2`, `DP-1`, `HDMI-A-1`) because cables don't move. If a future host has identical monitors on swappable ports, switch that host's file to `desc:` matching against the EDID strings already captured above. Document the rule in the new conf file header.
5. **Caelestia hyprland.conf cleanup.** Once the Ocean overlay's `50-monitors.conf` owns the real layout, revert the in-tree edits to `~/.config/hypr/hyprland.conf` (lines 16–26 of the current file) back to the Caelestia-shipped single-line catch-all. Otherwise we keep editing Caelestia's symlinked tree and the next install will fight us.

## Related code / files

- `src/helpers/configure_hyprland.js` — owns `syncHyprlandOverlay()` (repo → `~/.config/hypr-ocean/`) and `backupHyprland()` (live overlay → repo). Hostname filtering, if chosen, lands here.
- `configs/hypr/conf.d/50-monitors.conf` — current v1 placeholder. Graduates to either `50-monitors-<host>.conf` per-host files plus a fallback, or a single dispatcher file. Decide in (2).
- `~/.config/caelestia/hypr-user.conf` — single-line bridge `source = ~/.config/hypr-ocean/conf.d/*.conf`. Must contain that line for any overlay file (including the future monitor config) to load.
- `docs/hyprland-parity-gap.md` — sibling tracking note; style template for this one.

## What is NOT in scope

- Workspace-to-monitor pinning (e.g. ws 1–4 on DP-1, ws 5 on DP-2). User hasn't asked. Revisit if they do.
- Display scaling beyond 1.0. The 1440p panel is comfortable at 1x; HiDPI laptop scaling becomes a question once the laptop arrives.
- Caelestia color scheme regeneration. Today's fix in `~/.config/hypr/scheme/default.conf` (added alpha-suffixed variants `$primarye6`, `$primaryd4`, `$onSurfaceVariant11`, `$outlined4`, `$secondaryd4`, `$surfaced4`) lives in the Caelestia tree too — a separate cleanup if we ever want haoshoku to own its color fallback rather than relying on Caelestia's dynamic generator.
