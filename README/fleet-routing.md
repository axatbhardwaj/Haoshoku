# Fleet routing policy

Haoshoku owns [`configs/fleet-routing.json`](../configs/fleet-routing.json).
`haoshoku --axstack` copies its exact bytes to the calling account's
`~/.config/haoshoku/fleet-routing.json`. Both Arch and Debian setup already call
this entrypoint. Run install/release verification on all five accounts:
`xzat@io`, `xzat@iobook`, `xzat@iobox`, `xzat@iosatellite`, `root@axat-vps`.
Check each account's existing timer and pool drop-in; do not assume or create
missing timers as part of policy deployment. No live rollout is proven here.

T3 native main UI thread balancing stays enabled. Explicit worker
`environmentId` binds subsequent execution independently of UI placement.
The initial pool is axat-vps/iobox/iosatellite; fallback order adds io/iobook.
Assignment counts rank workers first while eligible measured pool load is at
or below 50%. CPU/RAM fallback limits are 75% on VPS and 85% elsewhere.
Playwright prefers iosatellite among proven browser-capable destinations.
Authentication requires the actual destination session, including io when
required; never transfer credentials. See the shipped Axstack schema and
selector for unknown-load handling and all-overloaded continuation.

Environment identities came from read-only T3 link inventory, not an execution
pilot. Empty capability maps mean unknown. All 25 directed routes (including
local entries) start disabled with null evidence. No verified times, versions,
project IDs, browser/session or closed-lid claims are invented. C5/C6 must
supply host-qualified evidence and current destination facts before enabling
routes. No remote-author-coordinator routes are enabled or proven. The failed
strict all-reference pilot and later VPS-to-iobox reader smoke do not establish
remote author support; the smoke's origin latest TerminalRunId was null and
options were missing. A supported isolated author on the driver's local host
remains the explicit fallback, even if the selector has no proven route.

Deployment validates schema and rejects extra secret/runtime fields before
writing. The Axstack selector independently validates schema, config digest,
capabilities, route evidence and live destination settings before execution.
Neither configuration nor an existing link grants execution eligibility.
Pin the returned SHA-256 to each recommendation and check identical bytes on
all five accounts. Missing source, schema, digest and local conflicts are
explicit setup failures; they must not be mistaken for successful routing.

A differing local policy is preserved until inspected. The programmatic
`deployFleetRouting({ home, source, expectedDigest, expectedPreviousDigest })`
interface in `src/helpers/configure_fleet_routing.js` requires a SHA-256 pin of
those existing bytes before replacement; `configureAxstack({ fleetRouting:
{ ...pins } })` forwards these options. Keep its `fleetRouting` receipt.
Backups use a unique adjacent `.before-<uuid>` path with mode 0600. Reruns of
identical bytes create no backup. To undo only this deployment, call
`deployFleetRouting({ home, rollback: receipt })`: it refuses subsequent edits,
checks the backup digest, restores old bytes/mode, or removes a newly created
policy. It retains the backup for inspection. No unrelated files are reverted.

## Managed-block dependency (C4b)

The global routing hook belongs inside Axstack's installer-owned block.
Haoshoku's shared PROFILE.md and its Claude/Codex mirrors intentionally ship
no Axstack markers. Existing profile sync preserves the exact live block;
backups strip it. Haoshoku neither manufactures ownership hashes nor patches
the block. Axstack uninstall owns block removal and leaves this policy intact.

At Axstack `7b7af36fc86159f9ba399a26805de01a5aaeca37`,
`src/instructions.js:renderInstructionBlock()` still needs the routing reference.
C4b must reference installed `references/fleet-dispatch.md` and
`references/fleet-route-schema.md`, hook `scripts/fleet-route.js` before every
subsequent delegated worker/reviewer and explicitly authorized driver launch,
and bind the account-local config digest. It must preserve explicit worker
targets, supported local fallback and remote-author disablement. The block
must grant no additional top-level launch authority. Verify actual Axstack
install/check/uninstall ownership after profile sync; C4a does not claim this
integration shipped. C5 link preflight and C6 deployment/execution remain the
driver's separate operational verification boundaries.
