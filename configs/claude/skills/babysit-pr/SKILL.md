---
name: babysit-pr
description: Watch an existing PR; autonomously fix and push after review.
---

# Babysit PR

## Authority

Push authority is granted once, explicitly, when the skill starts (e.g.
"babysit PR #123 and push fixes"). Record it. Nothing escalates beyond it
mid-run: review submission, merging, labels, reruns, and secrets each need
separate explicit authority.

## Loop

Run as a `/loop` with self-paced wakeups. Each tick: query `gh` for CI
status, review threads, and the head SHA. Nothing actionable → sleep.
Actionable → enter one fix cycle. Exactly one fix cycle in flight, ever;
new events queue behind it.

## Fix cycle — sequential; inline workflows are forbidden here

1. **Pin** the remote head SHA the fix is based on.
2. **Classify** trivial (lint, typo, format) vs non-trivial.
3. **Sol implements** in the PR worktree: `sol-wrapper` implementation mode
   with exact scope, prohibited changes, and verification commands; use
   detach-and-wait for long runs. One dispatch fixes all currently known
   issues — never fan out mutators against one worktree.
4. **Verify** the report's verification evidence yourself; the diff must
   touch only in-scope paths.
5. **Opus reviews**: spawn `opus-reviewer`, cold, with the diff and report.
   A material finding gets one remediation round through Sol. A second
   failure stops the cycle and notifies the user — never push.
6. **Push gate**: the remote head must still equal the pinned SHA;
   otherwise discard the local result and restart the cycle against the new
   head. Never force-push. Push, reread GitHub, report the commit SHA.

## Invariants

- Single mutator: only this fix cycle commits or pushes to the worktree;
  every review agent is read-only.
- The Opus gate is structural: the push step is unreachable except through
  a `pass` verdict.
- Stop conditions, each ending the loop with a notification: PR merged
  (success); PR closed unmerged; two consecutive failed fix cycles; head
  churn showing a human actively working.
