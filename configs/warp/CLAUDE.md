# configs/warp/

Warp is retained as a dormant fallback. Its legacy configuration helper remains
available for manual recovery, but normal setup and active launchers use Kitty.

## Files

| File                      | What                                                  | When to read                          |
| ------------------------- | ----------------------------------------------------- | ------------------------------------- |
| `tab_configs/haki.toml`   | Omarchy Super+A Haki two-pane Claude-over-Codex tab | Modifying the Haki workspace layout |
| `tab_configs/agents.toml` | Caelestia Super+A agents tab (Claude only), tab title "agents" | Modifying the agents workspace layout |
| `themes/elysian.yaml`     | Warp-native port of the active Omarchy Elysian Kitty palette | Modifying Warp colors or readability |

## Elysian theme: shipped and activated

`configureWarp()` copies `themes/elysian.yaml` to
`${XDG_DATA_HOME:-~/.local/share}/warp-terminal/themes/elysian.yaml`, then patches
`${XDG_CONFIG_HOME:-~/.config}/warp-terminal/settings.toml`: `system_theme = false`, the
custom-theme object, and `override_opacity = 77`. The palette is a direct port of the active
Omarchy Elysian Kitty roles and ANSI colors. Warp ignores shell OSC palette injection
(`warpdotdev/warp#3108`), so a native custom theme is required.

Normal CachyOS user-app setup calls `configureKitty()` and does not invoke
`configureWarp()`.

## Dormant agent tab configs

Haki is the two-pane Meta+A layout: Claude above a fresh Codex pane below.
`tab_configs/agents.toml` remains the separate Claude-only contract.

These files are no longer deployed or launched by normal setup. The active
equivalents are `configs/kitty/haki.session` and `agents.session`.
