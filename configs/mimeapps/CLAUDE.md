# configs/mimeapps/

XDG default-applications config (`mimeapps.list`). Fully portable — no device routing.

## Files

| File             | What                                                                                              | When to read                                             |
| ---------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `mimeapps.list`  | XDG default-application and URI scheme-handler associations (one file, same on every machine)    | Changing which app opens a MIME type or scheme handler  |
| `applications/*.desktop` | Managed desktop entries deployed to `~/.local/share/applications/` alongside `mimeapps.list` | Adding launcher entries for local scripts or URI handlers |

## Notes

- `mimeapps.list` lives at `~/.config/mimeapps.list` on the live system and is read by XDG-compliant desktops (KDE, GNOME, Hyprland + xdg-open, etc.) to resolve which application opens a given MIME type or URI scheme.
- The file is **fully portable**: it records application names (`.desktop` file IDs) rather than paths, so the same file is valid on any machine as long as the referenced applications are installed.
- There is no device routing — unlike audio or Caelestia configs there is no `pc`/`laptop` split. One file covers all machines.
- Run `haoshoku --mimeapps` to deploy `configs/mimeapps/mimeapps.list` → `~/.config/mimeapps.list`.
- Run `haoshoku --mimeapps-backup` to snapshot `~/.config/mimeapps.list` back into the repo.
