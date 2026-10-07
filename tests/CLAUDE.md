# tests/

## Files

| File               | What                          | When to read                              |
| ------------------ | ----------------------------- | ----------------------------------------- |
| `cachyos.test.js`  | CachyOS setup tests           | Testing Arch setup, debugging failures    |
| `common.test.js`   | Common module tests           | Testing shared functionality              |
| `skills_retirement.test.js` | All five retired families: CLI forms, default setup and repeated-run preservation with retained tools | Changing integration retirement boundaries |
| `skills_packaging.test.js` | npm payload excludes all five retired families of helpers and assets while retaining agent tools | Changing package contents |
| `cli_removed_flags.test.js` | Unknown-option rejection of retired CLI flags before helpers, processes, or services run | Extending the removed-flag table |
| `executor_clients.test.js` | Real CLI/filesystem fixtures for Claude/Codex env auth, preservation, conflicts, reruns and write faults | Changing client setup and credential safety |
| `cli_server_executor_flag.test.js` | Explicit HTTPS origin, opt-in route, host/mode refusals and safe run logs | Changing Executor CLI behavior |
| `configure_executor_server.test.js` | Disposable data/command/probe fixtures for fresh, rerun, conflict and incomplete Executor setup | Changing Executor provisioning, preservation or readiness |
| `cli_server_hermes_relay_flag.test.js` | Debian-only Hermes relay CLI routing and failure propagation | Changing `--server-hermes-relay` |
| `configure_hermes_relay.test.js` | Hermes bootstrap, plugin-free readiness, preservation, and failure behavior | Changing the Hermes relay helper |
| `configure_axstack.test.js` | Axstack tarball verification, release layout, shim, no-downgrade, and harness install | Changing the Axstack pin or installer |
| `cli_axstack_flags.test.js` | `--axstack` / `--axstack-check` routing and reporting | Changing the Axstack CLI surface |
| `configure_split_lock_sudoers.test.js` | Split-lock sudoers rule contents, visudo gate, and staging cleanup | Changing `--gaming-split-lock` |
| `configure_gaming.test.js`, `cli_gaming.test.js` | Workspace-2 autostart policy defaults, flags, and overlay reconciliation | Changing `--gaming*` |
| `configure_discord_theme.test.js` | Discord theme deploy across Vesktop/Vencord clients, manifest validation, and shipped-manifest validity | Changing `--discord-theme` |
| `configure_kde_connect.test.js` | KDE Connect device config parsing and `Screens Off` command writes | Changing `--kde-connect-commands` |
| `run_log.test.js`, `run_log_commands.test.js`, `share_log.test.js` | Run log privacy, retention, redaction, command diagnostics, summaries and explicit sharing | Changing logging or `--share-log` |
| `t3_desktop_preflight.test.js` | Both public T3 entrypoints: default-enabled refusal, directory and probe failures, desktop signals, headless/disabled passes, rerun and settings/token preservation | Changing T3 single-backend preflight |
| `utils.test.js`    | Utility function tests        | Testing shell execution, logging          |

Most other tests are named after the helper, script, or CLI flag they cover
(`configure_<x>.test.js`, `cli_<flag>.test.js`, `haoshoku_<script>.test.js`).

## Test

```bash
bun test
```

## Intentionally malformed fixtures

`tests/shell/fixtures/activeworkspace-empty.json` and
`tests/shell/fixtures/clients-malformed.json` are deliberately malformed
parser fixtures. They are excluded from `biome.json` linting because valid
JSON would defeat the failure-handling scenarios they cover.
