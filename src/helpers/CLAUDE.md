# src/helpers/

Standalone setup scripts for specific tools.

## Files

| File                  | What                                   | When to read                                  |
| --------------------- | -------------------------------------- | --------------------------------------------- |
| `configure_bash.js` | Portable Bash fragment deploy plus idempotent `.bashrc` source wiring | Adding or debugging Bash setup |
| `configure_brave_managed_policies.js` | Brave theme/default-browser managed policies plus policy-tree repair | Modifying browser policies, theme color sync, or policy ownership |
| `configure_chromium_profiles.js` | Validated shared browser-profile registry seeding in `~/.haoshoku.json` | Modifying managed browser profiles or session-name validation |
| `configure_claude.js` | Claude config sync, backup, update     | Adding Claude config features, debugging sync |
| `configure_claude_stay_awake.js` | claude-stay-awake sleep inhibitor deploy/enable/backup | Adding or debugging the Claude sleep inhibitor |
| `configure_claude_remote_control.js` | Claude Remote Control trust/disclaimer seed, supervisor + user-unit deploy/enable/backup | Adding or debugging persistent Claude Remote Control sessions |
| `configure_codex.js` | Codex CLI plus personal config sync/backup | Adding Codex setup features or debugging config sync |
| `configure_skills.js` | Matt Pocock skill installation through the upstream Skills CLI | Updating the shared Claude/Codex skill source |
| `configure_gh_stack.js` | Idempotent `github/gh-stack` extension install | Adding or debugging stacked-PR tooling setup |
| `configure_pr_watch.js` | pr-watch PR watcher sync/backup | Adding or debugging the PR watcher deploy |
| `configure_t3_code_server.js` | Debian T3 Code service plus idempotent T3 Connect lifecycle | Adding or debugging T3 Connect authorization, provisioning, or service verification |
| `configure_git.js`    | Git user and signing setup             | Modifying automated git configuration         |
| `configure_hyprmoncfg.js` | Profile JSON sync/backup plus hyprmoncfg package and `hyprmoncfgd.service` setup; never writes `monitors.lua` | Modifying monitor-profile deployment or the hyprmoncfg ownership boundary |
| `configure_kde_activities.js` | KDE Activity provisioning plus Haoshoku KWin activity/output rules | Modifying activity creation, window routing, or KWin script deployment |
| `configure_kde_plasma.js` | KDE Plasma launchers, shortcut unbindings, and Activities opt-in | Modifying Plasma launchers or conflicting shortcuts |
| `configure_kde_theme.js` | KDE Ocean theme backup/sync/activate | Adding KDE theme features, debugging deploy |
| `configure_kitty.js` | Kitty config/session deploy plus XDG terminal preference | Modifying Kitty setup, split sessions, or terminal default |
| `configure_zed.js`    | Zed config backup/sync (sanitized)     | Adding Zed config features, debugging sync    |
| `configure_audio.js` | PipeWire/WirePlumber config sync/backup (portable pipewire drop-ins + device-routed wireplumber variant) | Adding audio config features, debugging sync |
| `configure_mimeapps.js` | XDG mimeapps.list sync/backup — single portable file, no device routing | Adding mimeapps config features, debugging sync |
| `configure_omarchy_bar.js` | Key-scoped Omarchy bar deploy/backup within `shell.json` | Modifying bar layout sync or the shared `shell.json` ownership boundary |
| `configure_omarchy_plugins.js` | Manifest-driven Omarchy plugin install/enable reconciliation plus one-shot `disableOnInstall`; per-plugin failures are non-fatal | Modifying the default plugin set, idempotency, stock-widget displacement, or manual-auth reporting |
| `configure_omarchy_workspaces.js` | Omarchy 4 device-specific Lua overlay deploy plus two `hyprland.lua` require lines | Modifying workspace/binding overlays, require wiring, or reload behavior |
| `configure_omazed.js` | Omazed setup, Zed theme selection/hook deploy, and legacy theme retirement | Modifying Omarchy-managed Zed theming |
| `configure_warp.js` | Dormant Warp tab/theme deploy and idempotent settings activation | Reviewing or modifying the retained Warp setup |
| `configure_worktree_cleanup.js` | Worktree cleanup script/timer sync, backup, and user-timer enablement | Modifying cleanup deployment, backup, or scheduling |
| `install_user_scripts.js` | Copy `configs/scripts/*` → `~/.local/bin/` + chmod 755 | Adding user-level shell wrappers (PATH shadows, helper commands) |
| `migrate_omarchy_3_to_4.js` | Re-runnable `--3-4-migrate` flow; requires Omarchy >= 4 and defers while the Quattro live shim remains active | Modifying legacy cleanup, Lua/plugin deployment, monitor handoff, or migration gates |
| `README.md`           | Architecture and design decisions      | Understanding symlink vs copy pattern         |
