# Plan: iobox profile + tailnet fleet (ticket map)

Spec: #142 rev r4, body sha256 d3f83ab176f0235eb633287f4e2eaed6f1c8eeb063ce693aee14950d111a4840
(counterpart `docs/specs/2026-10-08-iobox-fleet-r4.md`). Store: GitHub issues. Stack: `gh stack`, each task
one PR on the previous, base `stable`. Every author uses strict red-green TDD; pc/laptop and Debian tests stay green.

| Task | Capability | Theme | Size est | Acceptance (spec r4) | Depends |
|---|---|---|---|---|---|
| T1 `fix(agents)` | #143 | PROFILE.md Executor tailnet URL line (the stack base also carries the approved spec and this map as run artifacts) | XS | G17a (Executor line) | none |
| T2 `feat(device)` | #144 | `DEVICE_TYPES` incl. `iobox`; `--device-type` flag; `utils.js` readers; standalone refusals | S | A1, A4 | T1 |
| T3 `feat(fleet)` | #144 | `configs/fleet.json` + `src/common/fleet.js`; hostname detection persisted; stored-conflict warning | S | A2, A3, D13 | T2 |
| T4 `feat(arch)` | #144 | iobox routing in `runCachyOSSetup`; `common/paru_applist_iobox.txt`; skip list incl. device-routed steps (workspaces, hyprmoncfg, audio); user scripts kept | M | A4 (full-setup skip), B5, B6, B7 | T3 |
| T5 `feat(t3)` | #144 | `sudo -n loginctl enable-linger` (all Arch); iobox sleep-target mask; iobox fail-hard | S | C8, C9, C10 | T4 |
| T6 `feat(fleet-ssh)` | #145 | fleet guard; `tailscale set --ssh`; `~/.ssh/config.d/haoshoku-fleet` + Include-first; `known_hosts_fleet`; `--fleet-ssh` | M | D11, D11a, D12, D12a | T5 |
| T7 `feat(agents)` | #146 | `--agent-accounts` overlays (private list, shared rest, codex config seed, conflict reporting) | M | E14 | T6 |
| T8 `feat(op)` | #147 | `1password-cli`; env-file check; `haoshoku-op.conf` drop-in; preflight allowance + fail-closed message | M | F16, F16a | T7 |
| T9 `docs` | #148 | PROFILE/AGENTS/CLAUDE fleet section; README iobox + bring-up checklist; Executor tailnet docs + parser test | S | E15, G17b (fleet section), G18, G19 | T8 |

Implementer notes (T8): the preflight's effective `EnvironmentFiles` check and pending `EnvironmentFile=` check
(`src/helpers/t3_desktop_preflight.js` ~111–143) must both accept only the exact managed path, including systemd's
`(ignore_errors=yes)` suffix; "absent" means lstat ENOENT (dangling symlink, directory or non-regular file fails closed);
"first install" means no managed drop-in exists yet.

Named failure (Design): T3 step -> linger fails -> iobox setup exits non-zero naming "linger" (T5 acceptance).
G17 is split: G17a Executor line (T1), G17b fleet section (T9).
Release after T9 merges (user-approved at the spec gate 2026-10-08, after r4 said "ask at approval"): 12.4.0 release PR, tag, npm + Linux binary verified; no host installs.
