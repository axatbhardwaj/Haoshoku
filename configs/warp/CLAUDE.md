# configs/warp/

Warp is the primary XDG terminal. Its configuration is deployed by
`configureWarp()` (`src/helpers/configure_warp.js`).

## Files

| File                      | What                                                  | When to read                          |
| ------------------------- | ----------------------------------------------------- | ------------------------------------- |
| `tab_configs/haki.toml`   | Omarchy Super+A Haki tab | Modifying the Haki workspace layout |
| `tab_configs/agents.toml` | Caelestia Super+A agents tab (Claude only), tab title "agents" | Modifying the agents workspace layout |
| `themes/elysian.yaml`     | Warp-native port of the active Omarchy Elysian Kitty palette | Modifying Warp colors or readability |

## Elysian theme: shipped and activated

`configureWarp()` copies `themes/elysian.yaml` to
`${XDG_DATA_HOME:-~/.local/share}/warp-terminal/themes/elysian.yaml`, then patches
`${XDG_CONFIG_HOME:-~/.config}/warp-terminal/settings.toml`: `system_theme = false`, the
custom-theme object, and `override_opacity = 77`. The palette is a direct port of the active
Omarchy Elysian Kitty roles and ANSI colors. Warp ignores shell OSC palette injection
(`warpdotdev/warp#3108`), so a native custom theme is required.

The normal CachyOS user-app setup calls `configureWarp()` again. It restores the
Elysian theme, every shipped top-level tab config, and the XDG preference for
Warp. Kitty remains installed with its config as an inactive fallback.

## Agents tab config

`tab_configs/haki.toml` and `tab_configs/agents.toml` deploy to
`${XDG_DATA_HOME:-~/.local/share}/warp-terminal/tab_configs/`. The shared
`haoshoku-special-workspace` helper launches their `warp://tab_config/...` URIs,
then tags the exact new window address (`haoshoku-haki` or `haoshoku-agents`).
Workspace 7 uses the same exact-address ownership pattern (`haoshoku-ws7`).
Never place Warp with a broad `dev.warp.Warp` class rule: all Warp windows share it.
