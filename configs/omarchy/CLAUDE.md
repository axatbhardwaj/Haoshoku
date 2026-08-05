# configs/omarchy/

Haoshoku manages `monitors.conf` plus the additive `workspaces.conf` behavior
overlay. Omarchy remains the owner of appearance and core defaults. Do not add
theme, wallpaper, Waybar, Walker, terminal, lock-screen, animation, decoration,
or other visual settings here, and do not unbind Omarchy shortcuts.

The sole appearance carve-out is **`hooks/theme-set.d/`**: its post-processing
hooks run AFTER Omarchy sets a theme. They do not author Omarchy appearance;
they adjust downstream artifacts that Omarchy generates.
