# configs/caelestia/

Caelestia personal preferences (user-side overrides sourced last by Caelestia).

## Files

| File                    | What                                                           | When to read                                                    |
| ----------------------- | -------------------------------------------------------------- | --------------------------------------------------------------- |
| `hypr-user-pc.conf`     | PC variant: 3 monitors (DP-1/DP-2/HDMI-A-1), NVIDIA exec-once, workspace-to-monitor pins | Modifying PC monitor layout, workspace pins, NVIDIA defaults  |
| `hypr-user-laptop.conf` | Laptop variant: single eDP-1 HiDPI panel, Intel iGPU, no monitor pins | Modifying laptop monitor layout or laptop-specific overrides  |
| `cli.json`              | Caelestia CLI overrides for `caelestia toggle <ws>` (portable across devices) | Adding/removing special-workspace toggle apps                 |

## How deviceType selection works

`configureCaelestiaPrefs()` reads `deviceType` from `~/.haoshoku.json` (populated by `haoshoku --hyprland`'s `promptDeviceType`) and routes to the matching variant:

- `deviceType === "pc"`     → deploys `hypr-user-pc.conf`     → `~/.config/caelestia/hypr-user.conf`
- `deviceType === "laptop"` → deploys `hypr-user-laptop.conf` → `~/.config/caelestia/hypr-user.conf`
- Anything else (unset, malformed, `"other"`) → falls back to the PC variant.

Both variants share the portable bits (keybinds, special-workspace toggles, app routing) and differ only in the machine-specific lines (monitor declarations, workspace-to-monitor pins, NVIDIA exec-once). `cli.json` is always deployed identically.

## Notes

- Hypr-user variants contain machine-specific `monitor = ...` lines keyed by connector name. Edit those if monitor topology changes (e.g. you connect a new external).
- The catch-all `monitor = , preferred, auto, 1` in both variants handles unexpected outputs (occasional TV/projector on the laptop, hot-plug on the PC).
