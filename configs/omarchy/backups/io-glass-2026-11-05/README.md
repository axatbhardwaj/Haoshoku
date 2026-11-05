# io glass appearance — 2026-11-05

User-approved Ghostty appearance captured in Haoshoku. T3 uses a readability-focused
92% compositor opacity; Ghostty keeps its 70% native background with solid text.
The live Ghostty config already matches `configs/ghostty/config`.

This is a manual restore snapshot, not an installer change or a fleet deployment.
It includes the active Aurora palette, shell styling, wallpaper, generated
Ghostty theme, personal window rules, glass toggles, and bar configuration.
SHA-256 values in manifest.json bind every archived file.

## Restore on io

1. Extract `appearance.tar.gz` into a temporary directory; inspect the files.
2. Back up the current files before copying the `.config` and `.local/state`
   files into the corresponding paths under your home. Merge looknfeel.lua if
   newer personal rules exist. These paths belong to the user, not /usr/share.
3. Merge only the `bar` key from bar.json into ~/.config/omarchy/shell.json;
   preserve all other shell settings.
4. Select the captured Aurora wallpaper if its background symlink has changed.
5. Run `omarchy hyprland window transparency glassy`, then
   `omarchy bar background glassy`, `hyprctl reload`, and `hyprctl configerrors`.
6. Reload Ghostty configuration. Check its background and T3 visually.

The snapshot was hash-checked against the live files. A destructive full restore
was not performed. Reapplying a theme can replace generated theme files.
