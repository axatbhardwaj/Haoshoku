# tests/

## Files

| File               | What                          | When to read                              |
| ------------------ | ----------------------------- | ----------------------------------------- |
| `cachyos.test.js`  | CachyOS setup tests           | Testing Arch setup, debugging failures    |
| `common.test.js`   | Common module tests           | Testing shared functionality              |
| `configure_claude_remote_control.test.js` | Claude Remote Control state, deployment, supervisor, linger, and backup tests | Changing Remote Control setup or service lifecycle |
| `utils.test.js`    | Utility function tests        | Testing shell execution, logging          |

## Test

```bash
bun test
```

## Intentionally malformed fixtures

`tests/shell/fixtures/activeworkspace-empty.json` and
`tests/shell/fixtures/clients-malformed.json` are deliberately malformed
parser fixtures. They are excluded from `biome.json` linting because valid
JSON would defeat the failure-handling scenarios they cover.
