# configs/caelestia/

Caelestia personal preferences (user-side overrides sourced last by Caelestia).

## Files

| File             | What                                                           | When to read                                                  |
| ---------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| `hypr-user.conf` | Hyprland overrides: monitors, workspace pins, keybind rebinds  | Changing monitor layout, pinning a workspace, rebinding a chord |
| `cli.json`       | Caelestia CLI overrides for `caelestia toggle <ws>`            | Adding/removing special-workspace toggle apps                 |

## Notes

- `hypr-user.conf` contains machine-specific `monitor = ...` lines. Edit those on a fresh machine before sourcing.
- The pair is sourced last by Caelestia (`hypr-user.conf`) or merged at runtime (`cli.json`), so they override upstream Caelestia defaults without editing its tree.
