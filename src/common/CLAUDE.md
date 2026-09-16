# src/common/

## Files

| File       | What                                      | When to read                              |
| ---------- | ----------------------------------------- | ----------------------------------------- |
| `utils.js` | Shell execution, command checking, logger, stored device-type reader | Running commands, checking deps, logging, reading deviceType  |
| `device_type.js` | DMI/battery PC/laptop detection, fallback selection, and persistence | Detecting or writing deviceType in `~/.haoshoku.json` |
| `cli_utils.js` | `MODE_FLAGS` registry, `/etc/os-release` detection, and mutually-exclusive mode-flag validation | Adding a CLI mode flag or changing OS detection |
| `omarchy_version.js` | `omarchy version` major parse and the Omarchy >= 4 gate (`OMARCHY_V4_REFUSAL`) | Gating a helper on the Omarchy major version |
| `node_24_runtime.js` | Shared NodeSource Node.js 24 installer with caller-owned compatibility policy | Preparing Node.js for Debian server helpers |
| `ui.js`    | Banner display, gradient text             | Modifying startup UI, colors              |
