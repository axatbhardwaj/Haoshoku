# configs/omarchy/

Haoshoku owns the behavior overlays in `haoshoku/*.lua`. Omarchy 4 loads these
modules through explicit `require()` calls after its defaults; do not reintroduce
Omarchy 3 `source =` lines in `hyprland.conf`. The require wiring is maintained by
the Omarchy workspace configurator, not by the overlay modules themselves.

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

Haoshoku NEVER writes `monitors.lua`. Monitor discovery, layout generation, and
monitor-bound workspace rules belong to hyprmoncfg. Haoshoku only feeds
hyprmoncfg through profile JSON. The Lua overlays may contain monitor-independent
behavior, but neither overlay sets `GDK_SCALE`; display scaling belongs to
hyprmoncfg and the monitor profile. The overlays must not set scaling environment
variables: a global `GDK_SCALE` forces every GTK and XWayland client to one fixed
factor regardless of per-monitor scale.

## Shell ownership boundary

Unlike `monitors.lua`, which has an exclusive external owner and Haoshoku never
writes, `shell.json` has NO exclusive owner. Omarchy's own shell process co-writes
it whenever a plugin is enabled or disabled through Omarchy's UI. For bar
widgets, that enablement state lives in `bar.layout`; only non-bar plugins use
the top-level plugin lists. Haoshoku intentionally claims the `bar` key within
`~/.config/omarchy/shell.json` wholesale, including bar-widget enablement, so
disabling a bar widget through Omarchy's UI is reverted on the next deploy. It
preserves every other top-level key, including `idle`, `plugins`,
`disabledPlugins`, `version`, and unknown keys.

The bar deploy and backup commands also own the three runtime files for the
bundled `xzat.tray` plugin under `plugins/xzat.tray/`: `Tray.qml`,
`TrayModel.js`, and `manifest.json`. Deployment copies them to Omarchy's default
user plugin path, `~/.config/omarchy/plugins/xzat.tray/`; do not add this bundled
plugin to the remote plugin manifest.
`TrayModel.js` deliberately stays in the ES5-style dialect accepted by QML and
is excluded from Biome's application-JavaScript rules.

## Window-class and workspace contracts

The window classes matched by `workspaces-*.lua`—`chromium-flux` and
`chromium-defi`—are coupled to the registry defaults and, for `chromium-flux`, to
hardcoded launcher literals. Separately, the `special:browser-flux` and
`special:browser-defi` workspace targets are coupled to registry profile `.id`
values, which `haoshoku-special-workspace` expands as `browser-$profile`. See the
`configs/scripts/CLAUDE.md` convention; rename neither from this side alone.

The profile classes `chromium-flux` and `chromium-defi` are intentionally retained
unchanged even though the browser is now Brave Origin. They are opaque Wayland
class strings, not brand labels: Brave Origin launched with
`--class=chromium-flux` or `--class=chromium-defi` stamps that exact string as its
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

Workspace 2 is the gaming workspace. Steam and Omakade both match exact classes
(`steam` / `Steam`, and `io.github.tsouth89.Omakade`) and land on `2 silent`.
Steam also sets `tile = true` so it overrides Omarchy's stock `float = true`
in `$OMARCHY_PATH/default/hypr/apps/steam.lua`; do not drop that effect or
Steam reopens as a centered float. The exact-class match leaves `steam_app_*`
game windows to Omarchy. Login uses `numbered-login 2 steam` and
`numbered-login 2 omakade`; `SUPER+2` uses `numbered 2 omakade`. Do not bind
`numbered 2 steam` to the workspace switch; `SUPER+SHIFT+G` remains the toggle
that ensures Steam.

Workspace 7 uses the `haoshoku-special-workspace numbered 7 kitty` recipe. The
exact `haoshoku-ws7` class identifies its owned window; the startup call and the
post-reload helper use `numbered-login 7 kitty`. Haki and agents use their own
exact Kitty classes and split sessions. `SUPER+Return` remains Omarchy's
`xdg-terminal-exec` route, whose XDG default is Kitty; `SUPER+T` uses
`o.launch_sole("^t3code$", "t3code")`, focusing T3 Code wherever it resides and
launching it on the current workspace only when absent. The assistants recipe runs
at login and on `SUPER+I`, managing ChatGPT and Claude Desktop in `special:assistants`;
Twitch retains its own special workspace.

## Narrow appearance carve-outs

One appearance carve-out is **`hooks/theme-set.d/`**: its post-processing hooks
run AFTER Omarchy sets a theme. They do not author Omarchy appearance; they adjust
downstream artifacts that Omarchy generates.

A second, narrow appearance carve-out permits per-profile browser border colours
in both `workspaces-*.lua` variants, but only when the rule matches the exact
Haoshoku-owned `chromium-flux` or `chromium-defi` class. Those opaque classes are
registry/launcher contracts that no Omarchy theme or other component can know.
This permits only profile-identifying `border_color` window rules; it does not
permit theme, wallpaper, decoration, opacity, blur, or general visual settings in
this overlay.
