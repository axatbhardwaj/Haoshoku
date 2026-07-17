# configs/scripts/

Executable user scripts deployed to `~/.local/bin/` by `installUserScripts()`
during the CachyOS setup flow. The destination precedes `/usr/bin/` in PATH on
systemd-user-session setups, so any file here whose basename matches a system
binary acts as a PATH-shadow wrapper for that binary.

## Files

| File              | What                                                    | When to read                                         |
| ----------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| `game-performance` | PATH shadow of `/usr/bin/game-performance` (cachyos-settings). Toggles DP-1 VRR on with a targeted runtime monitor keyword + Caelestia gameMode on for the game's lifetime; reverts on normal exit/termination via trap without a full Hyprland reload. Exposes `--reset` for Hyprland startup to clear crash-stale VRR state. Calls the real cachyos-settings script after setup. | Adding more game-launch hooks (FPS overlays, env vars, etc.) or porting to a different monitor layout |
| `agents-toggle`   | Super+A handler for the Warp claude + codex agents split. If `special:agents` already holds a window, toggles its visibility; else reclaims a stray `agents` window, or spawns `warp-terminal warp://tab_config/agents?new_window=true` and **moves the new window onto `special:agents` itself** (address-diff, then reveal). The explicit move is required because Warp is a single multi-window process, so Hyprland's `[workspace special:agents]` execrule only matches when Warp is cold — when it is already running the new window is created under a different PID and the rule misses. | Changing the agents launch/placement or Super+A behavior |
| `claude-desktop-toggle` | Super+I handler for the native `claude-desktop` app (pacman `claude-desktop`, class `com.anthropic.Claude`) alongside the ChatGPT Brave PWA. Reclaims or launches both windows, moves them onto `special:claude-desktop`, focuses DP-2, and floats them as a top/bottom stack (Claude on top) that respects Hyprland's reserved left Caelestia bar. ChatGPT is matched by both Brave's generated app class and the `crx_*` StartupWMClass used after reinstall. Cannot be named `claude-desktop` itself: `~/.local/bin/` precedes `/usr/bin/`, so that basename would shadow the real app binary. Replaced the old `ai-webapps-toggle` (which paired Claude's *Brave PWA* with ChatGPT — Claude is native now). | Changing the claude-desktop / ChatGPT launch, placement, or Super+I behavior |
| `warp-workspace-7` | Super+7 handler for the plain Warp workspace. Opens workspace 7 and, only if that workspace lacks a Warp window, launches `warp-terminal` from `$HOME` with no tab config/URL/profile, then moves the newly-created warm-Warp window onto workspace 7. | Changing the Super+7 plain Warp workspace behavior |
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
