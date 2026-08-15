---
name: create-pr
description: Local changes ready to become GitHub pull requests.
---

# Create PR

## Gates — all must pass before any push

- Confirm scope, base branch, repository, and explicit GitHub write
  authorization; preserve unrelated work.
- Require fresh implement-work evidence (Opus `pass` + Sol report) covering
  the exact base/HEAD. Material findings block push and PR.

## Sizing

- Size with `git diff --numstat` (additions + deletions), excluding
  binaries, generated files, vendored code, and lockfiles.
- ≤1,500 LOC: `gh pr create --draft`.
- Above 1,500 LOC: require the official `github/gh-stack` extension only
  (install if absent; verify local `submit --help` shows `--auto` drafts).
  Stack bottom-to-top; each layer independently reviewable, independently
  testable, ≤1,500 LOC; submit with `--auto`; never `--open`.
- Missing stack access or no safe decomposition blocks — never open an
  oversized PR.

## PR copy

- Dispatch `luna-wrapper` (implementation mode) writing only a declared
  local copy file. Its packet carries per-layer evidence: ranges and
  numstats, commits and hunks, linked issues, checks, risks, and the stack
  map. Reject path-only packets.
- Luna returns per-layer title and body: Summary / Why / Changes /
  Verification / Risks, plus the stack review order.
- Verify Luna's claims against git yourself, create the drafts, apply the
  copy, then reread GitHub state to confirm.

## Workflow rule

When a phase fans out (≥3 concurrent agents), author an inline Workflow at
dispatch time. Single-dispatch phases use direct Agent/seat calls. Never put
approval gates, adjudication, or user decisions inside a workflow.

Merging is out of scope.
