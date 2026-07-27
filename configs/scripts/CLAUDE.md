# configs/scripts/

Executable user scripts deployed to `~/.local/bin/` by `installUserScripts()`
during the CachyOS setup flow. The destination precedes `/usr/bin/` in PATH on
systemd-user-session setups, so any file here whose basename matches a system
binary acts as a PATH-shadow wrapper for that binary.

## Files

| File              | What                                                    | When to read                                         |
| ----------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| `game-performance` | PATH shadow of `/usr/bin/game-performance` (cachyos-settings). Toggles DP-1 VRR on with a targeted runtime monitor keyword + Caelestia gameMode on for the game's lifetime; reverts on normal exit/termination via trap without a full Hyprland reload. Exposes `--reset` for Hyprland startup to clear crash-stale VRR state. Calls the real cachyos-settings script after setup. | Adding more game-launch hooks (FPS overlays, env vars, etc.) or porting to a different monitor layout |
| `agents-toggle`   | Super+A handler for the kitty Claude agents window (single pane). If `special:agents` already holds a window, toggles its visibility; else reclaims a stray one, or spawns `kitty --class=kitty-agents fish -C 'claude -r io'`. A matching `windowrule` in `hypr-user-*.conf` pins the dedicated class; the wait-and-move loop is a fallback. | Changing the agents launch/placement or Super+A behavior |
| `caelestia-restart` | Super+Shift+Delete recovery helper for the Caelestia quickshell process. Serializes stop/start with a non-blocking fd lock, closed (`9>&-`) across every child so the daemonized shell cannot inherit it and hold the lock for the session. Selects instances from `qs list --all` filtered to Caelestia's own `shell.qml`, validates PIDs as unsigned integers (a negative PID is a process-group selector), then escalates cooperative kill → TERM → KILL. Success requires a fresh IPC round-trip *and* that nothing targeted is still alive — a survivor answers IPC just like a new shell. Every socket-facing call is `timeout`-bounded; the IPC wait is a 45s wall-clock deadline against a ~14s warm start. Failures surface through `hyprctl notify` (the notification daemon lives inside the shell being killed, so `notify-send` would block). | Changing Caelestia restart/recovery behavior, its timeouts, or its unlocked shortcut |
| `claude-desktop-toggle` | Super+I handler for the native `claude-desktop` app (pacman `claude-desktop`, class `com.anthropic.Claude`), alone on `special:claude-desktop`. Reclaims or launches the window, moves it onto the workspace, and focuses DP-2. It used to pair Claude with a ChatGPT Brave PWA as a floating top/bottom stack; with one window there is no geometry to compute — Hyprland tiles it and already honours the reserved Caelestia bar and DP-2's portrait transform, so `settiled` is all that remains (it reclaims a window an older stacking version left floating at half height). Cannot be named `claude-desktop` itself: `~/.local/bin/` precedes `/usr/bin/`, so that basename would shadow the real app binary. | Changing the claude-desktop launch, placement, or Super+I behavior |
| `kitty-workspace-7` | Super+7 handler for the plain terminal workspace. Opens workspace 7 and, only if that workspace holds no window in the `kitty` class family (so a Super+T terminal already counts), launches `kitty --class=kitty-workspace-7 --directory=$HOME`. The dedicated class lets the new window be found in one lookup. | Changing the Super+7 terminal workspace behavior |
| `whatsapp-web` | Native Brave app-mode launcher for WhatsApp Web in a dedicated `~/.local/share/whatsapp-brave-profile` (replaces the ZapZap Flatpak; scan the QR once). Routed to `special:communication` by app-id class `brave-web.whatsapp.com__-Default`; opened via `Super+D` (`caelestia toggle communication`), alongside Signal. | Changing the WhatsApp URL, profile, or launch flags |

## Conventions

- Each file is `chmod 755` after deploy.
- Files starting with `.` are skipped (so e.g. a `.gitkeep` won't get installed).
- A script that shadows a system binary should always `exec` (or fall through to)
  the absolute system path so users who explicitly invoke `/usr/bin/X` get the
  unmodified original.
- Retired streaming launchers (`primevideo-*`, `zee5-hd`, `crunchyroll-hd`,
  `jiohotstar-hd`) are intentionally removed and cleaned from `~/.local/bin/`
  by `installUserScripts()`. Do not re-add them without also reintroducing the
  matching Caelestia toggles, desktop entries, and tests.
- Retired AI web-app launcher `ai-webapps-toggle` is intentionally removed and
  cleaned from `~/.local/bin/`; `Super+I` is now owned by `claude-desktop-toggle`.
- Retired workspace-7 helpers are cleaned from `~/.local/bin/`; the active
  helper is `kitty-workspace-7`. Warp itself is still installed and still has
  its `configs/warp/` tab config; nothing launches it from a keybind any more.
