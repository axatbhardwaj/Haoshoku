# configs/kitty/

Kitty is the primary terminal. `configureKitty()` deploys `kitty.conf`, the
Haki and agents split sessions, and selects `kitty.desktop` for
`xdg-terminal-exec`.

## Files

| File               | What                                                                 | When to read                                    |
| ------------------ | -------------------------------------------------------------------- | ----------------------------------------------- |
| `kitty.conf`       | Primary deployed terminal config. It includes the active Omarchy Kitty theme, which owns colours and opacity. | Changing terminal font, padding, theme integration, blur, decorations, or keybinds |
| `haki.session`     | Claude-over-Codex top/bottom Haki split | Changing the Haki agent layout or commands |
| `agents.session`   | Claude-over-Codex top/bottom general agents split | Changing the agents layout or commands |
| `gen-sequences.py` | Maintenance tool, **not deployed**. Rewrites `~/.local/state/caelestia/sequences.txt` from the Zed theme. | Re-syncing the OSC palette after a Caelestia scheme change |

## Blur under Hyprland

Hyprland already applies blur globally via `ignore_opacity` in
`hypr/hyprland/decoration.conf`. As with Ghostty's `background-blur`, kitty's
own `background_blur` is therefore likely inert on this compositor.

`background_blur 1` remains because it matches the kitty config verified clean
in practice on this hardware, not because it is known to have any visible
effect. This does not contradict Ghostty's earlier `background-blur = false`
decision: that setting was inert for the same reason, and the two configs simply
made different, equally defensible choices about an inert knob.

## Theme precedence

`kitty.conf` includes `~/.config/omarchy/current/theme/kitty.conf`, so Kitty
follows every Omarchy theme switch. The theme file owns colours and opacity;
the base config owns font, padding, blur, decorations, and keybinds.

`~/.config/fish/config.fish` and both split sessions apply
`~/.local/state/caelestia/sequences.txt` only when the active Omarchy Kitty theme
is unavailable. Those OSC 4/10/11/12/17 sequences would otherwise overwrite
the palette Kitty loaded from the active theme.

The regeneration tool is terminal-agnostic. It lives beside Kitty's retained
fallback config because that is where terminal-theme maintenance is documented,
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
- `kitty.conf` is deployed automatically by `configureKitty()`.
- `gen-sequences.py` is run manually when the fallback OSC values need to be
  reconciled with the Zed theme.
