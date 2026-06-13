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

`tab_configs/agents.toml` deploys to `${XDG_DATA_HOME:-~/.local/share}/warp-terminal/tab_configs/`
(claude | codex, top/bottom split via `split = "vertical"`). Super+A runs the
`agents-toggle` guard script (`configs/scripts/` → `~/.local/bin/`): if `special:agents`
already holds a window it just toggles that workspace's visibility; otherwise it spawns
`warp-terminal warp://tab_config/agents?new_window=true` pinned to `special:agents` via a
Hyprland `[workspace special:agents]` exec rule. Launched **directly** — never `xdg-open`,
which routes `warp://` to the unrelated GNOME "Warp" app (`app.drey.Warp`).

This replaced a Caelestia title-match toggle + windowrule: Warp has no stable per-window
identity (every window is class `dev.warp.Warp`; the title drifts off "agents" once a pane
exits), so title matching spawned duplicate windows. Keying off workspace occupancy is robust.
