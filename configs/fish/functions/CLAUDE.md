# configs/fish/functions/

Autoloaded fish functions deployed to `~/.config/fish/functions/`. Each file defines exactly one function whose name matches the filename.

## Files

| File                  | What                                                            | When to read                                |
| --------------------- | --------------------------------------------------------------- | ------------------------------------------- |
| `fish_greeting.fish`  | Shell startup decider — onefetch in a git repo, fastfetch elsewhere | Adjusting the welcome banner / fetch tool |
| `is_git_repo.fish`    | Helper used by the greeting; cd's to the repo root if invoked from a subdir | Reusing the git-repo detection logic |

## Deployment

`configureFishShell()` in `src/os_scripts/cachyos.js` copies every `*.fish` here into `~/.config/fish/functions/` AFTER `configureHyprland()` runs, because Caelestia's `install.fish` overwrites these paths during its install step.
