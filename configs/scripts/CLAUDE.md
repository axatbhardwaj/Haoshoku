# configs/scripts/

Executable user scripts deployed to `~/.local/bin/` by `installUserScripts()`
during the CachyOS setup flow. The destination precedes `/usr/bin/` in PATH on
systemd-user-session setups, so any file here whose basename matches a system
binary acts as a PATH-shadow wrapper for that binary.

## Files

| File              | What                                                    | When to read                                         |
| ----------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| `game-performance` | PATH shadow of `/usr/bin/game-performance` (cachyos-settings). Toggles DP-1 VRR on + Caelestia gameMode on for the game's lifetime; reverts on normal exit/termination via trap. Exposes `--reset` for Hyprland startup to clear crash-stale VRR state. Calls the real cachyos-settings script after setup. | Adding more game-launch hooks (FPS overlays, env vars, etc.) or porting to a different monitor layout |
| `agents-toggle`   | Super+A handler for the Warp claude + codex agents split. If `special:agents` already holds a window, toggles its visibility; else reclaims a stray `agents` window, or spawns `warp-terminal warp://tab_config/agents?new_window=true` and **moves the new window onto `special:agents` itself** (address-diff, then reveal). The explicit move is required because Warp is a single multi-window process, so Hyprland's `[workspace special:agents]` execrule only matches when Warp is cold — when it is already running the new window is created under a different PID and the rule misses. | Changing the agents launch/placement or Super+A behavior |
| `ai-webapps-toggle` | Super+I handler for the Claude + ChatGPT Brave PWAs. Reclaims or launches both app-id windows, moves them onto `special:ai-webapps`, focuses DP-2, and floats them as a top/bottom stack that respects Hyprland's reserved left Caelestia bar. | Changing Claude/ChatGPT PWA launch, placement, or Super+I behavior |
| `warp-workspace-7` | Super+7 handler for the plain Warp workspace. Opens workspace 7 and, only if that workspace lacks a Warp window, launches `warp-terminal` from `$HOME` with no tab config/URL/profile, then moves the newly-created warm-Warp window onto workspace 7. | Changing the Super+7 plain Warp workspace behavior |

## Conventions

- Each file is `chmod 755` after deploy.
- Files starting with `.` are skipped (so e.g. a `.gitkeep` won't get installed).
- A script that shadows a system binary should always `exec` (or fall through to)
  the absolute system path so users who explicitly invoke `/usr/bin/X` get the
  unmodified original.
