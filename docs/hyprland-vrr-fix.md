# Hyprland VRR Flicker Fix (rotated NVIDIA output)

Captured 2026-05-20 on `io`. Applied live and verified the same session.

## Why this exists

DP-2 (vertical / rotated portrait LG UltraGear 1080p@180Hz) flickered intermittently on idle desktop. DP-1 (1440p@144Hz, landscape) and HDMI-A-1 (1080p@75Hz, landscape, no VRR) never flickered. Telltale symptom: starting *any* video on DP-1 (YouTube tab) immediately stopped DP-2 flickering and stopping it brought flicker back. That correlation is the textbook signature of NVIDIA GPU P-state transition flicker compounding with VRR misbehavior on a rotated output.

## Hardware / driver versions at fix time

- GPU: NVIDIA RTX 4070 Ti, driver `595.71.05`, kernel module `linux-cachyos-nvidia-open 7.0.8-1`
- Hyprland `0.55.2` (Aquamarine `0.11.0`)
- Compositor: Caelestia shell on Hyprland
- iGPU also present (Intel UHD 770, `i915`) but not driving any display

## Evidence captured during diagnosis

From the live Hyprland log (`$XDG_RUNTIME_DIR/hypr/<instance>/hyprland.log`) over ~26 min of session:

| Signal | DP-2 | DP-1 | HDMI-A-1 |
| --- | --- | --- | --- |
| `Connector <name> disconnected` events | 2 | 0 | 0 |
| `Connector <name> connected` events | 3 | 0 | 0 |
| `drm: Cannot commit when a page-flip is awaiting` errors | 10 | 0 | 0 |

Every flicker corresponded to a DP-2 disconnect → re-modeset → connect cycle. Zero such events on the other outputs confirmed the cause was specific to DP-2's combination, not a global driver collapse.

Idle GPU state before the fix (`nvidia-smi`): P-state P3, graphics clock fluctuating around 1695 MHz, memory pinned at 5001 MHz, GPU utilization ~26% from compositor + Caelestia background visualizer.

## Root cause

Two compounding issues:

1. **Structural** — NVIDIA Wayland + VRR on a `transform`-rotated DisplayPort output renegotiates link/VRR parameters and intermittently fails the atomic commit, dropping the DP link. Long-standing known issue against the proprietary driver's Wayland path.
2. **Trigger** — NVIDIA's aggressive idle downclocking. Each P-state transition (P0/P3/P5/P8) re-syncs every connected display, and the rotated/VRR output is the one that breaks on the re-sync.

The Caelestia audio visualizer being enabled was a red herring. It only partially masked the issue when audio was playing — constant frame submission acts the same way sustained video does, keeping the GPU pinned high and the VRR window stable. Visualizer can stay on with no effect on stability either way.

## The fix

Single file: `~/.config/caelestia/hypr-user.conf`.

### Part A — disable VRR on DP-2 only

```diff
- monitor = DP-2, 1920x1080@179.96, 0x0, 1, transform, 1, vrr, 1
+ monitor = DP-2, 1920x1080@179.96, 0x0, 1, transform, 1, vrr, 0
```

Resolution, refresh rate, position, scale, rotation all preserved. Only the trailing `vrr` keyword flips. DP-1 keeps VRR (it's not rotated, was always stable). HDMI-A-1's panel doesn't support VRR anyway.

### Part B — pin NVIDIA into max-performance PowerMizer mode

Added at the bottom of the same file:

```
# Force NVIDIA out of aggressive P-state downclocking to stop multi-monitor flicker.
exec-once = nvidia-settings -a '[gpu:0]/GPUPowerMizerMode=1'
```

Runs once per Hyprland session at startup. Removes the P-state transition trigger entirely.

Apply live without reboot: `hyprctl reload` for Part A, run the `nvidia-settings` command directly for Part B.

## Verification

| Check | Result |
| --- | --- |
| `hyprctl monitors` → DP-2 line | `vrr: false`, `transform: 1` (rotation preserved) |
| `nvidia-smi` graphics clock | pinned at ~2625 MHz (max boost) |
| `nvidia-smi` memory clock | pinned at ~10501 MHz (max) |
| `nvidia-smi` p-state column | still reports `P3` — label is nominal once PowerMizer=1 is active; clocks are what matter |
| New `DP-2 disconnected` events in Hyprland log | none on prolonged idle |

## Cost

- ~10-20W extra idle power on the 4070 Ti — clocks no longer drop to idle floor.
- Fan curve picks up a notch.
- No functional downside on DP-2: VRR on a rotated secondary monitor showing mostly static UI (panels, widgets, chat) gives ~zero perceptual benefit.

## Rollback (each part independently reversible)

- Re-enable VRR on DP-2: flip `vrr, 0` back to `vrr, 1`, then `hyprctl reload`.
- Restore default PowerMizer: `nvidia-settings -a '[gpu:0]/GPUPowerMizerMode=0'` and remove the `exec-once` line.

## If flicker comes back

Walk in order, one variable at a time:

1. Drop DP-2 to 144Hz: `1920x1080@179.96` → `1920x1080@143.98` (in DP-2's available-modes list). Reduces DP link rate margin.
2. Swap the DP-2 cable for a known-good VESA-certified DP 1.4 cable. Marginal cables produce exactly this log signature.
3. Hard kill switch: add `env = __GL_GSYNC_ALLOWED, 0` to `~/.config/hypr/hyprland/env.conf`. Disables G-Sync everywhere — also affects DP-1.

## Implications for haoshoku itself

When `hyprland-monitor-multihost-todo.md` lands a `deployMonitorConfig()` (or `--monitors` subcommand) that writes `~/.config/caelestia/hypr-user.conf` from the repo, the per-device template for `pc` should ship with:

- `vrr, 0` on any rotated (`transform, 1|3`) NVIDIA output by default.
- The `exec-once = nvidia-settings -a '[gpu:0]/GPUPowerMizerMode=1'` line included when NVIDIA is the active GPU. Conditional on driver presence — laptops on iGPU don't need it.

Both are low-risk defaults that prevent the same diagnosis loop on a fresh machine.

## Related code / files

- `~/.config/caelestia/hypr-user.conf` — the user-owned overrides file Caelestia sources last from its `hyprland.conf`.
- `docs/hyprland-monitor-multihost-todo.md` — open work to make haoshoku own the per-host monitor config; this fix is what its `pc` template should emit.

## Key search terms / references

- Hyprland issue tracker: VRR + rotated monitor flicker (NVIDIA)
- NVIDIA `GPUPowerMizerMode` attribute (`1` = Prefer Maximum Performance)
- Aquamarine DRM backend log line: `Cannot commit when a page-flip is awaiting` — atomic commit rejected because previous flip wasn't acknowledged. Strong indicator of NVIDIA Wayland VRR/rotation pipeline issues.
