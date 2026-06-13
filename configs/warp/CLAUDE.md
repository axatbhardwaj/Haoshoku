# configs/warp/

Warp terminal configuration, deployed by `configureWarp()` (`src/helpers/configure_warp.js`).

## Files

| File                      | What                                                  | When to read                          |
| ------------------------- | ----------------------------------------------------- | ------------------------------------- |
| `tab_configs/agents.toml` | Super+A agents split (claude + codex), tab title "agents" | Modifying the agents workspace layout |

## Theme: activated, not shipped

Warp's color theme is **not** stored here. Caelestia generates the Warp theme from its
`warp.yaml` template into `${XDG_DATA_HOME:-~/.local/share}/warp-terminal/themes/caelestia.yaml`
on every scheme change. `configureWarp()` only **activates** it by patching
`${XDG_CONFIG_HOME:-~/.config}/warp-terminal/settings.toml` — `system_theme = false` plus a
`theme = { custom = { name, path } }` object (custom themes require the object form; a bare
string selects a built-in). Warp ignores Caelestia's OSC palette injection
(`warpdotdev/warp#3108`), which is why activation — not OSC — is the fix.

## Agents tab config

`tab_configs/agents.toml` deploys to `${XDG_DATA_HOME:-~/.local/share}/warp-terminal/tab_configs/`.
The Super+A toggle (`configs/caelestia/cli.json`) launches it with
`warp-terminal warp://tab_config/agents?new_window=true` — invoked **directly**, *not* via
`xdg-open`: the GNOME "Warp" file-transfer app (`app.drey.Warp`) also registers the `warp://`
scheme and is frequently the system default handler, so `xdg-open` would open the wrong app.
Hyprland routes the window to `special:agents` by class `dev.warp.Warp` + title `agents`. All
warp-terminal windows share the `dev.warp.Warp` class (there is no custom per-window class), so
the tab config's `title` is the distinguishing match.
