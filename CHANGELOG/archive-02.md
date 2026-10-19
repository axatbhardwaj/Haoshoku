## 11.6.0 - 2026-09-08

- Add `--server-paseo` and an optional Debian setup step for a native headless
  Paseo daemon with a persistent systemd user service and optional relay pairing.
- Preserve existing Paseo configuration, default fresh installs to localhost,
  refuse unmanaged daemon conflicts, and restart changed managed services.
- Share the Node runtime bootstrap while preserving T3 compatibility checks.

## 11.5.1 - 2026-09-07

- Reassert `haoshoku-browser.desktop` as the XDG browser and web URL handler
  at every Omarchy login, so browser or desktop updates cannot silently bypass
  Haoshoku's most-recently-focused Brave Origin profile routing.

## 11.5.0 - 2026-09-03

- Revert the mesh-access feature set shipped in 11.3.0 and still present in
  11.4.0 (`--tailscale`, `--sshd`, `--herdr`, `configs/ssh/authorized_keys`,
  per-host mesh users). T3 Code is the phone path again: the Debian T3 server
  step is mandatory as before, `t3code-bin` is back in the Arch package list,
  and the Debian path keeps its original public-SSH policy.

## 11.4.0 - 2026-09-03

- Give each mesh host its own login user in the managed `~/.ssh/config` block
  (`xzat` for `pc`/`laptop`, `root` for `vps`) instead of the local username,
  so cross-machine SSH works when usernames differ.

## 11.3.0 - 2026-09-03

- Add `--tailscale`: install Tailscale, enable `tailscaled`, and join the
  tailnet with an interactive login only when the node is not already
  Running. Runs on both the Arch and Debian paths.
- Add `--sshd`: key-only sshd drop-in, per-machine ed25519 key, union merge of
  `configs/ssh/authorized_keys` into `~/.ssh/authorized_keys`, managed
  `pc`/`laptop`/`vps` block in `~/.ssh/config`, and UFW SSH restricted to
  `tailscale0`. On Debian the public SSH rule is removed only behind a lockout
  gate (Tailscale Running + keys present) and a confirmation prompt. This
  reverses the old Debian "keep password login" policy and supersedes its
  `setupSsh` step.
- Add `--herdr`: install herdr as the agent session layer when missing, pin the
  stable channel, and enable systemd lingering. Never upgrades an existing
  install.
- Make the Debian T3 Code server step opt-in (default no); a skipped T3 no
  longer fails the run. Drop `t3code-bin` from the Arch package list.
  `--server-t3-code` is unchanged.

## 11.2.8 - 2026-09-03

- Recover `HYPRLAND_INSTANCE_SIGNATURE` in the default-browser router when
  xdg-open callers spawn outside the compositor session (portals, systemd
  units, remote shells), so links keep opening in the most recently focused
  Brave Origin profile instead of silently falling back to the default one.

## 11.2.7 - 2026-09-02

- Install Omakade from the Arch application list. Steam and Omakade now start
  silently on gaming workspace 2 at login, and `SUPER+2` focuses that workspace
  and launches Omakade when it is missing. `SUPER+SHIFT+G` still toggles the
  workspace and ensures Steam. Steam's overlay window rule tiles the client so
  Omarchy's stock `float = true` does not reopen it as a centered float.

## 11.2.6 - 2026-09-02

- Add a non-locking KDE Connect `Screens Off` command for paired phones. The
  command turns off all Hyprland displays through DPMS, preserves existing
  remote commands, and is available through `--kde-connect-commands` as well
  as the full Omarchy setup.

## 11.2.5 - 2026-09-01

- Pin Elysian to size-24 / 4-pass blur, 0.80 window glass, and 0.90 browser
  opacity. Copy the theme's Omarchy 4 `hyprland.lua.tpl` into the user themed
  overlay so cloned-theme Lua dropping does not skip the glass, and keep
  Kitty background opacity in the base config.

## 11.2.4 - 2026-08-31

- Authenticate sudo once before the Arch setup, keep its timestamp alive with
  silent, non-interactive refreshes while setup runs, keep all later Haoshoku
  sudo calls non-interactive, and always stop the refresh timer when setup
  completes or aborts.

## 11.2.3 - 2026-08-30

- Route the Arch setup's full system upgrade through `omarchy update -y` when
  Omarchy is installed, preserving Omarchy's snapshots, migrations, hooks, and
  restart checks instead of triggering its direct-Pacman transaction guard.

## 11.2.2 - 2026-08-30

- Start T3 Code once at Omarchy login from both device workspace overlays.
  Leave it on whichever workspace it opens or is moved to, and make `Super+T`
  focus the existing window instead of forcing workspace 1.
- Remove the Haoshoku `Super+A` Haki binding, and make `Super+M` reveal the
  `special:music` workspace on the currently focused monitor.

## 11.2.1 - 2026-08-26

- Pin Elysian to its Omarchy 4-compatible v1.0.0 release. Recognized legacy
  local-origin checkouts are moved to a timestamped sibling backup before the
  clean pinned theme is installed; failed installs restore the original
  checkout, and unrelated theme directories remain untouched.

## 11.2.0 - 2026-08-25

