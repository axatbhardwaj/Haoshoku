# configs/omarchy/

Haoshoku manages `monitors.conf` plus the additive `workspaces.conf` behavior
overlay. Omarchy remains the owner of appearance and core defaults. Do not add
theme, wallpaper, Waybar, Walker, terminal, lock-screen, animation, decoration,
or other visual settings here. Defaults MAY be displaced when a two-key toggle
needs the slot, but every `unbind` must relocate the default faithfully to
`SUPER CTRL SHIFT` plus the same key and be recorded in
`keybinding-swaps.json`.

When the user asks for a service to be scrubbed from the repository, its swap
keeps the stock dispatcher but records `<removed>` for `previous_binding`'s
argument and `moved_from_arg`, with `previous_binding_redacted: true`. The
original stock line remains recoverable from Omarchy's installed
`~/.local/share/omarchy/config/hypr/bindings.conf`; only the service argument
is redacted, never the dispatcher. A relocation in `bindings.conf` claimed by
`workspaces.conf`, such as `SUPER, F`, uses
`displaced_by_workspace_toggle` instead.

The window classes matched by `workspaces.conf`—`chromium-flux` and
`chromium-defi`—are coupled to the registry defaults and, for `chromium-flux`,
to hardcoded launcher literals. Separately, the `special:browser-flux` and
`special:browser-defi` workspace targets are coupled to registry profile `.id`
values, which `haoshoku-special-workspace` expands as `browser-$profile`. See
the `configs/scripts/CLAUDE.md` convention; rename neither from this side
alone.

Workspace 7 is owned by the `haoshoku-ws7` class and the
`haoshoku-special-workspace` numbered kitty recipe. `exec-once` covers fresh
logins; `configure_omarchy_workspaces.js` invokes the same idempotent login
recipe after reload so the installing session is populated immediately. Keep
the dedicated class, windowrule, login recipe, and `SUPER+7` binding aligned.

The sole appearance carve-out is **`hooks/theme-set.d/`**: its post-processing
hooks run AFTER Omarchy sets a theme. They do not author Omarchy appearance;
they adjust downstream artifacts that Omarchy generates.
