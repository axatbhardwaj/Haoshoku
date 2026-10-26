# Changelog

## 12.6.1 - 2026-10-27

### Changed

- Shared agent profile: replace the retired Telegram Notifications section
  with Merging and Holds. Agents merge their own PRs once CI is green and
  review findings are addressed, without waiting for approval; diffs touching
  migrations, auth, secrets, money paths or prod config stop at merge-ready.
- Index previously undocumented files in the repo `CLAUDE.md`/`AGENTS.md`
  tables.

### Fixed

- Tests isolate network sharing CLIs, Hermes Python discovery and the KDE
  write-permission precondition under root.

## 12.6.0 - 2026-10-26

### Removed

- Retire `--agent-accounts` and its iobox default run. Claude and Codex
  subscriptions are pooled by the CLIProxyAPI hub on axat-vps, so setup no
  longer creates `~/.claude-alt` or `~/.codex-alt`; existing directories are
  left untouched. The iobox docs and shared agent profile describe the hub
  logins and the single `claudeAgent`/`codex` T3 pool instances.

## 12.5.4 - 2026-10-22

### Changed

- Replace BattleStation (`io.github.vk2r.battle-station`) with Vitals
  (`io.github.woogy7.vitals`) in the same center bar slot. Vitals gives a
  tabbed btop-style panel with per-core CPU usage and temperatures, fans,
  GPU utilisation/clocks/temperature/power/VRAM, all machine sensors, disks
  and processes, instead of bar meters only. Haoshoku never uninstalls
  plugins, so existing machines keep the old plugin files until manually
  removed.

## 12.5.3 - 2026-10-22

### Changed

- Replace the `dizziee.system-stats` Omarchy bar widget with BattleStation
  (`io.github.vk2r.battle-station`) in the same center bar slot, adding GPU
  and local-LLM runtime monitoring. Haoshoku never uninstalls plugins, so
  existing machines keep the old plugin files until manually removed.
- System rules exclude `systemd-private-*` directories themselves; their inner
  `tmp` contents use their parent's threshold: 3 days under `/tmp`, 30 days under
  `/var/tmp`, as in the distro default.
- Tighten only `/tmp` to 3 days; retain the distro default 30-day `/var/tmp`
  age in the replacement tmpfiles policy for preserved temporary state.
- Keep branches after removing a worktree; the separate stale-branch pass uses
  compare-and-delete rather than immediate `git branch -d` after removal.
- Hosts with no discovered repositories now report that condition and succeed,
  so the daily disk-cleanup unit can still clean temporary files.

### Fixed

- Report worktrees with initialized submodules as REVIEW:
  initialized submodules; remove manually. Check both the worktree's admin
  `modules` path and populated index gitlinks, including before applying removal.
- Protect every prunable registration's HEAD and reflog history, including empty
  mount points; preserve operation state and reflog-only commits on ordinary
  worktree and branch deletion too. Skip unsupported ref storage.
- Keep worktrees and build caches during Git operations and pause repository
  branch cleanup, including stacked rebase update-refs and detached bisect.
- Make status checks independent of hiding config/index flags; protect symbolic
  refs and changed defaults, bypass local graph overrides, and keep caches when
  sibling symlink scans fail or reference an ancestor of the cache.
- Preserve primary-worktree build caches and caches referenced by symlinks in
  another worktree. Review ignored non-cache files before removing a checkout.
- Skip repository pruning when a missing registration holds commits unreachable
  from branches, tags or remotes; protect rebase/bisect branches and fresh
  reflog activity from stale-branch deletion. Warn when fetch fails.
- Preserve enabled legacy units during copy-only cleanup configuration sync
  and log a retirement hint.
- Always run the temp step even when repository cleanup fails; keep real errors
  failing the job while benign activity/content races and locked worktrees stay
  KEEP. Prune stale missing worktree registrations once per repository in apply
  mode, without changing registration metadata in dry-run.

### Added

- Generalize worktree cleanup into daily fleet disk hygiene: discover normal and
  T3 repositories, protect active checkouts, prune stale pushed branches, idle
  ignored builds and tagged Axstack caches, and clean temporary files through
  distro tmpfiles exclusions. Deploy home-relative disk-cleanup units and runtime
  files, retire the legacy timer, and wire Arch app setup alongside Debian.

## 12.5.2 - 2026-10-17

### Fixed