- Automatically detect fresh Arch installations as PC or laptop from DMI
  chassis data, falling back to battery presence when DMI is inconclusive.
  Persist the result before device-routed setup, honor an existing explicit
  selection, and keep `--device-type` as the manual override.
- Add a portable Omarchy appearance manifest and `--omarchy-appearance` mode.
  Full Arch setup safely installs Elysian at its pinned commit and asks Omarchy
  to apply the tracked background and font. Matching dirty checkouts are
  preserved; foreign theme directories are never replaced.

## 11.1.0 - 2026-08-25

- Bundle the user-owned `xzat.tray` Omarchy plugin and deploy or back it up with
  the managed bar. The overflow drawer now keeps status notifier items together
  with Galaxy Buds, hyprmoncfg, Display, and No Sleep controls while preserving
  Feishin and generic MPRIS playback on the left.
- Replace both the stock Agents widget and the former Agent Usage plugin with
  Agent Usage Plus, keeping it in the stock right-bar position and deploying
  the user-path collector wrapper required by the upstream plugin. The wrapper
  also translates Omarchy 4.0.0's retired Codex `untrusted` approval value to
  `never` only inside usage refreshes, restoring rate-limit discovery on
  current Codex releases without changing normal Codex launches.
- Manage Claude Desktop alongside Codex Desktop in the `Super+I` assistants
  workspace, reclaiming either application when it is outside the workspace
  and launching only the missing desktop app.

## 11.0.1 - 2026-08-23

- Enable Omarchy's built-in generic media widget in the managed bar so MPRIS
  players such as Spotify and Brave expose now-playing controls after setup.
- Install and enable the Galaxy Buds plugin, surface its Bluetooth-pairing
  requirement, and preserve its right-bar placement and label configuration.

## 11.0.0 - 2026-08-23

- Back up the live compact Claude and Codex personal policy as the portable
  baseline. Retire the remaining private-policy bootstrap, Agent OS,
  Superpowers installers, bundled HTML skill, and custom skill clone/merge
  layer so none can resurrect the previous orchestration stack.
- Delegate shared skill installation to the upstream Skills CLI with
  `mattpocock/skills` as Haoshoku's single declared source for Claude Code and
  Codex. Full Arch and Debian setup reconcile the same source.

## 10.0.1 - 2026-08-20

- Remove retired cross-engine orchestration identifiers and role labels from
  maintained source, examples, ignore rules, and the packaged HTML skill while
  preserving native Claude and Codex subagent support.

## 10.0.0 - 2026-08-20

- Breaking: retire Haoshoku's custom Claude agent/wrapper runtime and bundled
  standalone Claude skills. `--claude` and `--claude-backup` now manage only
  `CLAUDE.md`, `statusline-command.sh`, and `.gitignore`; only an explicit
  `--skills` or `--skills-update` invocation syncs external skills for Claude
  and Codex, and source `agents/` directories are ignored.
  Upgrades deliberately do not recursively prune co-owned live directories, so
  remove any previously deployed files through an explicit reviewed path list.
- Back up the current compact Claude preferences policy and stop allowing
  `agents/` in the deny-first private-policy ignore template. Native Claude and
  Codex subagents remain available through their engines; retired cross-engine
  plugin workflows stay outside the package. Remove the retired `codex-rescue`
  display special case from the retained statusline.

## 9.3.0 - 2026-08-18

- Resync the bundled Claude runtime: the implement-work skill now runs a final
  cold Opus review over the full branch diff, re-run after any fix loop that
  changes it, with
  intermediate dispatch checks delegated to `sol-medium-wrapper`;
  `sol-medium-wrapper` now dispatches on the priority (fast) service tier,
  with the tier enforced in its receipt check; and `opus-reviewer` now
  explicitly pins `effort: high`, while the review-pr panel's Opus lens now
  documents `effort high` to match the pinned agent definition.
- Retire the `anveshaka` and `madhyastha` agents, removing them from the
  bundle, the deployment manifest, and the test pins. Upgrades leave the old
  agent definitions in `~/.claude/agents/`, where they remain visible in the
  agent picker; delete those files manually.
- Add a deployed Claude scratch-directory policy requiring scratch work under
  `~/agent-temp-dir-work`, explaining the `/tmp` quota rationale, and exempting
  launcher-owned `/tmp` paths. Because `--claude` deploys `CLAUDE.md` over the
  live copy, this is a user-visible policy change.

## 9.2.0 - 2026-08-17

- Resync the bundled Claude runtime from live: rename `sol-wrapper` to
  `sol-high-wrapper` and `luna-wrapper` to `luna-max-wrapper`, and add
  `sol-medium-wrapper`. Upgrades leave the old agent definitions in
  `~/.claude/agents/`, where the validator and launcher hard-refuse them but
  they remain visible in the agent picker; delete those files manually.

## 9.1.0 - 2026-08-16

- Install the KDE Connect backend for the default omaconnect plugin and start
  its daemon explicitly in Omarchy 4, where Hyprland does not process the XDG
  autostart entry, so phone sync is reliably available from login.
- Remove the retired Caelestia subsystem while retaining device-type routing as
  shared configuration for Omarchy and audio setup.
