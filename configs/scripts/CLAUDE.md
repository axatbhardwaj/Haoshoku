# configs/scripts/

Executable user scripts deployed to `~/.local/bin/` by `installUserScripts()`
during the CachyOS setup flow. The destination precedes `/usr/bin/` in PATH on
systemd-user-session setups, so any file here whose basename matches a system
binary acts as a PATH-shadow wrapper for that binary.

## Files

| File | What | When to read |
| ---- | ---- | ------------ |
| `haoshoku-browser` | Routes URLs to the most recently focused managed Chromium profile, falling back to the configured default. | Changing browser dispatch or focused-profile selection |
| `haoshoku-chromium-flux` | Launches Chromium on the isolated Flux profile and preserves that profile through Omarchy web-app launch parsing. | Changing the Flux profile, wrapper name, or paired desktop entry |
| `haoshoku-chromium-profiles` | Validates and queries the configured Chromium profile registry, with portable Flux and DeFi fallbacks. | Changing registry validation, defaults, or profile lookup |
| `haoshoku-special-workspace` | Implements numbered-app launchers and focus/show/hide behavior for named app and browser special workspaces. | Changing workspace recipes, placement, launch-if-missing behavior, or browser toggles |
| `haoshoku-zed-glass` | Post-processes Omazed's generated Zed theme with dotted `background.appearance`, alpha-adjusted surfaces, and neutral borders. | Changing Zed transparency, Omazed hooks, or protected theme surfaces |
| `mic-toggle` | Toggles the default microphone through `wpctl` or `pactl` and reports the resulting state. | Changing microphone controls or notifications |

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
  cleaned from `~/.local/bin/`; `Super+I` now routes through
  `haoshoku-special-workspace`.
- Retired workspace-7 helpers are cleaned from `~/.local/bin/`. Warp itself is
  still installed and still has its `configs/warp/` tab config; nothing
  launches it from a keybind any more.
- Chromium profile `.monitor` remains required for registry schema stability,
  but browser workspaces normally follow the focused monitor instead of that
  value. It is used only as a fallback when Hyprland transiently reports no
  focused monitor.
- A Chromium profile `.class` is effectively fixed, despite the registry
  accepting any value. Every command that can start the Flux profile's
  Chromium singleton owner must pass `--class=chromium-flux`; otherwise the
  owner stamps the default class onto later plain windows, the workspace class
  probe misses them, and each `Super+B` press opens another window.
  `tests/flux_integration.test.js` derives the literal Flux-profile launch
  sites from source and enforces this invariant. From this directory, inspect
  the sites with:

  ```bash
  grep -RIn --exclude='CLAUDE.md' -- 'chromium-haoshoku/flux' .
  ```

  Keep the `chromium-flux` and `chromium-defi` windowrules in
  `configs/omarchy/workspaces.conf`; they are deployed byte-for-byte, without
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
