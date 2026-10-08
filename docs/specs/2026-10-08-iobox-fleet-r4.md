<!-- Approved 2026-10-08 by Axat. Authoritative: https://github.com/axatbhardwaj/Haoshoku/issues/142 (body sha256 d3f83ab176f0235eb633287f4e2eaed6f1c8eeb063ce693aee14950d111a4840) -->

# Spec: iobox agent-box profile + tailnet fleet

Run `20261008-iobox-profile` · base `5109e17` · rev r4 (2026-10-08) · driver T3 thread `8704d3e1`

## Outcome
Haoshoku can provision **iobox**, an always-on Omarchy box that runs T3 Code for agent work, and sets up the
**fleet** (io = PC, iobook = laptop, iobox = agent box, axat-vps = Debian VPS) so hosts reach each other and
Executor over Tailscale only. io's hand-made setup (Tailscale SSH, linger, alt accounts) becomes reproducible.

## Decisions (settled in Align)
| # | Decision | Source |
|---|---|---|
| D1 | Keep stored `pc`/`laptop`; add `iobox`. Labels: `PC (io)`, `Laptop (iobook)`, `Agent box (iobox)`. | user + both advisers |
| D2 | Hostname → deviceType comes from tracked `configs/fleet.json`. Order: flag > stored > fleet hostname > DMI > prompt. Stored value that disagrees with fleet entry warns, never auto-overwrites. | advisers |
| D3 | Fleet SSH = Tailscale SSH on Arch hosts (`tailscale set --ssh`); VPS stays OpenSSH via a managed ssh config fragment. No sshd, authorized_keys or ufw changes on Arch. | user Q1 |
| D4 | Agents may SSH to any fleet host and act there without restriction. Accepted risk: one compromised agent reaches every fleet host; docs say so. | user Q2 |
| D5 | iobox installs 1Password desktop app **and** `op` CLI; agents use a 1Password service-account token. | user Q3 |
| D6 | Fleet contract and Executor tailnet URL are public in `configs/agent-profile/PROFILE.md` + repo AGENTS.md/CLAUDE.md. Never commit API keys, tokens or raw 100.x IPs. Tailnet name is already public via CT logs. | user delegated; driver judgment |
| D7 | Executor is tailnet-only via Tailscale Serve (done live 2026-10-08); supersedes the 2026-10-07 spec's rejection of a tailnet-only origin. API key kept. | user |
| D8 | T3 provider instances (`claudeAlt`/`codexAlt`) and all logins stay manual; Haoshoku documents them. | advisers |

## Acceptance criteria
**A. Device profile**
1. `haoshoku --device-type iobox` persists `iobox`; invalid values still rejected; one exported `DEVICE_TYPES` constant used by `utils.js`, `haoshoku.js` and `device_type.js`.
2. On a fresh host whose hostname is in `configs/fleet.json`, setup selects that deviceType without prompting **and saves it to `~/.haoshoku.json`** (later steps read the file). DMI/prompt still apply to unknown hosts. Malformed/duplicate manifest entries fail with a clear message before any write.
3. (PR3, needs the manifest) Stored `pc` on hostname `iobox` prints a warning naming `haoshoku --device-type iobox` and keeps `pc`.
4. On iobox, device-routed steps (workspaces overlay, hyprmoncfg profiles, audio) are skipped in full setup, and standalone `--workspaces`, `--monitors`, `--hyprmoncfg-backup`, `--audio`, `--audio-backup` exit non-zero with "not supported on iobox" and write no device config. pc/laptop behaviour unchanged (existing tests stay green).

**B. iobox setup**
5. iobox installs from `common/paru_applist_iobox.txt` (real package names: dev tools, `t3code-nightly-bin`, `tailscale`, `github-cli`, `git`, `1password`, `1password-cli`, Claude/Codex deps) and skips Flatpaks, gaming/Steam, uosc/MPV, Bluetooth prompt, Brave/Chromium profiles, KDE Connect, voxtype, bar and plugins (together). Omarchy appearance still applies.
6. Agent setup (Claude, Codex, Axstack, gh-stack, shared instructions) runs as on io; user scripts still install on iobox even though Chromium profile setup is skipped (today they run inside `configureBrowserIntegration`).
7. Rerun is idempotent; nothing previously installed is removed.

**C. Always-on**
8. The T3 service step runs `sudo -n loginctl enable-linger <user>` for the non-root setup user on every Arch host (skip if already `Linger=yes`) and re-reads `Linger=yes` after.
9. On iobox only, system `sleep/suspend/hibernate/hybrid-sleep` targets are masked and verified masked after; rerun is a no-op.
10. On iobox, failure of T3 service, Tailscale, linger or the sleep mask makes setup exit non-zero with the failed step named (pc/laptop keep warn-and-continue).

