# configs/

Template configuration files copied to user's `~/.config/` during setup.

## Files

| File                  | What                          | When to read                              |
| --------------------- | ----------------------------- | ----------------------------------------- |
| `kde_shortcuts.kksrc` | KDE keyboard shortcuts        | Modifying KDE shortcuts                   |

## Subdirectories

| Directory       | What                                | When to read                              |
| --------------- | ----------------------------------- | ----------------------------------------- |
| `agent-os/`     | Pinned Agent OS revision and customized `shape-spec` command | Updating the Agent OS pin or planning workflow |
| `alacritty/`    | Alacritty terminal config           | Modifying Alacritty settings              |
| `kitty/`        | Primary terminal config and Haki/agents split sessions | Modifying terminal settings or split sessions |
| `ghostty/`      | Retained legacy Ghostty config; installed but no longer deployed or wired to keybinds | Reviewing the former Ghostty setup |
| `fastfetch/`    | Fastfetch system info config        | Modifying system info display             |
| `fish/`         | Fish shell config                   | Modifying shell behavior, aliases         |
| `bash/`         | Portable interactive Bash additions loaded after Omarchy defaults | Modifying Bash initializers, aliases, or PATH additions |
| `warp/`         | Retained dormant Warp tab configs and shipped Elysian theme | Reviewing the former Warp setup |
| `vencord/`      | Vencord Discord theme               | Modifying Discord appearance              |
| `claude/`       | Claude Code personal config (copied)    | Modifying settings, backup/restore        |
| `claude-remote-control/` | Claude Remote Control tmux supervisor + systemd user-unit template | Modifying persistent Claude sessions, restart behavior, or attach lifecycle |
| `claude-stay-awake/` | Claude CLI sleep-inhibitor watcher and systemd user unit | Modifying suspend blocking or session detection |
| `codex/`        | Codex compatibility guidance template | Modifying deployed Codex agent guidance   |
| `hyprmoncfg/`   | Authored monitor/workspace profile JSON consumed by hyprmoncfg; Haoshoku NEVER writes generated `monitors.lua` | Modifying monitor layouts or monitor-bound workspace rules without crossing the hyprmoncfg ownership boundary |
| `kde/`          | KDE Ocean theme bundle (5 components)   | Modifying KDE theme deployment            |
| `kwin/`         | KWin script placing KDE Activity windows on outputs by connector name | Modifying activity-window output placement |
| `zed/`          | Zed editor config (sanitized backup)    | Modifying Zed settings, themes            |
| `audio/`        | PipeWire/WirePlumber drop-in configs (portable PipeWire + device-routed WirePlumber variants; PC has the lossless headset rule) | Modifying audio config, adding device-specific WirePlumber rules |
| `mimeapps/`     | XDG default-application associations (`mimeapps.list`) — fully portable, no device routing | Changing default apps for MIME types or URI scheme handlers |
| `omarchy/`      | Omarchy 4 Hyprland Lua overlays and keybinding-swap registry | Read `omarchy/CLAUDE.md` before changing overlays, require wiring, keybindings, or ownership boundaries |
| `pr-watch/`     | Bun PR-readiness watcher and executable wrapper | Modifying PR polling, event detection, or watcher runtime |
| `scripts/`      | Executable shell wrappers deployed to `~/.local/bin/` | Adding PATH-shadow wrappers, game-launch hooks |
| `worktree-cleanup/` | Safe DeFi worktree cleanup script and weekly systemd user timer | Modifying cleanup eligibility, deployment, or scheduling |
