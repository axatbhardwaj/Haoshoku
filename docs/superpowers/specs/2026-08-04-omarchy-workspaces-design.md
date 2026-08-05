# Omarchy Workspace Port Design

> **Superseded — original design from 2026-08-04.** This record preserves the
> initial workspace-port decisions. The shortcut ownership and namespace claims
> marked below were superseded by the two-key migration and the X workspace
> toggle; current behavior lives in `configs/omarchy/workspaces.conf`, while
> refresh-safe app bindings live in `configs/omarchy/bindings.conf`.

## Goal

Restore the user's complete Haoshoku/Caelestia-era workspace layout on Omarchy using only user-owned Hyprland configuration and small portable helpers. Preserve Omarchy's defaults, shortcuts, themes, and update path.

## Recovered Source

The port is based on `configs/caelestia/hypr-user-pc.conf` from Haoshoku releases `v6.0.0` through `v7.0.0`. Those releases carry the same relevant three-monitor workspace model and app routing. Caelestia-specific commands and visual settings are not carried forward.

## Omarchy Ownership

Haoshoku will store the portable overlay as `configs/omarchy/workspaces.conf` and deploy it to `~/.config/hypr/haoshoku-workspaces.conf`. It will add one idempotent source statement to the end of the user-owned `~/.config/hypr/hyprland.conf`:

```ini
source = ~/.config/hypr/haoshoku-workspaces.conf
```

Haoshoku will not modify anything beneath `~/.local/share/omarchy/`. It will not modify Omarchy themes, look-and-feel, Waybar, Walker, terminals, lock screen, or wallpaper configuration. A differing existing Haoshoku overlay will receive a timestamped backup before replacement.

## Numbered Workspace Layout

The existing monitor names and physical layout are retained:

- workspaces `1`, `2`, and `3` are persistent on center monitor `DP-1`;
- workspaces `4` and `5` are persistent on right monitor `HDMI-A-1`;
- workspaces `6`, `7`, and `10` are persistent on portrait monitor `DP-2`;
- workspace `1` is the center default, workspace `5` the right default, and workspace `10` the portrait default.

Omarchy's standard numbered workspace behavior remains intact. The user overlay will override only `Super+2`, `Super+4`, `Super+5`, and `Super+0` with compatible supersets: switch to the same numbered workspace, then launch the mapped application only when it is absent.

The application mapping is:

| Workspace | Monitor | Applications |
| --- | --- | --- |
| `2` | `DP-1` | Steam |
| `4` | `HDMI-A-1` | Discord |
| `5` | `HDMI-A-1` | Teams and Telegram |
| `10` (`Super+0`) | `DP-2` | Notion web app through Omarchy's Chromium web-app launcher |

Window rules silently route the mapped applications when they are launched through any path. Exact classes will cover the installed Arch/Omarchy variants without broad patterns that capture game windows or unrelated Chromium windows.

## Special Workspaces and Shortcuts

~~All restored special-workspace bindings use the conflict-free `Super+Ctrl+Shift` namespace. No existing Omarchy binding is unbound.~~ This was the original 2026-08-04 design. The current two-key layout displaces documented Omarchy defaults, and `Super+Shift+X` is explicitly unbound from the app-binding layer because the X special-workspace toggle supersedes that launcher.

| Shortcut | Special workspace | Behavior |
| --- | --- | --- |
| `Super+Ctrl+Shift+A` | `agents` | Toggle or launch a dedicated Kitty Claude agents terminal |
| `Super+Ctrl+Shift+I` | `claude-desktop` | Toggle or launch Claude Desktop on `DP-2` |
| `Super+Ctrl+Shift+M` | `music` | Toggle or launch Spotify |
| `Super+Ctrl+Shift+O` | `1password` | Toggle or launch 1Password |
| `Super+Ctrl+Shift+G` | `communication` | Toggle or launch Signal and WhatsApp on `HDMI-A-1` |
| `Super+Ctrl+Shift+B` | `browser-flux` | Toggle or launch isolated Chromium Flux/personal profile |
| `Super+Ctrl+Shift+D` | `browser-defi` | Toggle or launch isolated Chromium DeFi/work profile |
| `Super+Ctrl+Shift+H` | `stash` | Toggle the general scratch workspace |
| `Super+Ctrl+Shift+Alt+H` | `stash` | Move the active window silently into the stash |

