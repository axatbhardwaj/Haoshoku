# src/helpers/

## Claude and Codex config

Haoshoku manages an explicit, portable policy surface:

- `configs/claude/{CLAUDE.md,statusline-command.sh,gitignore.template}`
- `configs/codex/AGENTS.md` and `configs/codex/status-line.toml`

The Codex status-line file contains only `tui.status_line`. `--codex` merges
that value into `~/.codex/config.toml`, preserving other settings and keeping a
private rollback copy before a change. `--codex-backup` exports only that value,
not the full live config. Invalid or ambiguous TOML stops the merge.

The backup commands capture only those files. Runtime state, credentials,
`settings.json`, agents, plugins, and skill directories stay machine-owned.
Deploys never walk either engine's home directory, and a Git-tracked file in
`~/.claude/` wins over the portable baseline.

Use `--claude-backup` and `--codex-backup` after changing the live policy; use
`--claude` and `--codex` to restore it.

## Skills

Haoshoku no longer installs Matt Pocock skills or visual-explainer. The retired
`--skills`, `--skills-update`, `--skills-list`, `--agent-skills`, and
`--explainer-theme` commands fail before setup or run logging. Manage independent
skills separately. Default setup preserves all existing skill directories,
links, and theme preferences. Workflow skills are managed through Axstack.

## Headless T3 Code

| File | Responsibility |
| --- | --- |
| `configure_t3_code_server.js` | Debian runtime, CLI installation, Connect disablement and user service |
| `configure_tailscale_t3.js` | Arch package, daemon, browser login, operator and user-service setup |
| `t3_desktop_preflight.js` | Shared read-only desktop/backend guard before service changes and on reruns |
| `t3_tailscale.js` | Shared CLI floor, drop-in, tailnet HTTPS readiness and pairing guidance |

`configure_tailscale_t3.js` runs after Arch installs T3 and configures the
user's CLI. It installs missing Tailscale, enables its system daemon, waits
for `tailscale up` browser login only for `NeedsLogin`, and sets the current
user as operator. It uses `t3 service install --base-dir <checked-base>` for a missing
boot service, then reconciles service enablement and the HTTPS environment
drop-in. Already-configured machines need no commands that change state or
file rewrites. Failures warn and full setup continues; `--tailscale-t3` reruns
only this step. System changes require non-interactive sudo authorization.
It never enables Funnel and refuses to report public Funnel as tailnet-only.

`configure_t3_code_server.js` owns the required Debian nightly T3 Code service
over Tailscale. It checks the CLI floor, disables existing Connect exposure,
writes the account's service drop-ins, and verifies service and tailnet HTTPS
readiness. Tailscale login, provider authentication, and phone pairing remain
manual prerequisites or follow-up steps. `configure_hermes_relay.js` verifies
Hermes Telegram transport without deploying a relay plugin.

Both entrypoints enforce the [single-backend preflight](../../README.md#t3-single-backend-preflight)
before service writes or operations, including no-op reruns. Desktop settings and
pairing tokens remain untouched; failed evidence probes cannot establish headless state.

See the [migration note](../../README.md#existing-host-migration) for host artifacts
that Haoshoku leaves for manual retirement.


## Run log sharing

| File | Responsibility |
| --- | --- |
| `share_log.js` | Select the latest completed log or an explicit path; send via Taildrop to `io` (or `HAOSHOKU_LOG_TARGET`), fall back to a secret gist or manual instructions |

Sharing runs only for `--share-log [path]`. The receiver uses
`tailscale file get ~/Downloads`; pass the printed filename or gist URL to the
agent. Process execution is injectable for tests, so upload paths can be checked
without live tools or credentials.
