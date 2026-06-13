# configs/

Template configuration files copied to user's `~/.config/` during setup.

## Files

| File                  | What                          | When to read                              |
| --------------------- | ----------------------------- | ----------------------------------------- |
| `kde_shortcuts.kksrc` | KDE keyboard shortcuts        | Modifying KDE shortcuts                   |

## Subdirectories

| Directory       | What                                | When to read                              |
| --------------- | ----------------------------------- | ----------------------------------------- |
| `alacritty/`    | Alacritty terminal config           | Modifying Alacritty settings              |
| `fastfetch/`    | Fastfetch system info config        | Modifying system info display             |
| `fish/`         | Fish shell config                   | Modifying shell behavior, aliases         |
| `warp/`         | Warp tab config + theme activation  | Modifying Warp agents tab config or theme |
| `vencord/`      | Vencord Discord theme               | Modifying Discord appearance              |
| `claude/`       | Claude Code personal config (copied)    | Modifying settings, backup/restore        |
| `kde/`          | KDE Ocean theme bundle (5 components)   | Modifying KDE theme deployment            |
| `zed/`          | Zed editor config (sanitized backup)    | Modifying Zed settings, themes            |
| `caelestia/`    | Caelestia user prefs (`hypr-user.conf`, `cli.json`) | Modifying workspace pins, keybinds, special-workspace toggles |
| `audio/`        | PipeWire/WirePlumber drop-in configs (portable PipeWire + device-routed WirePlumber variants; PC has the lossless headset rule) | Modifying audio config, adding device-specific WirePlumber rules |
| `mimeapps/`     | XDG default-application associations (`mimeapps.list`) — fully portable, no device routing | Changing default apps for MIME types or URI scheme handlers |
| `scripts/`      | Executable shell wrappers deployed to `~/.local/bin/` | Adding PATH-shadow wrappers, game-launch hooks |
| `caelestia-lockfix/` | Caelestia lock-screen portrait-fix kit (`apply.sh` + two QML patches) — workaround for upstream Caelestia bug | Updating the portrait-fix patch or re-seeding after a caelestia-shell update |
