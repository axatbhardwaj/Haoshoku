# tests/

## Files

| File               | What                          | When to read                              |
| ------------------ | ----------------------------- | ----------------------------------------- |
| `cachyos.test.js`  | CachyOS setup tests           | Testing Arch setup, debugging failures    |
| `common.test.js`   | Common module tests           | Testing shared functionality              |
| `configure_claude_remote_control.test.js` | Claude Remote Control state, deployment, supervisor, linger, and backup tests | Changing Remote Control setup or service lifecycle |
| `configure_agent_skills.test.js` | Pinned-upstream skill sync, retirement, links, and preservation boundaries | Changing managed skills |
| `configure_visual_explainer.test.js` | Visual-explainer theme defaults, persistence, and invalid-config behavior | Changing explainer theme configuration |
| `cli_removed_flags.test.js` | Unknown-option rejection of retired CLI flags before helpers, processes, or services run | Extending the removed-flag table |
| `cli_explainer_theme.test.js` | End-to-end visual-explainer theme CLI behavior | Changing `--explainer-theme` |
| `cli_server_hermes_relay_flag.test.js` | Debian-only Hermes relay CLI routing and failure propagation | Changing `--server-hermes-relay` |
| `configure_hermes_relay.test.js` | Hermes bootstrap, plugin-free readiness, preservation, and failure behavior | Changing the Hermes relay helper |
| `visual_explainer_vendoring.test.js` | Upstream payload revision, file-set, license, and byte digests | Updating the pinned visual-explainer payload |
| `configure_axstack.test.js` | Axstack tarball verification, release layout, shim, no-downgrade, and harness install | Changing the Axstack pin or installer |
| `cli_axstack_flags.test.js` | `--axstack` / `--axstack-check` routing and reporting | Changing the Axstack CLI surface |
| `configure_split_lock_sudoers.test.js` | Split-lock sudoers rule contents, visudo gate, and staging cleanup | Changing `--gaming-split-lock` |
| `configure_gaming.test.js`, `cli_gaming.test.js` | Workspace-2 autostart policy defaults, flags, and overlay reconciliation | Changing `--gaming*` |
| `configure_discord_theme.test.js` | Discord theme deploy across Vesktop/Vencord clients, manifest validation, and shipped-manifest validity | Changing `--discord-theme` |
| `configure_kde_connect.test.js` | KDE Connect device config parsing and `Screens Off` command writes | Changing `--kde-connect-commands` |
| `run_log.test.js`, `run_log_commands.test.js`, `share_log.test.js` | Run log privacy, retention, redaction, command diagnostics, summaries and explicit sharing | Changing logging or `--share-log` |
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
