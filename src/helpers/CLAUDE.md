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
| `configure_axstack.js` | Latest npm Axstack release install with registry SHA-512 integrity verification under `~/.local/share/axstack/releases/<version>` with the `~/.local/bin/axstack` shim, no silent downgrade, then `axstack install --harness claude\|codex`; `checkAxstack` reports shim/version/harness state and both roles.json paths; Arch links missing t3 to t3-nightly without replacing a local t3 | Changing registry resolution or install verification, or debugging `--axstack`/`--axstack-check` |
| `configure_codex.js` | Codex CLI plus personal config sync/backup | Adding Codex setup features or debugging config sync |
| `configure_skills.js` | Matt Pocock skill installation through the upstream Skills CLI | Updating the shared Claude/Codex skill sources |
| `configure_agent_skills.js` | Pinned-upstream skill sync, safe retirement, and shared agent links | Adding or debugging managed skill sync |
| `configure_visual_explainer.js` | Validated visual-explainer theme preference with dark default and atomic persistence | Changing visual-explainer theme configuration |
| `configure_gh_stack.js` | Idempotent `github/gh-stack` extension install | Adding or debugging stacked-PR tooling setup |
| `configure_pr_watch.js` | pr-watch PR watcher sync/backup | Adding or debugging the PR watcher deploy |
| `configure_hermes_relay.js` | Pinned bootstrap when Hermes is absent plus plugin-free Telegram and running-gateway readiness probes | Adding or debugging Debian Hermes transport |
| `configure_t3_code_server.js` | Required Debian nightly T3 service over Tailscale; disables Connect and verifies HTTPS readiness | Changing CLI floor checks, service drop-ins, Tailscale mapping, or pairing guidance |
| `configure_tailscale_t3.js` | Arch Tailscale package, browser login, operator and T3 user-service reconciliation | Debugging `--tailscale-t3` or Arch phone access |
| `t3_tailscale.js` | Shared CLI floor, Tailscale drop-in, HTTPS mapping/readiness and pairing output | Changing common T3/Tailscale behavior across Arch and Debian |
| `configure_git.js`    | Git user and signing setup             | Modifying automated git configuration         |
| `configure_hyprmoncfg.js` | Profile JSON sync/backup plus hyprmoncfg package and `hyprmoncfgd.service` setup; never writes `monitors.lua` | Modifying monitor-profile deployment or the hyprmoncfg ownership boundary |
| `configure_kde_activities.js` | KDE Activity provisioning plus Haoshoku KWin activity/output rules | Modifying activity creation, window routing, or KWin script deployment |
| `configure_kde_connect.js` | Adds the non-locking `Screens Off` remote command to every paired KDE Connect device via the QML writer | Changing the remote command or device-config parsing |
| `kde_connect_commands_writer.qml` | `qml`-run writer that appends one command to a device's KDE Connect `commands` byte-array | Changing how commands are persisted through the KDE Connect API |
| `configure_kde_plasma.js` | KDE Plasma launchers, shortcut unbindings, and Activities opt-in | Modifying Plasma launchers or conflicting shortcuts |
| `configure_kde_theme.js` | KDE Ocean theme backup/sync/activate | Adding KDE theme features, debugging deploy |
| `configure_ghostty.js` | Ghostty config deploy plus XDG terminal preference | Modifying Ghostty setup or terminal default |
| `configure_zed.js`    | Zed config backup/sync (sanitized)     | Adding Zed config features, debugging sync    |
| `configure_audio.js` | PipeWire/WirePlumber config sync/backup (portable pipewire drop-ins + device-routed wireplumber variant) | Adding audio config features, debugging sync |
| `configure_mimeapps.js` | XDG mimeapps.list sync/backup — single portable file, no device routing | Adding mimeapps config features, debugging sync |
| `configure_omarchy_bar.js` | Key-scoped Omarchy bar plus bundled `xzat.tray` deploy/backup | Modifying bar layout sync, bundled tray placement, or the shared `shell.json` ownership boundary |
| `configure_omarchy_appearance.js` | Conflict-safe pinned Omarchy theme/background/font reconciliation | Modifying the portable appearance manifest or its Omarchy command handoff |
| `configure_discord_theme.js` | Omarchy theme Vencord CSS deploy into Vesktop/Vencord from `configs/discord/theme.json`, preserving other settings keys | Modifying the Discord theme manifest or its per-client settings handling |
| `configure_omarchy_plugins.js` | Manifest-driven Omarchy plugin install/enable reconciliation plus one-shot `disableOnInstall`; per-plugin failures are non-fatal | Modifying the default plugin set, idempotency, stock-widget displacement, or manual-auth reporting |
| `configure_omarchy_workspaces.js` | Omarchy 4 device-specific Lua overlay deploy plus two `hyprland.lua` require lines | Modifying workspace/binding overlays, require wiring, or reload behavior |
| `configure_gaming.js` | Steam (special:steam) / Omakade (workspace 2) login-autostart policy (`~/.config/haoshoku/gaming.json`) plus deployed-overlay reconciliation | Modifying gaming autostart defaults, flags, or the Lua patch boundary |
| `configure_split_lock_sudoers.js` | visudo-validated `/etc/sudoers.d/haoshoku-split-lock` granting only the two `kernel.split_lock_mitigate` sysctl calls the gaming wrapper makes | Changing the split-lock rule or `--gaming-split-lock` |
| `configure_omazed.js` | Omazed setup, Zed theme selection/hook deploy, and legacy theme retirement | Modifying Omarchy-managed Zed theming |
| `configure_voxtype_osd.js` | Turns off the voxtype OSD so the Speech Orb plugin replaces it | Changing dictation HUD behavior |
| `configure_warp.js` | Dormant Warp tab/theme deploy and idempotent settings activation | Reviewing or modifying the retained Warp setup |
| `configure_worktree_cleanup.js` | Worktree cleanup script/timer sync, backup, and user-timer enablement | Modifying cleanup deployment, backup, or scheduling |
| `install_user_scripts.js` | Copy `configs/scripts/*` → `~/.local/bin/` + chmod 755 | Adding user-level shell wrappers (PATH shadows, helper commands) |
| `migrate_omarchy_3_to_4.js` | Re-runnable `--3-4-migrate` flow; requires Omarchy >= 4 and defers while the Quattro live shim remains active | Modifying legacy cleanup, Lua/plugin deployment, monitor handoff, or migration gates |
| `README.md`           | Architecture and design decisions      | Understanding symlink vs copy pattern         |
