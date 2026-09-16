# tests/

## Files

| File               | What                          | When to read                              |
| ------------------ | ----------------------------- | ----------------------------------------- |
| `cachyos.test.js`  | CachyOS setup tests           | Testing Arch setup, debugging failures    |
| `common.test.js`   | Common module tests           | Testing shared functionality              |
| `configure_claude_remote_control.test.js` | Claude Remote Control state, deployment, supervisor, linger, and backup tests | Changing Remote Control setup or service lifecycle |
| `configure_agent_skills.test.js` | Owned/upstream skill sync, retirement, links, boundaries, and owned-only backup | Changing managed orchestration skills |
| `configure_visual_explainer.test.js` | Visual-explainer theme defaults, persistence, and invalid-config behavior | Changing explainer theme configuration |
| `cli_explainer_theme.test.js` | End-to-end visual-explainer theme CLI behavior | Changing `--explainer-theme` |
| `cli_paseo_tasks.test.js` | End-to-end Paseo task lifecycle defaults, controls, preservation, and fail-closed behavior | Changing Paseo task lifecycle CLI/configuration |
| `cli_server_hermes_relay_flag.test.js` | Debian-only Hermes relay CLI routing and failure propagation | Changing `--server-hermes-relay` |
| `configure_hermes_relay.test.js` | Hermes relay install, preservation, activation, and failure behavior | Changing the Hermes relay helper |
| `configure_paseo_profiles.test.js` | Paseo whitelist merge, lifecycle-safe reload, and backup | Changing managed Paseo policy |
| `hermes_relay_host_boundary.test.js` | VPS enable-marker transport boundary | Changing relay use in shared agent workflows |
| `hermes_relay_publication_transition.test.js` | Published source pin and vendored-removal boundary | Updating the standalone relay release pin |
| `visual_explainer_vendoring.test.js` | Upstream payload revision, file-set, license, and byte digests | Updating the pinned visual-explainer payload |
| `configure_axstack.test.js` | Axstack tarball verification, release layout, shim, no-downgrade, and harness install | Changing the Axstack pin or installer |
| `cli_axstack_flags.test.js` | `--axstack` / `--axstack-check` routing and reporting | Changing the Axstack CLI surface |
| `configure_gaming.test.js`, `cli_gaming.test.js` | Workspace-2 autostart policy defaults, flags, and overlay reconciliation | Changing `--gaming*` |
| `configure_kde_connect.test.js` | KDE Connect device config parsing and `Screens Off` command writes | Changing `--kde-connect-commands` |
| `configure_paseo_schedules.test.js`, `cli_paseo_schedules.test.js`, `paseo_schedule_client.test.js` | Schedule role mapping, check/apply semantics, and scoped client env | Changing `--paseo-schedules*` |
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
