# configs/

Template configuration files copied to user's `~/.config/` during setup.

## Files

| File                  | What                          | When to read                              |
| --------------------- | ----------------------------- | ----------------------------------------- |
| `kde_shortcuts.kksrc` | KDE keyboard shortcuts        | Modifying KDE shortcuts                   |
| `README.md`           | Copy-vs-symlink rationale and Claude bundle boundary | Understanding the deployment model |

## Subdirectories

| Directory       | What                                | When to read                              |
| --------------- | ----------------------------------- | ----------------------------------------- |
| `alacritty/`    | Alacritty terminal config           | Modifying Alacritty settings              |
| `ghostty/`      | Primary terminal config (`config` includes the generated Omarchy theme) | Modifying terminal settings, opacity, or keybinds |
| `fastfetch/`    | Fastfetch system info config        | Modifying system info display             |
| `fish/`         | Fish shell config                   | Modifying shell behavior, aliases         |
| `bash/`         | Portable interactive Bash additions loaded after Omarchy defaults | Modifying Bash initializers, aliases, or PATH additions |
| `warp/`         | Retained dormant Warp tab configs and shipped Elysian theme | Reviewing the former Warp setup |
| `vencord/`      | Vencord Discord theme               | Modifying Discord appearance              |
| `discord/`      | Discord theme manifest deploying the Omarchy theme's Vencord CSS into Vesktop/Vencord | Modifying which theme CSS or enabled themes Discord clients receive |
| `claude/`       | Claude Code compact personal policy (copied) | Modifying policy backup/restore       |
| `codex/`        | Codex compact personal policy | Modifying deployed Codex agent guidance   |
| `agent-profile/` | Shared T3 Code profile (PROFILE.md) deployed to Claude, Codex, Opencode and Antigravity, plus harness-specific appendices (e.g. GEMINI.append.md) | Modifying the single configurable agent identity |
| `hermes-relay/` | Immutable Hermes runtime bootstrap pin | Updating the Hermes runtime pin |
| `hyprmoncfg/`   | Authored monitor/workspace profile JSON consumed by hyprmoncfg; Haoshoku NEVER writes generated `monitors.lua` | Modifying monitor layouts or monitor-bound workspace rules without crossing the hyprmoncfg ownership boundary |
| `kde/`          | KDE Ocean theme bundle (5 components)   | Modifying KDE theme deployment            |
| `kwin/`         | KWin script placing KDE Activity windows on outputs by connector name | Modifying activity-window output placement |
| `zed/`          | Zed editor config (sanitized backup)    | Modifying Zed settings, themes            |
| `audio/`        | PipeWire/WirePlumber drop-in configs (portable PipeWire + device-routed WirePlumber variants; PC has the lossless headset rule) | Modifying audio config, adding device-specific WirePlumber rules |
| `mimeapps/`     | XDG default-application associations (`mimeapps.list`) — fully portable, no device routing | Changing default apps for MIME types or URI scheme handlers |
| `omarchy/`      | Omarchy 4 Hyprland Lua overlays and keybinding-swap registry | Read `omarchy/CLAUDE.md` before changing overlays, require wiring, keybindings, or ownership boundaries |
| `scripts/`      | Executable shell wrappers deployed to `~/.local/bin/` | Adding PATH-shadow wrappers, game-launch hooks |
| `worktree-cleanup/` | Safe DeFi worktree cleanup script and weekly systemd user timer | Modifying cleanup eligibility, deployment, or scheduling |
