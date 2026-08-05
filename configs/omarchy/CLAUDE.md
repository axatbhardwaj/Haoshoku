# configs/omarchy/

Haoshoku manages `monitors.conf` plus the additive `workspaces.conf` behavior
overlay. Omarchy remains the owner of appearance and core defaults. Do not add
theme, wallpaper, Waybar, Walker, terminal, lock-screen, animation, decoration,
or other visual settings here. Defaults MAY be displaced when a two-key toggle
needs the slot, but every `unbind` must relocate the default faithfully to
`SUPER CTRL SHIFT` plus the same key and be recorded in
`keybinding-swaps.json`.

The sole appearance carve-out is **`hooks/theme-set.d/`**: its post-processing
hooks run AFTER Omarchy sets a theme. They do not author Omarchy appearance;
they adjust downstream artifacts that Omarchy generates.