**D. Fleet SSH** (runs only when `os.hostname()` is listed in `configs/fleet.json`; other machines — npm/binary users — get none of D)
11. On Arch fleet hosts (io and iobook already run Tailscale; iobox installs it), setup runs `tailscale set --ssh` when `tailscale debug prefs` shows `RunSSH: false`, then re-reads `RunSSH: true`. Tailscale not running/logged out or a failed set is reported; on iobox it makes setup exit non-zero, on pc/laptop it warns.
11a. Standalone `haoshoku --fleet-ssh` runs only D11–D12a on an Arch fleet host; on a non-fleet host or Debian it exits non-zero with a message and changes nothing.
12. Setup writes a managed `~/.ssh/config.d/haoshoku-fleet` with one `Host` block per fleet host except itself: `HostName` = MagicDNS name, `User` = `sshUser`; OpenSSH hosts also get `IdentityFile ~/.ssh/<identityFile>` from the manifest (VPS: `id_ed25519_vps`, same name on every host) and `StrictHostKeyChecking accept-new` (its first-connect entry in `~/.ssh/known_hosts` is expected). `Include config.d/haoshoku-fleet` is ensured as the **first** line of `~/.ssh/config`; existing user Host/Match blocks (e.g. `Host vps`) are untouched (verify with `ssh -G`). Rerun is a no-op.
12a. Tailscale-transport Host blocks use `UserKnownHostsFile ~/.ssh/known_hosts_fleet`, rebuilt each run from `tailscale status --json` peer `sshHostKeys`, matching the fleet host to the peer whose `DNSName` is `<hostname>.<tailnet>.`; no match or several matches skips that host with a warning. Lines are written as `<short name>,<MagicDNS name> <key>`; strict checking stays on. Peers that are offline or have no keys keep their previous lines; a failed refresh leaves the file unchanged. User `~/.ssh/known_hosts` is untouched. Success means `ssh -o BatchMode=yes iobook true` from io works (fails today on a stale key).
13. `configs/fleet.json`: `hosts[]` with unique `hostname`, `role`, `os` (`arch|debian`), `deviceType` (Arch only, from DEVICE_TYPES), `sshUser`, `transport` (`tailscale|openssh`), `identityFile` (openssh only, a filename, not a key). Plus `tailnet` (MagicDNS suffix). No keys, IPs or secrets. Validated before any write.

**E. Alt accounts**
14. New opt-in `--agent-accounts` (default on in iobox full setup; runs after Claude, Codex and agent-profile sync) makes `~/.claude-alt` and `~/.codex-alt` credential overlays:
    - private (never linked): Claude `.credentials.json .claude.json history.jsonl sessions session-env shell-snapshots cache backups security mcp-needs-auth-cache.json .last-cleanup`; Codex `auth.json config.toml models_cache.json log memories tmp`.
    - every other top-level entry of the primary home is symlinked into the alt home.
    - Codex `config.toml` is copied once from the primary when the alt one is missing (so Haoshoku settings and `--executor-clients` work; it is a real file).
    - all other runtime state (Codex `history.jsonl`, `sessions`, `*.sqlite*`, Claude `projects`, …) stays shared, matching io's working setup.
    - existing real files/dirs and wrong or dangling links are reported and left alone; correct links to shared entries are kept. A private entry that is a symlink keeps its bytes but makes the step report incomplete (accounts not isolated). Missing primary home: skip with a message.
    - tests: fixture homes prove the overlay, a Codex alt `config.toml` that `--executor-clients` accepts, and that alt-home auth files never point into the primary home.
15. Docs: run `--executor-clients` once per home (`CLAUDE_CONFIG_DIR=~/.claude-alt CODEX_HOME=~/.codex-alt`); T3 instance ids `claudeAlt`/`codexAlt` map to those homes (set in T3 manually); headless logins (`claude` paste-code, `codex login --device-auth`).

**F. 1Password CLI** (runs only after the T3 service step succeeds)
16. iobox installs `1password-cli`. The operator creates `~/.config/op/service-account.env` (regular file, 0600, owned by the user) containing exactly one non-empty line `OP_SERVICE_ACCOUNT_TOKEN=<token>` (one trailing newline allowed) and nothing else. If valid, Haoshoku writes a managed drop-in `~/.config/systemd/user/t3code.service.d/haoshoku-op.conf` with `EnvironmentFile=-%h/.config/op/service-account.env`, then daemon-reloads and restarts `t3code` when the drop-in changed. Absent file: print how to create it; no drop-in written. Invalid file (mode, owner, extra or missing lines) on first install: warn, write no drop-in. Token rotation or later creation with an unchanged drop-in is activated by `systemctl --user restart t3code` (documented; setup prints it). The token value is never logged, copied or committed.
16a. The T3 desktop preflight accepts exactly that managed drop-in (name and content) when the env file is absent or passes the same check as A16, and still rejects any other EnvironmentFile or unknown drop-in. With the drop-in present and an invalid env file it fails closed with a message naming `~/.config/op/service-account.env` and the fix (correct it to the single line with mode 0600, or delete it), never the generic override error; nothing is started or rewritten. Existing `axstack-path.conf`/`axstack-tailscale.conf` stay accepted. Regression tests: first install and rerun with the drop-in pass; rerun with the drop-in and a deleted env file passes; an env file that also sets `T3CODE_HOME=` is rejected with the actionable message, and fixing or deleting it makes the next rerun pass. No test output contains the token.

