# configs/omarchy/

Haoshoku owns the behavior overlays in `haoshoku/*.lua`. Omarchy 4 loads these
modules through explicit `require()` calls after its defaults; do not reintroduce
Omarchy 3 `source =` lines in `hyprland.conf`. The require wiring is maintained by
the Omarchy workspace configurator, not by the overlay modules themselves.
The dictation helper separately deploys `haoshoku/dictation.lua` and appends its
require after personal bindings on io/iobook only. It reclaims unmodified F9
with one generic start/stop hold pair; Superwhisper native hold stays `none`.

Omarchy remains the owner of applying appearance and core defaults.
`appearance.json` may select a public theme revision, a background within that
theme, a font, and exact legacy revisions eligible for recoverable replacement;
the appearance helper must hand those values to Omarchy's own commands rather
than copying generated current-theme state. Do not add theme,
wallpaper, Waybar, Walker, terminal, lock-screen, animation, decoration, or other
visual settings to the Haoshoku Lua overlays. Defaults MAY be displaced when a
two-key toggle needs the slot, but every distinct `hl.unbind()` literal must have
exactly one corresponding `keybinding-swaps.json` entry whose `hl_unbind` value is
the exact call emitted by the Lua. The PC and laptop modules may contain the same
logical unbind while sharing that single registry entry.

`keybinding-swaps.json` remains schema version 2. Preserve this reason taxonomy:

- `displaced_by_workspace_toggle`: a workspace toggle takes the stock key and the
  stock dispatcher is moved to the documented modifier chord.
- `displaced_by_app_launcher`: an application launcher takes the stock key and the
  stock dispatcher is moved to the documented modifier chord.
- `relocated_to_different_key`: the owner deliberately moves a dispatcher to a
  different key while leaving the displaced slot vacant.
- `superseded_by_workspace_toggle`: a workspace toggle wholly replaces the stock
  action rather than relocating it.
- `reclaimed_by_overlay`: the overlay unbinds and then intentionally recreates the
  same user-facing binding.
- `deleted_by_user`: the stock binding is intentionally suppressed without a live
  replacement.

For `relocated_to_different_key`, always record the complete `moved_to`,
`moved_to_dispatcher`, and `moved_to_arg` fields. The registry must let a reader
trace the vacated stock key directly to the live destination. This exception
applies only to a deliberate cross-key relocation; it is not the service-scrub
form below.

When the user asks for a service to be scrubbed from the repository, its swap
keeps the stock dispatcher but records `<removed>` for `previous_binding`'s
argument and `moved_from_arg`, with `previous_binding_redacted: true`. Recover
current Omarchy stock bindings with `omarchy menu keybindings --print`, which
prints tab-separated bindings; only the service argument is redacted, never the
dispatcher. A relocation in `bindings.lua` claimed by both workspace variants,
such as `SUPER + F`, uses `displaced_by_workspace_toggle` instead.

## Monitor ownership boundary

Haoshoku NEVER writes `hyprmoncfg-monitors.lua` or legacy `monitors.lua`.
Monitor discovery and layout generation
belong to hyprmoncfg. Its PC profile
sets workspace planning Off; Omarchy owns workspace numbering and number-key
navigation. Haoshoku only feeds hyprmoncfg through profile JSON. The overlays
never set `GDK_SCALE`; display scaling belongs to
hyprmoncfg and the monitor profile. The overlays must not set scaling environment
variables: a global `GDK_SCALE` forces every GTK and XWayland client to one fixed
factor regardless of per-monitor scale.

The io overlay has one narrow workspace-policy carve-out: Haoshoku owns the
layout preference for io’s left-monitor slots 1, 2, and 3, including its guarded
`SUPER+L` behavior. hyprmoncfg retains sole ownership of monitor discovery,
geometry, transforms, and scaling. Omarchy owns dynamic ten-ID block allocation.
`workspace-monitors-io` maps logical app favorites to physical connectors and
local slots; `workspace_targets.lua` and `haoshoku-workspace-target` consume it
in their native runtimes. Only the explicit hostname io on the PC route selects
this profile and unbinds stock number 6–0 actions. Unknown PC and laptop routes
use ten single-monitor slots, without portrait or three-monitor policies.

## Shell ownership boundary

Unlike generated monitor Lua, which has an exclusive external owner and Haoshoku never
writes, `shell.json` has NO exclusive owner. Omarchy's own shell process co-writes
it whenever a plugin is enabled or disabled through Omarchy's UI. For bar
widgets, that enablement state lives in `bar.layout`; only non-bar plugins use
the top-level plugin lists. Haoshoku intentionally claims the `bar` key within
`~/.config/omarchy/shell.json` wholesale (sourced from `bar.json` here), including bar-widget enablement, so
disabling a bar widget through Omarchy's UI is reverted on the next deploy. It
preserves every other top-level key, including `idle`, `plugins`,
`disabledPlugins`, `version`, and unknown keys.

