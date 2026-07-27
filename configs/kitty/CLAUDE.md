# configs/kitty/

kitty is the primary terminal: `Super+T`, Caelestia's `apps.terminal`, the
`Super+A` agents window, and the workspace-7 helper all launch it.

## Files

| File               | What                                                                 | When to read                                    |
| ------------------ | -------------------------------------------------------------------- | ----------------------------------------------- |
| `kitty.conf`       | The live config, deployed to `~/.config/kitty/kitty.conf` by `configureTerminals()` in `src/os_scripts/cachyos.js`. It intentionally carries no colours because the shell applies them at runtime. | Changing terminal font, padding, opacity, blur, decorations, or keybinds |
| `gen-sequences.py` | Maintenance tool, **not deployed**. Rewrites `~/.local/state/caelestia/sequences.txt` from the Zed theme. | Re-syncing the OSC palette after a Caelestia scheme change |

## Why the OSC palette matters

`~/.config/fish/config.fish` cats `~/.local/state/caelestia/sequences.txt` at
every shell start. Those OSC 4/10/11/12/17 sequences overwrite whatever palette
the terminal loaded from its own config, so `sequences.txt` decides what an
interactive shell actually displays. `kitty.conf` therefore carries no colour
directives that would only be a temporary pre-shell baseline.

The regeneration tool is terminal-agnostic. It lives beside the primary
terminal config because that is where terminal-theme maintenance is documented,
but it only reads the Zed theme and writes Caelestia's state file.

## The two-palette trap

Caelestia derives two different palettes from one wallpaper scheme:

- `term0`–`term15` → `sequences.txt`, via `gen_sequences()` in
  `caelestia/utils/theme.py`
- Catppuccin-named roles (`red`, `green`, `mauve`, `teal`, `sky`, …) → the Zed
  theme, via `caelestia/data/templates/zed.json`

All sixteen ANSI entries differ between them; background, foreground, cursor
and selection agree. That is why terminals and Zed can look different despite
both being "Caelestia". `gen-sequences.py` resolves the terminal values toward
Zed.

Two collisions come with Zed's set, because its template maps ANSI slots onto
UI roles:

- `terminal.ansi.black` = `surface` = the window background.
  `gen-sequences.py` overrides index 0 back to Caelestia's `term0` (`#343434`);
  otherwise anything printed with SGR 30 is invisible.
- `terminal.ansi.white` and `bright_white` are both `onSurface`, so bright white
  is not brighter. Left as-is; nothing becomes unreadable.

## Notes

- `caelestia scheme set ...` regenerates `sequences.txt` from `term0`–`term15`
  and undoes `gen-sequences.py`. Re-run the script after changing schemes.
- Only `kitty.conf` is deployed. `gen-sequences.py` is run manually when the
  generated OSC values need to be reconciled with the Zed theme.
