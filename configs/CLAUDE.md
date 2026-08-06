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
| `kitty/`        | kitty config (the primary terminal) + the terminal-agnostic OSC-palette regeneration tool | Modifying terminal font/window settings, re-syncing the Caelestia palette |
| `ghostty/`      | Retained legacy Ghostty config; installed but no longer deployed or wired to keybinds | Reviewing the former Ghostty setup |
| `fastfetch/`    | Fastfetch system info config        | Modifying system info display             |
| `fish/`         | Fish shell config                   | Modifying shell behavior, aliases         |
| `warp/`         | Warp tab config + theme activation. No longer wired to any keybind — Super+T, Super+A and ws 7 moved to kitty; kept because Warp is still installed | Modifying Warp tab config or theme |
| `vencord/`      | Vencord Discord theme               | Modifying Discord appearance              |
| `claude/`       | Claude Code personal config (copied)    | Modifying settings, backup/restore        |
| `claude-remote-control/` | Claude Remote Control tmux supervisor + systemd user-unit template | Modifying persistent Claude sessions, restart behavior, or attach lifecycle |
| `kde/`          | KDE Ocean theme bundle (5 components)   | Modifying KDE theme deployment            |
| `zed/`          | Zed editor config (sanitized backup)    | Modifying Zed settings, themes            |
| `caelestia/`    | Caelestia user prefs (`hypr-user.conf`, `cli.json`) | Modifying workspace pins, keybinds, special-workspace toggles |
| `audio/`        | PipeWire/WirePlumber drop-in configs (portable PipeWire + device-routed WirePlumber variants; PC has the lossless headset rule) | Modifying audio config, adding device-specific WirePlumber rules |
| `mimeapps/`     | XDG default-application associations (`mimeapps.list`) — fully portable, no device routing | Changing default apps for MIME types or URI scheme handlers |
| `scripts/`      | Executable shell wrappers deployed to `~/.local/bin/` | Adding PATH-shadow wrappers, game-launch hooks |
| `caelestia-lockfix/` | Caelestia lock-screen portrait-fix kit (`apply.sh` + two QML patches) — workaround for upstream Caelestia bug | Updating the portrait-fix patch or re-seeding after a caelestia-shell update |