The default layout uses stock `omarchy.workspaces` and `omarchy.tray`, with
`omarchy.elsewhen` after the clock. Omarchy 4.5 reads drawer controls from
`bar.layout.tray`; stock tray entries need no `embeddedWidgets`.

For layouts that select `xzat.tray`, the bar deploy and backup commands also
own the three runtime files for the bundled plugin under `plugins/xzat.tray/`:
`Tray.qml`, `TrayModel.js`, and `manifest.json`. Deployment copies them to Omarchy's default
user plugin path, `~/.config/omarchy/plugins/xzat.tray/`; do not add this bundled
plugin to the remote plugin manifest.
`TrayModel.js` deliberately stays in the ES5-style dialect accepted by QML and
is excluded from Biome's application-JavaScript rules.

## Window-class and workspace contracts

The window class matched by `workspaces-*.lua`—`chromium-flux`—is coupled to
the registry default and to hardcoded launcher literals. Separately, the
`special:browser-flux` workspace target is coupled to registry profile `.id`
values, which `haoshoku-special-workspace` expands as `browser-$profile`. See the
`configs/scripts/CLAUDE.md` convention; rename neither from this side alone.

The profile class `chromium-flux` is intentionally retained
unchanged even though the browser is now Brave Origin. They are opaque Wayland
class strings, not brand labels: Brave Origin launched with
`--class=chromium-flux` stamps that exact string as its
window class, identically to Chromium. Keeping those literal strings avoids a
registry migration that could risk a duplicate-class validation hazard. Future
maintainers must not “fix” the apparent naming mismatch or break the matching
window rules.

Native assistant rules use the exact classes `com.anthropic.Claude` for Claude
Desktop and `chatgpt` for Codex Desktop.

Browser web-app rules use the classes derived from Brave Origin, including
`brave-www.notion.so__-Default`, `brave-x.com__-Default`,
`brave-youtube.com__-Default`, `brave-www.crunchyroll.com__-Default`,
`brave-www.jiohotstar.com__-Default`, `brave-reanime.to__home-Default`, and
`brave-web.whatsapp.com__-Default`; do not revert them to the old Chromium-derived
prefix.

Logical app favorites use `SUPER+F1/F2/F4/F5/F6/F7/F10`; number navigation
belongs to stock Omarchy. On io, the primary app uses DP-1 slot 1, gaming uses
DP-1 slot 2, Vesktop uses HDMI-A-1 slot 4, Teams/Telegram use HDMI-A-1 slot 5,
and the left monitor uses slots 1 (primary via F6), 2 (Ghostty via F7), and 3
(Notion via F10). `SUPER+CTRL+F1/F2/F3` focus left/center/right monitors.
Other desktop routes retain logical slots 1,2,4,5,6,7,10 on a single monitor.
Missing or ambiguous mappings defer app actions; never guess a numeric block.

Steam matches exact classes `steam` / `Steam`, stays in `special:steam`, and
keeps `tile = true` to override Omarchy’s stock floating rule. Game windows use
the process-tree watcher in `haoshoku-gaming-workspace place`, not class rules.
Toggling out of the gaming workspace returns to the previous workspace. Login
policy still lives in `~/.config/haoshoku/gaming.json`. The owned Ghostty keeps
class `com.haoshoku.ws7` independent of its resolved numeric ID. App routing
resolves through native workspace blocks at window-open time, including after
hotplug; saved global workspace rules must not return. `SUPER+Return` keeps
`xdg-terminal-exec`, and `SUPER+T` still matches `^com\\.t3tools\\.T3Code$`.

The assistants recipe runs
at login and on `SUPER+I`, managing ChatGPT and Claude Desktop in `special:assistants`;
Twitch retains its own special workspace.

## Narrow appearance carve-outs

One appearance carve-out is **`hooks/theme-set.d/`**: its post-processing hooks
run AFTER Omarchy sets a theme. They do not author Omarchy appearance; they adjust
downstream artifacts that Omarchy generates.

A second, narrow appearance carve-out permits per-profile browser border colours
in both `workspaces-*.lua` variants, but only when the rule matches the exact
Haoshoku-owned profile class (currently only `chromium-flux`). Those opaque classes are
registry/launcher contracts that no Omarchy theme or other component can know.
This permits only profile-identifying `border_color` window rules; it does not
permit theme, wallpaper, decoration, opacity, blur, or general visual settings in
this overlay.
