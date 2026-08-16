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

`kitty.conf` includes `~/.local/state/omarchy/current/theme/kitty.conf`, so Kitty
follows every Omarchy theme switch. The theme file owns colours and opacity;
the base config owns font, padding, blur, decorations, and keybinds.

`~/.config/fish/config.fish` and both split sessions apply
`~/.local/state/caelestia/sequences.txt` only when the active Omarchy Kitty theme
is unavailable. Those OSC 4/10/11/12/17 sequences would otherwise overwrite
the palette Kitty loaded from the active theme.

## Notes

- `kitty.conf` is deployed automatically by `configureKitty()`.
