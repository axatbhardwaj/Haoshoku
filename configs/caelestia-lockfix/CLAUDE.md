# configs/caelestia-lockfix/

Caelestia lock-screen portrait-fix kit. `apply.sh` patches two QML files in the
`caelestia-shell` package so the lock screen fits portrait monitors.

## Files

| File                                  | What                                                                                         | When to read                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `apply.sh`                            | Shell script that patches `caelestia-shell`'s packaged QML and restarts the Caelestia shell | Understanding the patch workflow or re-running after an update |
| `LockSurface.qml.portrait-fix.patch`  | Patch for `LockSurface.qml` — introduces `fitBase` property to clamp lock panel to screen width | Updating the patch after an upstream caelestia-shell change |
| `Center.qml.portrait-fix.patch`       | Patch for `Center.qml` — switches `centerScale` to use `fitBase` instead of raw screen height | Updating the patch after an upstream caelestia-shell change |

## Notes

- The helper (`src/helpers/configure_lockfix.js`) deploys this kit to
  `~/.local/share/caelestia-lockfix/`. Run `haoshoku --lockfix` to deploy and
  `haoshoku --lockfix-backup` to snapshot the live kit back into the repo.
- This is a workaround for an upstream Caelestia bug: the lock screen uses
  `screen.height` as the sizing base, which overflows on portrait monitors.
  `apply.sh` patches `/etc/xdg/quickshell/caelestia/modules/lock/LockSurface.qml`
  and `Center.qml` to use a `fitBase` clamp instead.
- After a `caelestia-shell` package update reverts the QML files, re-run
  `bash ~/.local/share/caelestia-lockfix/apply.sh` to re-apply the fix.
- `CLAUDE.md` is never deployed to the live kit dir — it is repo documentation only.