~~The existing Omarchy shortcuts—including `Super+B`, `Super+O`, `Super+D`, and `Super+Shift+M`—remain unchanged.~~ The current layout relocates displaced defaults where their behavior remains useful and records the non-relocated X launcher as superseded in `configs/omarchy/keybinding-swaps.json`.

## Hyprland-Native Toggle Helper

A single Bash helper deployed to `~/.local/bin/haoshoku-special-workspace` will replace Caelestia toggle commands. It receives a known workspace recipe name, rejects unknown names, and uses `hyprctl` plus `jq` to:

1. detect whether the named special workspace is currently visible;
2. hide it when visible;
3. show it when a matching window already exists there;
4. otherwise focus the intended monitor, open the special workspace, and launch the configured command through `uwsm-app` or an Omarchy launcher.

Recipe definitions remain fixed in the script rather than accepting arbitrary shell commands. This keeps quoting predictable and prevents the user-facing binding from becoming a shell-injection interface.

Communication may contain both Signal and WhatsApp. Its first launch starts missing members without duplicating running windows. The agents recipe launches Kitty with class `kitty-agents`, title `agents`, and Bash running the existing Claude resume command.

## Isolated Chromium Profiles

The two restored browser workspaces use Chromium only and do not depend on Brave or Caelestia:

- Flux/personal uses `~/.config/chromium-haoshoku/flux` and Wayland class `chromium-flux`;
- DeFi/work uses `~/.config/chromium-haoshoku/defi` and Wayland class `chromium-defi`.

Each command uses its own `--user-data-dir` and `--class`, producing deterministic Hyprland matching and complete separation of cookies, extensions, history, sessions, and logins. Omarchy's system Chromium policies and theming still apply. Ordinary Omarchy Chromium continues using `~/.config/chromium` and its existing browser shortcuts.

The Flux and DeFi helpers open normal browser windows, not app-mode windows, and do not hardcode a starting website beyond Chromium's own restored/new-tab behavior.

## Deployment and Integration

A focused helper will deploy the overlay and special-workspace script, then ensure the source statement exists exactly once. It will be invoked only when Omarchy is detected during the Arch setup, after the monitor file has been restored.

Deployment is idempotent. Existing unrelated lines in `hyprland.conf` remain byte-for-byte unchanged. A missing `hyprland.conf` is treated as an error because generating a replacement would assume ownership of Omarchy's main user configuration.

When Hyprland is active, deployment runs `hyprctl reload` followed by `hyprctl configerrors`. Outside a Hyprland session, validation is deferred with a clear message.

## Error Handling

- Unknown special-workspace recipes fail without running a command.
- A missing required executable produces a desktop notification and a nonzero exit without disrupting Hyprland.
- Optional applications may be absent immediately after installation; their shortcuts become functional once the packages are installed.
- Chromium profile directories are created naturally by Chromium and never copied, backed up, or deleted by Haoshoku.
- Workspace deployment failures are reported but must not trigger changes to Omarchy-owned defaults.

## Testing

Automated tests will cover:

- exact workspace-to-monitor declarations and default/persistent flags;
- exact application routing without broad Steam or Chromium matches;
- registry coverage for every relocated or superseded Omarchy shortcut;
- cross-file duplicate detection across the app-binding and workspace overlays;
- source-line insertion exactly once while preserving existing `hyprland.conf` bytes;
- timestamped overlay backup and idempotent redeployment;
- known-recipe dispatch and unknown-recipe rejection in the special-workspace helper;
- launch-if-missing behavior without duplicate applications;
- isolated Chromium directories and distinct `chromium-flux` / `chromium-defi` classes;
- absence of `caelestia`, Brave profile commands, and visual/theme mutations;
- active-session reload/config-error validation and deferred offline validation;
- the full existing Bun suite.

## Success Criteria

After a fresh Omarchy install and Haoshoku run, the three-monitor numbered layout and former Caelestia special-workspace workflow are available through Omarchy-native Hyprland configuration. ~~Omarchy's existing shortcuts and appearance continue to work unchanged~~ Omarchy's appearance remains unchanged, while shortcut displacements are explicitly relocated or superseded; Flux and DeFi Chromium sessions remain isolated, and repeated Haoshoku runs do not duplicate sources or destroy user edits without backups.
