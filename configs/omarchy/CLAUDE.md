# configs/omarchy/

Haoshoku manages device-specific `monitors-*.conf` plus additive `workspaces-*.conf` behavior
overlay. Omarchy remains the owner of appearance and core defaults. Do not add
theme, wallpaper, Waybar, Walker, terminal, lock-screen, animation, decoration,
or other visual settings here. Defaults MAY be displaced when a two-key toggle
needs the slot, but every `unbind` must relocate the default faithfully to
`SUPER CTRL SHIFT` plus the same key and be recorded in
`keybinding-swaps.json`.

When an owner explicitly moves a dispatcher to a different key while leaving
the displaced slot vacant, record `reason: "relocated_to_different_key"` with
the complete `moved_to`, `moved_to_dispatcher`, and `moved_to_arg` fields. The
registry must therefore let a reader trace the vacated stock key directly to
the live destination. This exception applies only to a deliberate cross-key
relocation; it is not the service-scrub form below.

When the user asks for a service to be scrubbed from the repository, its swap
keeps the stock dispatcher but records `<removed>` for `previous_binding`'s
argument and `moved_from_arg`, with `previous_binding_redacted: true`. The
original stock line remains recoverable from Omarchy's installed
`~/.local/share/omarchy/config/hypr/bindings.conf`; only the service argument
is redacted, never the dispatcher. A relocation in `bindings.conf` claimed by
both `workspaces-*.conf` variants, such as `SUPER, F`, uses
`displaced_by_workspace_toggle` instead.

The window classes matched by `workspaces-*.conf`—`chromium-flux` and
`chromium-defi`—are coupled to the registry defaults and, for `chromium-flux`,
to hardcoded launcher literals. Separately, the `special:browser-flux` and
`special:browser-defi` workspace targets are coupled to registry profile `.id`
values, which `haoshoku-special-workspace` expands as `browser-$profile`. See
the `configs/scripts/CLAUDE.md` convention; rename neither from this side
alone.

Browser web-app rules use the classes derived from Brave Origin, including
`brave-www.notion.so__-Default`, `brave-x.com__-Default`,
`brave-youtube.com__-Default`, `brave-www.crunchyroll.com__-Default`,
`brave-www.jiohotstar.com__-Default`, `brave-reanime.to__home-Default`,
`brave-chatgpt.com__-Default`, and `brave-web.whatsapp.com__-Default`; do not
revert them to the old Chromium-derived prefix.
The profile classes `chromium-flux` and `chromium-defi` are intentionally
retained unchanged even though the browser is now Brave Origin. They are
opaque Wayland class strings, not brand labels: Brave Origin launched with
`--class=chromium-flux` or `--class=chromium-defi` stamps that exact string as
its window class, identically to Chromium. Keeping those literal strings
avoids a registry migration that could risk a duplicate-class validation
hazard, so future maintainers must not “fix” the apparent naming mismatch or
break the matching windowrules.

Workspace 7 uses the `haoshoku-special-workspace numbered 7 warp` recipe.
Exact-address tags, not Warp's shared class, identify its owned window;
`exec-once` and the post-reload helper call use `numbered-login 7 warp`.
Never add a broad `dev.warp.Warp` placement rule. `SUPER+Return` and `SUPER+T`
remain Omarchy's `xdg-terminal-exec` routes, whose XDG default is Warp.

One appearance carve-out is **`hooks/theme-set.d/`**: its post-processing
hooks run AFTER Omarchy sets a theme. They do not author Omarchy appearance;
they adjust downstream artifacts that Omarchy generates.

A second, narrow appearance carve-out permits per-profile browser border
colours in both `workspaces-*.conf` variants, but only when the rule matches the exact
Haoshoku-owned `chromium-flux` or `chromium-defi` class. Those opaque classes
are registry/launcher contracts that no Omarchy theme or other component can
know. This permits only profile-identifying `border_color` window rules; it does
not permit theme, wallpaper, decoration, opacity, blur, or general visual
settings in this overlay.
