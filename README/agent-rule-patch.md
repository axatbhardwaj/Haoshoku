# Scoped correction-rule deployment

Use this command from the reviewed Haoshoku Git checkout with Bun and Git on
PATH. Run it locally on each authorized host. It patches only the correction
rule in the Claude and Codex destinations from the `--agents` manifest:
`<home>/.claude/CLAUDE.md` and `<home>/.codex/AGENTS.md`.

It does not run the full `--agents` sync. Each destination is independent.
An unreachable host must be held by the caller; continue with other hosts.

## Plan and review

Choose a new evidence directory. The command creates it with mode 0700.
Keep that directory for deploy and rollback. Do not change checkout paths
between commands.

```bash
bun scripts/agent-rule-patch.js plan --home /home/xzat --evidence /var/tmp/haoshoku-t16-io
```

The command prints JSON and saves `receipt.json`, `source.before`, `0.before`
and `1.before`. A missing destination has no snapshot and stays held.
Review these files before deployment. The receipt records the hostname,
source path, Git HEAD, source SHA-256, destination paths and before-hashes.
The before-files contain exact bytes and may contain personal instructions;
keep the evidence private.

## Deploy

```bash
bun scripts/agent-rule-patch.js deploy --home /home/xzat --evidence /var/tmp/haoshoku-t16-io
```

Immediately before each write, the command checks the source revision and
bytes, destination bytes and file identity. A difference holds that destination.
It replaces one exact old rule outside the installer-owned Axstack block.
It preserves all other bytes, line endings and file permissions, then reads
the destination back. It saves each successful destination before continuing.
Symlink destinations are held. Do not run another writer concurrently.

The command prints the updated receipt. Successful destinations have
`status: "applied"`, `applied: true` and `afterSha256` from verified readback.
Held destinations have `status: "held"` and `reason`. An already-applied
destination is held on repeated deploy; do not make a new plan to bypass drift.

## Rollback

```bash
bun scripts/agent-rule-patch.js rollback --home /home/xzat --evidence /var/tmp/haoshoku-t16-io
```

Rollback requires this run's successful deployment receipt. It reads each
current destination and reverses only the exact rule that this run applied.
Later unrelated edits and the Axstack block survive. A missing, changed or
ambiguous rule holds that destination. Rollback never restores a whole-profile
snapshot. A successful rollback prints `status: "rolled-back"` and
`applied: false`. It does not require the old source revision to remain HEAD.

All modes exit 0 when every destination succeeds. A held destination or
command-level error exits 2. A command-level error prints a JSON held reason
to stderr. Inspect evidence after an interrupted write or readback failure;
there is no crash-recovery guarantee. The evidence lock prevents concurrent
invocations using the same directory; it does not lock other profile writers.

## Fleet invocation

Run each mode above locally with the corresponding explicit arguments. Verify
the account's actual home before planning. Keep the same reviewed source HEAD
and bytes between plan and deploy. Rollback remains scoped to each host receipt.

| Host | Account home | Evidence directory |
| --- | --- | --- |
| io | `/home/xzat` | `/var/tmp/haoshoku-t16-io` |
| iobook | `/home/xzat` | `/var/tmp/haoshoku-t16-iobook` |
| iobox | `/home/xzat` | `/var/tmp/haoshoku-t16-iobox` |
| iosatellite | `/home/xzat` | `/var/tmp/haoshoku-t16-iosatellite` |
| axat-vps | `/root` | `/var/tmp/haoshoku-t16-axat-vps` |

Deploy only after the owning driver's dependency and authorization gates pass.
This capability was developed with temporary homes; live fleet deployment is
a separate driver action.
