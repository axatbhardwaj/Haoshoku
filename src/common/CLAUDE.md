# src/common/

## Files

| File       | What                                      | When to read                              |
| ---------- | ----------------------------------------- | ----------------------------------------- |
| `utils.js` | Shell execution, command checking, logger, stored device-type reader | Running commands, checking deps, logging, reading deviceType  |
| `device_type.js` | DMI/battery PC/laptop detection, fallback selection, and persistence | Detecting or writing deviceType in `~/.haoshoku.json` |
| `ui.js`    | Banner display, gradient text             | Modifying startup UI, colors              |
