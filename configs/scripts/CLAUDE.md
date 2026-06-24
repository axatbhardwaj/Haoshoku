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
| `primevideo-setup` | Idempotent helper that builds the "Prime Video HD" bottle (Windows Brave 1.91 + Wine-TkG 10.8 via Bottles → 1080p fullscreen Prime Video; native Linux Brave is capped at 540p). Fetches the Kron4ek TkG runner, installs Brave, sets the bottle runner + win10, and generates the `primevideo-hd` launcher. Stops with clear instructions at the two non-scriptable steps: GUI bottle creation (Bottles' component bootstrap) and Amazon sign-in. Pairs with the caelestia `Super+Shift+P` / `special:primevideo` config (PC variant). | Changing the Prime Video bottle setup, runner/Brave versions, or launch flags |
| `zee5-hd` | Native Brave app-mode launcher for ZEE5. Uses an isolated `~/.local/share/zee5-brave-profile` seeded from the native Default Brave profile, exposes localhost CDP, and runs a Bun/Node selector loop that chooses `Full HD - 1080p` whenever ZEE5 resets quality. Pairs with `Super+Shift+Z` / `special:zee5` on the PC variant. | Changing ZEE5 playback, login/profile isolation, or Full HD auto-selection |

## Conventions

- Each file is `chmod 755` after deploy.
- Files starting with `.` are skipped (so e.g. a `.gitkeep` won't get installed).
- A script that shadows a system binary should always `exec` (or fall through to)
  the absolute system path so users who explicitly invoke `/usr/bin/X` get the
  unmodified original.
