# configs/scripts/

Executable user scripts deployed to `~/.local/bin/` by `installUserScripts()`
during the CachyOS setup flow. The destination precedes `/usr/bin/` in PATH on
systemd-user-session setups, so any file here whose basename matches a system
binary acts as a PATH-shadow wrapper for that binary.

## Files

| File | What | When to read |
| ---- | ---- | ------------ |
| `haoshoku-browser` | Routes URLs to the single managed Flux browser profile. | Changing browser dispatch or focused-profile selection |
| `haoshoku-chromium-flux` | Launches Brave Origin on the isolated Flux profile and preserves that profile through Omarchy web-app launch parsing. | Changing the Flux profile, wrapper name, or paired desktop entry |
| `haoshoku-chromium-profiles` | Validates saved registries and exposes only Flux with a fixed class/default, retaining its valid monitor. Other entries remain on disk but cannot launch. | Changing registry validation, defaults, or profile lookup |
| `haoshoku-claude-local` | Resumes the `claudeSessionName` from `~/.haoshoku.json` (validated) or falls back to a fresh `claude`; used by the Haki Ghostty/tmux split. | Changing the Haki Claude launch or session-name validation |
| `haoshoku-default-browser` | Login-time repair that re-points `xdg-settings` and the http/https/html MIME handlers at `haoshoku-browser.desktop`. | Changing default-browser ownership or the repaired MIME set |
| `haoshoku-gaming-workspace` | Toggles physical gaming slot 2 and wraps Steam launches to place process-tree windows there, lifting the kernel split-lock penalty for the launch's lifetime. | Changing gaming workspace focus, process matching, placement, or launch wrapping |
| `haoshoku-workspace-target` | Resolves logical app favorites from the deployed monitor-role TSV, native monitor-workspaces state and connected monitors; fails closed for missing or ambiguous targets. | Changing app target resolution or five-slot io routing |
| `haoshoku-special-workspace` | Implements numbered-app launchers including resolved Omakade/Ghostty slots, exact-class Ghostty ownership for ws7/Haki/agents, native desktop assistant management, and focus/show/hide behavior for named app and browser special workspaces including Twitch. | Changing workspace recipes, placement, reclaim/launch-if-missing behavior, or browser toggles |
| `haoshoku-zed-glass` | Post-processes Omazed's generated Zed theme with dotted `background.appearance`, alpha-adjusted surfaces, and neutral borders. | Changing Zed transparency, Omazed hooks, or protected theme surfaces |
| `mic-toggle` | Toggles the default microphone through `wpctl` or `pactl` and reports the resulting state. | Changing microphone controls or notifications |
| `omarchy-agent-usage-update` | Exposes Omarchy's packaged agent-usage collector at the user-owned path required by Agent Usage Plus. | Changing the managed agent-usage plugin or collector compatibility |

## Conventions

- Each file is `chmod 755` after deploy.
- Files starting with `.` are skipped (so e.g. a `.gitkeep` won't get installed).
- A script that shadows a system binary should always `exec` (or fall through to)
  the absolute system path so users who explicitly invoke `/usr/bin/X` get the
  unmodified original.
- Retired streaming launchers (`primevideo-*`, `zee5-hd`, `crunchyroll-hd`,
  and the old `jiohotstar-hd` Caelestia-toggle launcher) are intentionally
  removed and cleaned from `~/.local/bin/` by `installUserScripts()`. Do not
  re-add those scripts without also reintroducing the matching Caelestia
  toggles, desktop entries, and tests. The old `jiohotstar-hd` launcher remains
  retired; JioHotstar is now available through the unrelated `Super+J` Brave
  webapp special workspace.
- Retired AI web-app launcher `ai-webapps-toggle` is intentionally removed and
  cleaned from `~/.local/bin/`; `Super+I` and the login-time invocation route
  ChatGPT and Claude Desktop through `haoshoku-special-workspace assistants`.
- Retired standalone workspace-7 helpers are cleaned from `~/.local/bin/`.
  The logical Ghostty favorite is owned by `haoshoku-special-workspace numbered 7 ghostty`; its
  dedicated GTK-valid `com.haoshoku.ws7` application ID lets the helper reclaim only that window if it
  moves. Logical slots resolve through `haoshoku-workspace-target` before any dispatch.
  On io, favorite 7 means DP-2 slot 2; elsewhere it remains single-monitor slot 7.
  The interactive numbered recipe focuses the exact owned window after
  switching or reclaiming it and launches one when absent; `numbered-login`
  ensures ownership without stealing focus. The `haki` and `agents` recipes use
  their own Ghostty classes and tmux splits (plus
  `haki-terminal`/`agents-terminal` direct-launch variants for desktop entries).
- A managed browser profile `.monitor` remains required for registry schema stability,
  but browser workspaces normally follow the focused monitor instead of that
  value. It is used only as a fallback when Hyprland transiently reports no
  focused monitor.
- The runtime fixes Flux `.class` to `chromium-flux`, even if the saved registry
  contains a custom class. Every command that can start the Flux profile's
  Brave Origin singleton owner must pass `--class=chromium-flux`; otherwise the
  owner stamps the default class onto later plain windows, the workspace class
  probe misses them, and each `Super+B` press opens another window.
  `tests/flux_integration.test.js` derives the literal Flux-profile launch
  sites from source and enforces this invariant. From this directory, inspect
  the sites with:

  ```bash
  grep -RIn --exclude='CLAUDE.md' -- 'brave-haoshoku/flux' .
  ```

- Profile window-class decision: retain `chromium-flux`
  unchanged even though the browser is now Brave Origin. These are opaque
  Wayland class strings, not brand labels. Brave Origin launched with
  `--class=chromium-flux` stamps that exact string
  as its window class, identically to how Chromium did. Keeping the existing
  literal class strings avoids a registry migration that could trigger a
  duplicate-class validation hazard. Future maintainers must not “correct”
  this apparent naming mismatch: the existing strings are intentional and
  both `configs/omarchy/workspaces-*.conf` variants depend on them.

  Keep the `chromium-flux` windowrules in
  both `configs/omarchy/workspaces-*.conf` variants; they are deployed byte-for-byte, without
  templating, by `src/helpers/configure_omarchy_workspaces.js`.
  `FALLBACK_PROFILES` in `configs/scripts/haoshoku-chromium-profiles` covers
  the no-registry case. `DEFAULT_CHROMIUM_PROFILES` in
  `src/helpers/configure_chromium_profiles.js` seeds the registry on first
  run. Existing valid custom registries remain on disk; runtime queries expose
  only Flux, fixing its id, class and default while retaining a valid Flux monitor.
  Missing or invalid Flux definitions fall back to the shipped entry. Secondary
  IDs are rejected, including entries in a valid custom registry.
