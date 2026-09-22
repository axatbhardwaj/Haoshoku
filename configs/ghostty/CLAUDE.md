# configs/ghostty/

Ghostty is the primary terminal. `configureGhostty()` deploys `config` and
selects `com.mitchellh.ghostty.desktop` for `xdg-terminal-exec`.

## Files

| File     | What                                                                 | When to read                                    |
| -------- | -------------------------------------------------------------------- | ----------------------------------------------- |
| `config` | Primary deployed terminal config. It includes the generated Omarchy Ghostty theme, which owns colours. | Changing terminal font, padding, theme integration, opacity, decorations, or keybinds |

## Theme precedence

`config` includes `~/.local/state/omarchy/current/theme/ghostty.conf`
(optionally, so first login before a theme set still starts), so Ghostty
follows every Omarchy theme switch. The generated theme owns colours only, so
the base config owns background opacity (0.70, matching the former Kitty
setup), font, padding, decorations, and keybinds.

`~/.config/fish/config.fish` applies `~/.local/state/caelestia/sequences.txt`
only when the generated Omarchy Ghostty theme is unavailable. Those OSC
sequences would otherwise overwrite the palette Ghostty loaded from the
active theme.

## Splits

Ghostty has no Kitty-style session files. The Haki and agents top/bottom
splits live in `configs/scripts/haoshoku-special-workspace` as tmux
one-liners (`ensure_ghostty`), using the GTK-valid `com.haoshoku.haki` and
`com.haoshoku.agents` window classes while keeping the `haoshoku-haki` and
`haoshoku-agents` tmux session names.

## Notes

- `config` is deployed automatically by `configureGhostty()`.
