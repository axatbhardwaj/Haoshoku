# Axstack migration runbook

Preparation draft for [approved spec r2](https://github.com/axatbhardwaj/Haoshoku/issues/63) and [T4](https://github.com/axatbhardwaj/Haoshoku/issues/66). This is not a record of completed migration. Source changes, release verification and per-host checks below must finish before rollout. Execute IO first, then VPS.

## Release and execution gate

Record the human-merged Axstack feature commit, release tag, downloaded tarball SHA-256, installed package identity, and the Haoshoku integration commit/release. The feature release must support owned instruction blocks; Axstack 0.5.0 does not. Do not substitute the old inspected checkout or a moving latest URL. Revalidate each package's CLI help before using newly introduced options.

One driver on IO coordinates the run. One executor mutates a host at a time. Record its session, host and item list privately. Never run the complete OS setup as a shortcut for this migration: unrelated desktop and service operations are outside the task.

Do not proceed if the required release is unavailable, downloaded bytes differ, the intended host is ambiguous, the target contains conflicting ownership, or dependent active work cannot tolerate retirement. Continue safe checks on independent items and report the held item explicitly.

## Private evidence and recovery bundle

Use a new private run directory on each host, with access restricted to its owner. Record configuration values only as needed for restoration; never paste credentials, prompts, session records or full configuration into issues, logs or screenshots.

Before each change, preserve exact relevant bytes, permissions, link destinations, installed package identity, manifest bindings and service/schedule state. Backups that contain credentials remain private. Capture hashes and existence for protected files so before/after comparisons do not expose their content. Record absence too, so rollback can distinguish a newly created artifact.

| Field | Required content |
| --- | --- |
| Item | Exact path, unit instance or schedule identity, kept privately |
| Role | Agreed retired role, retained prerequisite, or unknown |
| Provenance | Shipped-byte match, exact installation receipt, or unit plus verified helper-byte match |
| Current state | Existence, enabled/active state, relevant consumers and ownership binding |
| Replacement | Installed feature and its verification evidence |
| Disposition | Preserve, retire, or hold with a reason |
| Recovery | Backup reference and bounded restoration action |
| Executor | Actual session and host |
| Result | Before/after checks, remaining dependencies and limitations |

Names or markers alone do not prove ownership. A retained Paseo unit can be Haoshoku-owned and must still be retained. A failed provenance or dependency check leaves the item intact and its retirement incomplete.

## Inventory before changing anything

1. Verify host identity and CLI paths/versions for Axstack, Claude Code, Codex, Paseo, Bun and gh/gh-stack. Resolve wrappers to their package location without executing installation or exposing environment files.
2. Inspect each existing Axstack manifest and its profile-file binding. Retain an existing shared-directory binding; do not pass the same profile file to an installation in another skills root. Preserve independently managed OpenCode targets.
3. Inventory Claude/Codex instruction files, skill roots, old task/theme configuration and installed legacy helpers. Check native Paseo skills and independent specialist skills separately.
4. Inventory exact user/system service instances, enabled state and consumers. Template presence is not an active instance. Keep the Paseo runtime and phone connectivity.
5. Query live Paseo schedules through its supported CLI/API. Compare saved Haoshoku mappings with actual objects and their current purpose. A mapping is a candidate list, not a deletion command. Preserve unmapped schedules unless positive evidence establishes approved legacy ownership.
6. Inventory AI-only desktop/editor entries and extra applications. Mixed files and independently installed applications are not removed wholesale. Keep unrelated desktop behavior and necessary Paseo access.

The preparation snapshot found IO's Claude Remote Control and stay-awake unit bytes matching bundled templates. It found three mapped VPS schedules among eight active schedules, and unverified system Claude services. These are historical findings to recheck, not permanent allowlists.

## Install and verify replacement

Use the reviewed Haoshoku Axstack setup entry point with explicit targets. New supported harness targets are Claude and Codex. Preserve user-managed/newer installations and existing model choices; do not force adoption or downgrade.

Verify the installed release identity and package bytes. Run `axstack check` for prerequisites, then separately prove skill discovery from the selected harnesses. Verify that each instruction pointer resolves to the installed Axstack entry and that the model/profile choices have not been replaced by stale defaults.

Axstack must preserve text outside its owned instruction block. Existing unmarked routing prose remains unowned: archive and replace only a verified legacy section as an explicit migration action. Personal preferences stay byte-identical. Duplicate/malformed markers or edited/unknown blocks hold conversion; never use force as a generic migration fix.

After necessary profile file changes, apply only the documented runtime reload path and verify live profile readback. Preserve active agents. If activation requires a disruptive restart, record deferred activation and hold dependent cleanup; file installation alone is not success.

## Retire verified legacy items

Only proceed after replacement checks pass for the affected capability.

- **Skills and configuration:** archive positively identified legacy entries outside every active discovery root. Remove only verified managed links. Preserve independent specialist/native Paseo skills, credentials, sessions and unrelated instructions. Do not wipe `.agents`, `.claude`, `.codex` or `.paseo`.
- **Services:** verify the exact instance and current consumer graph. Stop the approved legacy instance, disable future activation, archive its verified unit/helper/settings, reload the relevant service manager and read back inactive/disabled or absent state. Never stop the driver transport or required Paseo runtime. Shared binaries/user data remain unless separately proven safe and in scope.
- **Schedules:** verify exact object identity, legacy purpose and lack of current dependencies. Save a private restorable definition, pause the schedule, verify it is paused, then retire it only when restoration and consumer checks are complete. Preserve unmapped/custom schedules. Do not use a name match or delete/recreate unrelated objects.
- **Desktop/editor integration:** apply narrow approved entry removal, preserving general files and bindings. Load the installed `omarchy` skill instructions before live desktop customization; if unavailable, hold that desktop step. Recheck affected behavior; no desktop restart merely to simplify evidence collection.

Hermes and T3 are retirement candidates. If active users, agents, notification delivery or other consumers depend on them, hold only their retirement and report why. Their absence from the new installer does not automatically stop them. Unknown system Claude services remain intact until positive provenance establishes that they are in scope.

## Failure and recovery

If replacement fails, do not begin legacy cleanup. Preserve the functioning installation and report the exact failed step. If a later migration action fails, stop that item, compare actual state with the saved snapshot and restore only this run's changes when safe. Do not restore a whole configuration file over newer concurrent user changes.

Restore archived assets with their original permissions and link destinations. Restore service enablement/activity only when it existed before and no newer host change conflicts. Schedule restoration must account for object identity; if only recreation is supported, record the new identity and repair only this run's references before claiming recovery. Never blindly replay schedule creation after an ambiguous response.

A failed restore is a recovery hold with named affected items. Do not count a backup's existence, command exit code, or partial service state as successful recovery.

## Host acceptance and completion

Verify after the final mutation, and retain separate evidence for:

- release/installed bytes and CLI versions;
- actual Claude/Codex skill and instruction discovery;
- live Paseo profiles, agent continuity and phone connectivity;
- retired items absent from active discovery/activation;
- preserved items and protected configuration unchanged;
- schedules and services in their intended final state;
- repeated reviewed setup unable to restore the old AI workflow.

Publish only a sanitized summary: counts retired/preserved/held, checks passed, release identities and remaining gaps. Keep exact host IDs, paths, definitions and backups private. Mark IO complete only when its applicable checks pass; then start VPS. A held item is explicitly incomplete and prevents a blanket claim of complete legacy retirement. Close the overall capability only after required PR merges, release evidence and both host acceptance receipts exist.
