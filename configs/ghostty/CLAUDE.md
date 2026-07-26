# configs/ghostty/

Ghostty is the primary terminal: `Super+T`, Caelestia's `apps.terminal`, the
`Super+A` agents window, and the workspace-7 helper all launch it.

## Files

| File                | What                                                                 | When to read                                    |
| ------------------- | -------------------------------------------------------------------- | ----------------------------------------------- |
| `config.ghostty`    | The live config, deployed to `~/.config/ghostty/config.ghostty` by `configureTerminals()` in `src/os_scripts/cachyos.js`. Colours mirror the Zed Caelestia theme; opacity matches its `background` alpha. | Changing terminal colours, font, padding, keybinds |
| `gen-sequences.py`  | Maintenance tool, **not deployed**. Rewrites `~/.local/state/caelestia/sequences.txt` from the Zed theme. | Re-syncing the OSC palette after a Caelestia scheme change |

## Why the OSC palette matters

`~/.config/fish/config.fish` cats `~/.local/state/caelestia/sequences.txt` at
every shell start. Those OSC 4/10/11/12/17 sequences overwrite whatever palette
the terminal loaded from its own config, so `sequences.txt` — not
`config.ghostty` — decides what you actually see in an interactive shell. The
config values are the pre-shell baseline (and what you get under a shell that
does not source fish's config).

## The two-palette trap

Caelestia derives two different palettes from one wallpaper scheme:

- `term0`–`term15` → `sequences.txt`, via `gen_sequences()` in
  `caelestia/utils/theme.py`
- Catppuccin-named roles (`red`, `green`, `mauve`, `teal`, `sky`, …) → the Zed
  theme, via `caelestia/data/templates/zed.json`

All sixteen ANSI entries differ between them; background, foreground, cursor
and selection agree. That is why the terminals and Zed looked different despite
both being "Caelestia". `gen-sequences.py` resolves it toward Zed.

Two collisions come with Zed's set, because its template maps ANSI slots onto
UI roles:

- `terminal.ansi.black` = `surface` = the window background. `gen-sequences.py`
  and `config.ghostty` both override index 0 back to Caelestia's `term0`
  (`#343434`) — otherwise anything printed with SGR 30 is invisible.
- `terminal.ansi.white` and `bright_white` are both `onSurface`, so bright white
  is not brighter. Left as-is; nothing becomes unreadable.

## Notes

- Blur is Hyprland's, not Ghostty's. `hypr/hyprland/decoration.conf` blurs
  globally with `ignore_opacity`, and `rules.conf` layers a `0.95` window
  opacity on top. `background-blur` in `config.ghostty` is the KDE/GTK path and
  is inert here, so it stays off.
- `caelestia scheme set ...` regenerates `sequences.txt` from `term0`–`term15`
  and undoes `gen-sequences.py`. Re-run the script after changing schemes.
- Ghostty reads `config.ghostty` as well as the extensionless `config`. Only the
  former is used here.