**G. Docs and instructions**
17. `PROFILE.md` gains the Executor tailnet URL line (fixes current drift) and a short fleet section: hosts/roles, Tailscale-only access, SSH by short name, D4 authority, `op` usage.
18. Repo AGENTS.md and CLAUDE.md (kept in sync) and README document iobox, fleet, and the bring-up checklist: set hostname `iobox`; `tailscale up`; disable T3 desktop Local environment before the service step (existing preflight); run Haoshoku from a git checkout with Bun until a release ships; 2× claude login, 2× codex login; `gh auth login` and git identity (Omarchy skips git setup); create the iobox SSH key and authorize it on the VPS by hand; op token file; T3 pairing; tailnet policy must allow port 22 and an SSH rule with `action: accept` for the fleet (an overlapping `check` rule wins and breaks unattended SSH); final smoke `ssh -o BatchMode=yes <peer> true` per peer. They also document the Executor tailnet-only origin (D7), the D4 accepted risk, and the OAuth caveat (providers that fetch callbacks server-side need temporary Funnel).
19. Unit tests prove `--server-executor` accepts `https://axat-vps.<tailnet>.ts.net` (parser already does); README no longer says the origin must be public, documents tailnet-only as default and temporary public exposure (Funnel) as an operator-managed exception for OAuth providers that fetch callbacks server-side. Live re-run against the hand-edited VPS compose is out of scope.

## Exclusions
- No remote/fleet-wide push: each host runs Haoshoku locally.
- No tailnet ACL edits, no T3 settings/provider-instance edits, no automated logins.
- No Tailscale Serve automation for Executor (operator-managed; already live). Rerunning `--server-executor` cannot undo the move: Haoshoku never edits nginx/ufw and refuses when the hand-edited compose differs from its managed file.
- No change to Debian SSH contract (VPS keeps OpenSSH, no Tailscale SSH).
- No rename of `pc`/`laptop`; no uninstall on profile change; no migration of io's existing alt dirs.
- No new live iobox/iobook/VPS changes from this run (the 2026-10-08 Executor move is already done and only documented); live provisioning happens when you run Haoshoku on the box.

## Design
```text
Usage: haoshoku              # on host "iobox": fleet.json -> deviceType iobox -> iobox setup
       haoshoku --device-type iobox | --agent-accounts | --fleet-ssh
Shape: configs/fleet.json -> src/common/fleet.js (load/lookup) -> device_type.js (detect), configure_fleet_ssh.js (ssh), cachyos.js (profile routing)
Binding: fleet.json schema (D13), DEVICE_TYPES incl. iobox, Include-first ssh config, overlay denylist approach
Flow + failure: T3 step -> linger fails (no polkit/sudo) -> iobox setup exits non-zero naming "linger"
We accept: hostnames + tailnet name public, for one simple tracked fleet source
Rejected: OpenSSH+authorized_keys on Arch (io already on Tailscale SSH); renaming pc/laptop (migration churn)
Open: none
```

## Planned PRs (gh stack, in order)
1. `fix(agents)`: PROFILE.md Executor tailnet URL line only (urgent: next run overwrites live line).
2. `feat(device)`: DEVICE_TYPES + iobox, flag, readers, standalone-command refusals (A1, A4).
3. `feat(fleet)`: fleet.json + fleet.js, hostname detection + persist, conflict warning (A2, A3, D13).
4. `feat(arch)`: iobox routing + package list (B5–B7).
5. `feat(t3)`: linger, iobox sleep mask, iobox fail-hard (C8–C10).
6. `feat(fleet-ssh)`: Tailscale SSH, ssh fragment, known_hosts_fleet, fleet guard, `--fleet-ssh` (D11–D12a).
7. `feat(agents)`: `--agent-accounts` overlays (E14).
8. `feat(op)`: op CLI, token drop-in, preflight allowance (F16, F16a).
9. `docs`: fleet section in PROFILE.md/AGENTS.md/CLAUDE.md, README iobox + bring-up checklist, Executor tailnet docs + test (A15, G17–G19).

Release: not applicable by strict predicate (AGENTS.md names no release workflow). Ask at approval.
Evidence: Opus verified io→iobook Tailscale SSH succeeds with host-key checks off, so the tailnet policy already allows unattended SSH; only the stale key blocks it. Gap: Notion "SSH between machines" page not reconciled (Executor tools not loaded in driver session).
