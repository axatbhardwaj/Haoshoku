# src/helpers/

Standalone setup scripts for specific tools.

## Files

| File                  | What                                   | When to read                                  |
| --------------------- | -------------------------------------- | --------------------------------------------- |
| `configure_claude.js` | Claude config sync, backup, update     | Adding Claude config features, debugging sync |
| `configure_git.js`    | Git user and signing setup             | Modifying automated git configuration         |
| `configure_kde_theme.js` | KDE Ocean theme backup/sync/activate | Adding KDE theme features, debugging deploy |
| `configure_zed.js`    | Zed config backup/sync (sanitized)     | Adding Zed config features, debugging sync    |
| `configure_caelestia_prefs.js` | Caelestia user prefs sync/backup (`hypr-user.conf`, `cli.json`) | Adding Caelestia override features, debugging sync |
| `configure_audio.js` | PipeWire/WirePlumber config sync/backup (portable pipewire drop-ins + device-routed wireplumber variant) | Adding audio config features, debugging sync |
| `configure_mimeapps.js` | XDG mimeapps.list sync/backup — single portable file, no device routing | Adding mimeapps config features, debugging sync |
| `configure_lockfix.js` | Caelestia lock-screen portrait-fix kit sync/backup (`apply.sh` + `*.patch` files, `chmod 755` on `apply.sh`) | Adding lockfix features, debugging kit deploy |
| `configure_sddm.js` | caelestia-sddm posthook sudoers rule (single validated root transaction; non-fatal; refuses root) | Adding SDDM posthook features, debugging sudoers writes |
| `install_user_scripts.js` | Copy `configs/scripts/*` → `~/.local/bin/` + chmod 755 | Adding user-level shell wrappers (PATH shadows, helper commands) |
| `skill_manager.js`    | Runtime git clone for Claude skills    | Adding skill sources, debugging skill sync    |
| `README.md`           | Architecture and design decisions      | Understanding symlink vs copy pattern         |