- Select `aur/t3code-bin` explicitly for fresh Arch desktop and iobox setup;
  hold incompatible installed desktops while continuing unrelated packages (#180).
- Share guarded stable npm T3 CLI preparation across Axstack, Tailscale and
  Debian service setup, with Node/npm prerequisites in Arch package lists (#180).
- Reuse runnable stable T3 CLIs for Axstack harness installation without
  requiring CLI ownership, a T3 registry lookup or Node/npm prerequisites (#180).

## 12.5.1 - 2026-10-16

### Fixed

- Default T3 desktop packages, managed launchers and CLI links, Debian installs
  and update channels to stable. Migrate proven managed nightly defaults and
  links, including dangling links, while preserving custom apps and unmanaged
  executables (#178).
- Hold unsafe T3 migrations for unmanaged nightly installs or newer runtimes;
  keep Arch package holds scoped to T3 so unrelated setup can continue (#178).

### Documentation

- Supply the current Omarchy Aurora palette and manual desktop import steps.
  Import, selection and visual verification remain pending; automatic palette
  synchronization is deferred (#178).

### CI

- Run the Bun suite for pull requests and stable-branch pushes in an isolated,
  nonroot container with command guards and no network access (#178).

## 12.5.0 - 2026-10-08

### Added

- Ship T3 provider settings guidance in the shared agent profile: run
  `t3-provider-fix` after changing T3 provider instances or account homes, and
  use absolute real binaries for `binaryPath` (#176).
- Name the fleet `axnet` and define control, access and worker roles in the fleet
  manifest and shared agent profile.
- Provision the T3 server without first opening the desktop app. When desktop
  settings are missing, create them with Local environment off while retaining
  checks for conflicting state. Print 15-minute `t3 pair --tailscale` links for
  other control and access hosts on the fleet tailnet (#160).

### Fixed

- Set and re-verify the Tailscale operator when its preference is absent or
  empty (#161).
- Skip JetBrains Mono Nerd Font installation when either the full or `-basic`
  package is already installed, preserving Omarchy's font (#162).
- Print final next steps with commands to rerun skipped gh-stack and Axstack
  setup; report GitHub CLI exit code 4 as not authenticated (#167).
- Remove the Axstack block from shipped agent profiles, preserve existing
  blocks during profile sync and strip them from backups (#163).
- Keep expected T3 and Tailscale status probes out of failed-step summaries;
  only probe packaged `/usr/bin/t3` when it exists. Real setup failures remain
  reported (#164).
- Require the fleet tailnet and a running Tailscale backend before fleet SSH
  actions (#165).
- Store the Executor Authorization header inline in private Claude and Codex
  config files with mode `0600`; finish `--executor-clients` with an authenticated
  MCP initialization check and report connection failure (#166).

## 12.4.0 - 2026-10-08

### Added

- Add the `iobox` agent-box profile, a validated fleet manifest and persisted
  hostname-based device detection that preserves existing profile choices.
- Route iobox setup through a dedicated developer and agent package list,
  skipping desktop integrations and gaming while retaining Omarchy appearance,
  agent setup and user scripts.
- Enable and verify user linger on Arch hosts; mask and verify sleep targets on
  iobox. Failed T3, Tailscale, linger or sleep-mask setup stops iobox provisioning.
- Add `--fleet-ssh` for Arch fleet hosts: enable and verify Tailscale SSH, manage
  peer aliases and refresh dedicated fleet host keys while preserving user SSH
  configuration. The Debian VPS keeps OpenSSH.
- Add `--agent-accounts` credential overlays, enabled by default on iobox, with
  private authentication state and shared agent resources. Existing conflicts
  are preserved and reported; logins and T3 account mapping remain manual.
- Integrate a validated 1Password service-account token file with a managed T3
  environment drop-in. Invalid files are rejected without logging token values.

### Documentation

- Document the iobox profile, fleet SSH, shared alt-account overlays and manual
  bring-up, including 1Password service-account setup. Executor defaults to a
  tailnet-only Serve origin, with temporary Funnel for server-side OAuth fetches;
  add CLI regression coverage for the fleet HTTPS origin.

## 12.3.1 - 2026-10-08

### Fixed

- Isolate Executor client test caches outside fixture HOME under Bun 1.4.2,
  preserving app-write checks. Runtime behavior is unchanged.
- Prepare recovery after v12.3.0's tag and GitHub release were created but
  release tests blocked npm and Linux binary publication. Publication of
  12.3.1 remains pending separate driver verification.

## 12.3.0 - 2026-10-08

This entry records merged T1–T7 source changes for 12.3.0. Tag, npm and Linux
binary publication require separate verification; live-host installation and
migration remain separately authorized.

### Added

- Opt-in Debian `--server-executor <https-origin>` preserving installer: pin the
  pulled upstream image digest, bind only `127.0.0.1:4788`, own only newly empty
  data, bound health/OAuth metadata checks, and verify matching managed reruns
  without updates. Existing/manual deployments and owner/auth/integration setup
  remain outside automatic adoption.
- Standalone `--executor-clients <https-endpoint>` registers both Claude and
  Codex with an `EXECUTOR_AUTHORIZATION` environment reference. Matching entries
  are no-ops; conflicts and unsupported layouts preserve both configurations.
  Native offline readback is proven for Claude 2.1.292 and Codex 0.160.1;
  authenticated tools and future T3 inheritance remain unverified.

### Fixed

- Both T3 setup entry points refuse ambiguous desktop Local environment state
  before service changes; runtime/CLI prerequisites may precede the guard.
  Desktop settings and pairing tokens are preserved.
- Debian UFW requires running tailnet networking and matching `tailscale0`
  addresses before changes. It adds interface-only OpenSSH rules, preserves
  existing public SSH rules for manual migration, and propagates skipped,
  declined or failed hardening as incomplete setup.
- Maintained docs reconcile current driver merge/release authority while
  preserving historical approvals. Migration verification selects npm latest
  once and checks the actual tarball against its selected SHA-512 integrity.

### Removed

- Future Arch and Debian setup no longer deploys Claude Remote Control,
  Claude stay-awake, or PR watch. Their deploy and backup flags fail before
  logging or setup; packaged helpers and payloads are removed. Existing host
  services, scripts, units, enablement links, watcher state, and Claude settings
  remain untouched.

- Future Arch and Debian setup no longer installs Matt Pocock skills or
  visual-explainer. Retired skill installation, inventory, agent-skill sync,
  and explainer-theme flags fail before setup; existing skills, links, and
  theme preferences remain untouched. Independent skills are managed separately.

## 12.2.2 - 2026-10-07

### Fixed

- Both T3 setup paths verify port 3773 listeners after HTTPS readiness and
  reject non-loopback binds; unavailable listener checks report uncertainty.
  Arch warns about shadowing T3 binaries and coinstalled stable/nightly packages.

- Arch T3 services prioritize real agent CLIs before mise shims; both setup
  paths write service drop-ins only when content changes. Debian root services
  disable the browser sandbox and remove that override for non-root users.

- T3 setup shares idempotent Tailscale operator configuration across Arch and
  non-root Debian, selects the invoking desktop user under sudo, and warns
  before replacing an operator or when permission setup fails. Non-root Debian
  still installs the local service after operator failure; readiness requires
  working HTTPS, and warnings give the manual repair command and retry flag.

## 12.2.1 - 2026-10-06

### Fixed

- Release tests derive the expected CLI version from `package.json`, so
  version bumps no longer break the binary and npm release workflows
  (v12.2.0 shipped no artifacts and is superseded by this release).

## 12.2.0 - 2026-10-06

### Added

- Private per-run logs with device metadata, credential redaction, bounded
  command failure diagnostics, 20-log retention, and a final failure summary.
- `--share-log [path]` shares a log explicitly through Taildrop to `io`
  (`HAOSHOKU_LOG_TARGET` overrides it), with secret-gist and manual fallbacks.

### Removed

- On Omarchy, Haoshoku no longer configures git because Omarchy sets your
  identity at install; existing `~/.gitconfig` and git profile files are left
  untouched. Other Arch hosts and Debian servers still get the git prompt.

## 12.1.0 - 2026-10-06

- Configure Arch/Omarchy Tailscale phone access after T3 installation: install
  Tailscale, enable its daemon, wait for browser login only when logged out,
  set the user operator, and enable T3's boot service with its HTTPS drop-in.
  Reuse Debian's CLI floor and HTTPS readiness helpers; print the tailnet URL
  and pairing hint. Add `--tailscale-t3` for idempotent standalone retries.
  Failures warn and allow the remaining setup to continue.

- Add a one-line Linux installer with compiled x64/arm64 binaries and runtime
  assets, so installing and running Haoshoku does not require Bun.
- Resolve packaged assets beside the executable and publish binary archives
  alongside npm on GitHub releases.

### Removed

- Arch/Omarchy setup no longer deploys Claude Remote Control, Claude
  stay-awake, or the automatic worktree cleanup timer. Shared helpers,
  templates, and one-shot commands remain available for Debian server setup.
  Existing installations are not uninstalled automatically. To stop their
  previously deployed units, run manually:

  ```bash
  systemctl --user disable --now claude-stay-awake.service
  ```

  If you enabled Remote Control:

  ```bash
  systemctl --user disable --now claude-remote-control@haki.service claude-remote-control@dev.service claude-remote-control@work.service
  ```

  If you enabled worktree cleanup:

  ```bash
  systemctl --user disable --now defi-worktree-cleanup.timer
  ```

  Disable any older enabled Remote Control instances as well. PR watch remains
  part of Arch/Omarchy setup.

## 12.0.0 - 2026-10-06

- Install the latest npm Axstack with SHA-512 integrity verification, report
  Claude/Codex role files, and link the packaged nightly T3 CLI on Arch when absent.

- Remove the retired server installer and desktop integration; `--server-paseo`
  is now rejected, and Omarchy's `Super+T` launches or focuses T3 Code Nightly.

- Require the nightly T3 Code server over Tailscale on Debian, disable existing
  T3 Connect exposure, and verify the service and tailnet HTTPS before success;
  accept the CLI's prefixed version output and keep Grok on the service PATH.

- Retire bundled routing skills with archival of live edits; remove agent-skill
  backup and install only Matt Pocock skills through the Skills CLI.

- Remove Paseo profile sync and backup commands and the profile-sync step from
  Arch and Debian setup.

- Remove Paseo task lifecycle and schedule configuration commands.

- Keep Debian Hermes Telegram transport independent of Paseo: verify readiness
  without deploying a relay plugin, restarting the gateway, or writing host markers.

## 11.15.0 - 2026-10-05

- Make T3 Code Nightly (`t3code-nightly`) the default Omarchy primary app in
  place of Orca: it starts on workspace 1 at login and `Super+1` / `Super+6`
  move and focus it. Line 2 of `~/.config/haoshoku/primary-app` now overrides
  the window class (Nightly needs `com.t3tools.T3Code`), and `--workspaces`
  migrates a stored `stably-orca` setting.
- Install `t3code-nightly-bin` instead of `stably-orca-bin` on Arch.
- Route agent orchestration in the shared Claude/Codex profile through T3 Code.

## 11.14.2 - 2026-09-26

- Let the primary-app Lua behavior tests skip on CI hosts without a Lua
  interpreter, matching the existing Omarchy overlay test convention.

## 11.14.1 - 2026-09-26

- Launch the configurable primary app on workspace 1 and make `Super+1` and
  `Super+6` move its existing window to the requested workspace and focus it.
  Change `~/.config/haoshoku/primary-app` to switch the executable later.

## 11.14.0 - 2026-09-25

- Lift the kernel split-lock penalty for the lifetime of games launched
  through `haoshoku-gaming-workspace place`, restoring it on exit. Install the
  narrow sudoers rule it needs with `haoshoku --gaming-split-lock`; the CachyOS
  gaming step installs it too.

## 11.13.9 - 2026-09-24

- Keep placing launched games on gaming workspace 2 when gamescope remaps its
  window between Ubisoft Connect, the anti-cheat splash, and the game, instead of
  stranding the game on the focused monitor.

## 11.13.8 - 2026-09-24

- Install the Speech Orb Omarchy plugin as the dictation HUD, place it in the
  center bar, and turn off voxtype's own OSD so only the orb shows.

## 11.13.7 - 2026-09-23

- Keep specs for repositories outside the `defi-com` GitHub organization on
  GitHub instead of Linear in the shared agent profile.

## 11.13.6 - 2026-09-23

- Add a configurable, backupable native Codex status line through `--codex`
  and `--codex-backup`, with private rollback on config errors.
- Keep OS setup running when Codex status line configuration fails.

## 11.13.5 - 2026-09-23

- Add `stably-orca-bin` to the Arch package list.

## 11.13.4 - 2026-09-22

- Use GTK-valid application IDs for owned Ghostty windows so workspace 7,
  Haki, and agents are recognized instead of falling back to Ghostty's default
  class and creating duplicates.

## 11.13.3 - 2026-09-22

- Make `Super+7` switch to workspace 7 and focus its owned Ghostty when present,
  reclaim it when stranded, or create it when absent, while keeping login-time
  startup non-focusing.

## Earlier releases

- [11.13.2 - 2026-09-22 through 11.6.1 - 2026-09-08](CHANGELOG/archive-01.md)
- [11.6.0 - 2026-09-08 through 9.1.0 - 2026-08-16](CHANGELOG/archive-02.md)
- [9.0.0 - 2026-08-16 through 7.7.0 - 2026-08-07](CHANGELOG/archive-03.md)
- [7.6.0 - 2026-08-07 through 6.0.1 - 2026-08-01](CHANGELOG/archive-04.md)
- [6.0.0 - 2026-08-01 through 5.15.0 - 2026-07-28](CHANGELOG/archive-05.md)
- [5.14.0 - 2026-07-26 through 5.12.0 - 2026-07-18](CHANGELOG/archive-06.md)
- [5.9.1 - 2026-06-17 through 5.2.7 - 2026-05-21](CHANGELOG/archive-07.md)
- [5.2.6 - 2026-05-21 through 5.0.1 - 2026-05-20](CHANGELOG/archive-08.md)
- [5.0.0 - 2026-05-20 through 3.0.1 - 2026-02-01](CHANGELOG/archive-09.md)
- [2.13.0 - 2026-01-30 through 2.2.0 - 2025-12-12](CHANGELOG/archive-10.md)
