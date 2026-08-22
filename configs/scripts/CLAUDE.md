# configs/scripts/

Executable user scripts deployed to `~/.local/bin/` by `installUserScripts()`
during the CachyOS setup flow. The destination precedes `/usr/bin/` in PATH on
systemd-user-session setups, so any file here whose basename matches a system
binary acts as a PATH-shadow wrapper for that binary.

## Files

| File | What | When to read |
| ---- | ---- | ------------ |
| `haoshoku-browser` | Routes URLs to the most recently focused managed browser profile, falling back to the configured default. | Changing browser dispatch or focused-profile selection |
| `haoshoku-chromium-flux` | Launches Brave Origin on the isolated Flux profile and preserves that profile through Omarchy web-app launch parsing. | Changing the Flux profile, wrapper name, or paired desktop entry |
| `haoshoku-chromium-profiles` | Validates and queries the configured browser profile registry, with portable Flux and DeFi fallbacks. | Changing registry validation, defaults, or profile lookup |
| `haoshoku-gaming-workspace` | Toggles gaming workspace 2 and wraps Steam launches to place process-tree windows there. | Changing gaming workspace focus, process matching, placement, or launch wrapping |
| `haoshoku-special-workspace` | Implements numbered-app launchers including T3 Code, exact-class Kitty ownership for workspace 7/Haki/agents, native desktop assistant management, and focus/show/hide behavior for named app and browser special workspaces including Twitch. | Changing workspace recipes, placement, reclaim/launch-if-missing behavior, or browser toggles |
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
  Workspace 7 is owned by `haoshoku-special-workspace numbered 7 kitty`; its
  dedicated `haoshoku-ws7` class lets the helper reclaim only that window if it
  moves. The `haki` and `agents` recipes use their own Kitty classes and split
  session files under `~/.config/kitty/`.
- A managed browser profile `.monitor` remains required for registry schema stability,
  but browser workspaces normally follow the focused monitor instead of that
  value. It is used only as a fallback when Hyprland transiently reports no
  focused monitor.
- A managed browser profile `.class` is effectively fixed, despite the registry
  accepting any value. Every command that can start the Flux profile's
  Brave Origin singleton owner must pass `--class=chromium-flux`; otherwise the
  owner stamps the default class onto later plain windows, the workspace class
  probe misses them, and each `Super+B` press opens another window.
  `tests/flux_integration.test.js` derives the literal Flux-profile launch
  sites from source and enforces this invariant. From this directory, inspect
  the sites with:

  ```bash
  grep -RIn --exclude='CLAUDE.md' -- 'brave-haoshoku/flux' .
  ```

- Profile window-class decision: retain `chromium-flux` and `chromium-defi`
  unchanged even though the browser is now Brave Origin. These are opaque
  Wayland class strings, not brand labels. Brave Origin launched with
  `--class=chromium-flux` or `--class=chromium-defi` stamps that exact string
  as its window class, identically to how Chromium did. Keeping the existing
  literal class strings avoids a registry migration that could trigger a
  duplicate-class validation hazard. Future maintainers must not “correct”
  this apparent naming mismatch: the existing strings are intentional and
  both `configs/omarchy/workspaces-*.conf` variants depend on them.

  Keep the `chromium-flux` and `chromium-defi` windowrules in
  both `configs/omarchy/workspaces-*.conf` variants; they are deployed byte-for-byte, without
  templating, by `src/helpers/configure_omarchy_workspaces.js`.
  `FALLBACK_PROFILES` in `configs/scripts/haoshoku-chromium-profiles` covers
  the no-registry case. `DEFAULT_CHROMIUM_PROFILES` in
  `src/helpers/configure_chromium_profiles.js` seeds the registry on first
  run. They are not interchangeable. An already-seeded valid
  `~/.haoshoku.json` is never migrated because `configureChromiumProfiles`
  returns early with `{ changed: false }`. A class rename therefore needs an
  explicit registry migration; changing either default alone does not affect
  existing installs. Registry-emitted windowrules for custom `.class` values
  were considered and deliberately deferred.
