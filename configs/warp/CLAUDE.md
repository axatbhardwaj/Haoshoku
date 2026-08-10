# configs/warp/

Warp terminal configuration, deployed by `configureWarp()` (`src/helpers/configure_warp.js`).

## Files

| File                      | What                                                  | When to read                          |
| ------------------------- | ----------------------------------------------------- | ------------------------------------- |
| `tab_configs/agents.toml` | Super+A agents tab (Claude only), tab title "agents" | Modifying the agents workspace layout |
| `themes/elysian.yaml`     | Warp-native port of the active Omarchy Elysian Kitty palette | Modifying Warp colors or readability |

## Elysian theme: shipped and activated

`configureWarp()` copies `themes/elysian.yaml` to
`${XDG_DATA_HOME:-~/.local/share}/warp-terminal/themes/elysian.yaml`, then patches
`${XDG_CONFIG_HOME:-~/.config}/warp-terminal/settings.toml`: `system_theme = false`, the
custom-theme object, and `override_opacity = 77`. The palette is a direct port of the active
Omarchy Elysian Kitty roles and ANSI colors. Warp ignores shell OSC palette injection
(`warpdotdev/warp#3108`), so a native custom theme is required.

The normal CachyOS user-app setup calls `configureWarp()` again. This restores durable deployment
without restoring any Warp keybind or default-terminal routing; Kitty remains primary until a
separate user-approved switch.

## Agents tab config

`tab_configs/agents.toml` deploys to `${XDG_DATA_HOME:-~/.local/share}/warp-terminal/tab_configs/`
(a single Claude pane; the Codex half of the old top/bottom split was dropped, so
there is no root `split = "vertical"` pane left to declare). Super+A runs the
`agents-toggle` guard script (`configs/scripts/` → `~/.local/bin/`): if `special:agents`
already holds a window it just toggles that workspace's visibility; otherwise it spawns
`warp-terminal warp://tab_config/agents?new_window=true` pinned to `special:agents` via a
Hyprland `[workspace special:agents]` exec rule. Launched **directly** — never `xdg-open`,
which routes `warp://` to the unrelated GNOME "Warp" app (`app.drey.Warp`).

This replaced a Caelestia title-match toggle + windowrule: Warp has no stable per-window
identity (every window is class `dev.warp.Warp`; the title drifts off "agents" once a pane
exits), so title matching spawned duplicate windows. Keying off workspace occupancy is robust.
