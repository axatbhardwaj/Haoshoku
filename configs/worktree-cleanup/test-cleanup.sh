#!/usr/bin/env bash
# Unit tests for the pure decide() function in cleanup-worktrees.sh
#
# decide() is a PURE function: it maps a set of facts about a worktree to a
# verdict, with no side effects and no I/O. That is what makes it testable
# offline (no git, no gh, no network). The git/gh/filesystem plumbing lives in
# collect_facts()/execute() and is verified separately via --dry-run on the
# real inventory.
#
# Contract:
#   decide <is_main> <dirty> <detached> <unpushed> <pr_state> <merged_into_base> <has_artifacts>
#     booleans are 1/0; pr_state is one of MERGED|CLOSED|OPEN|NONE|UNKNOWN
#     has_artifacts = 1 when the worktree holds a non-empty gitignored
#                     superpowers/ dir (research/plans/review HTML — the only
#                     local copy; must never be auto-removed)
#   echoes exactly one of:  KEEP | REMOVE | REVIEW:<reason>
#
# Run:  bash test-cleanup.sh   (exit 0 = all pass)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/cleanup-worktrees.sh"

pass=0
fail=0
check() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    pass=$((pass + 1))
    printf '  ok   %s\n' "$desc"
  else
    fail=$((fail + 1))
    printf '  FAIL %s\n         expected: %q\n         actual:   %q\n' "$desc" "$expected" "$actual"
  fi
}

echo "decide() fact-table:"

# --- protection: the primary worktree is never touched, even if merged --------
check "main worktree kept even when its PR is merged" \
  "KEEP" "$(decide 1 0 0 0 MERGED 1 0)"

# --- dirty beats everything (uncommitted work must be reviewed) ----------------
check "dirty worktree reviewed even with merged PR" \
  "REVIEW:uncommitted changes" "$(decide 0 1 0 0 MERGED 1 0)"

# --- detached HEAD is always reviewed (commits on no branch) -------------------
check "detached HEAD reviewed (unmerged)" \
  "REVIEW:detached HEAD" "$(decide 0 0 1 0 NONE 0 0)"
check "detached HEAD reviewed even if merged into base" \
  "REVIEW:detached HEAD" "$(decide 0 0 1 0 NONE 1 0)"

# --- open PR means active work: keep ------------------------------------------
check "open PR kept" \
  "KEEP" "$(decide 0 0 0 0 OPEN 0 0)"
check "open PR kept even with unpushed commits" \
  "KEEP" "$(decide 0 0 0 1 OPEN 0 0)"

# --- unpushed local commits must be reviewed (the def-815 case) ----------------
check "unpushed commits reviewed (no PR)" \
  "REVIEW:unpushed commits" "$(decide 0 0 0 1 NONE 0 0)"
check "SAFETY: merged PR but unpushed local commits -> review, never remove" \
  "REVIEW:unpushed commits" "$(decide 0 0 0 1 MERGED 1 0)"

# --- merged PR, clean, pushed, no artifacts: the green path -------------------
check "merged PR + clean + pushed -> remove" \
  "REMOVE" "$(decide 0 0 0 0 MERGED 1 0)"
check "merged PR authoritative even if local base not updated" \
  "REMOVE" "$(decide 0 0 0 0 MERGED 0 0)"

# --- closed-unmerged PR: reviewed, not removed (abandoned, may hold code) ------
check "closed-unmerged PR reviewed" \
  "REVIEW:PR closed unmerged" "$(decide 0 0 0 0 CLOSED 0 0)"

# --- no PR: fall back to local merge status -----------------------------------
check "no PR but merged into base -> remove" \
  "REMOVE" "$(decide 0 0 0 0 NONE 1 0)"
check "no PR and unmerged -> review" \
  "REVIEW:no PR, unmerged" "$(decide 0 0 0 0 NONE 0 0)"

# --- gh unavailable: degrade to local merge status, flag it -------------------
check "gh unavailable + merged into base -> remove" \
  "REMOVE" "$(decide 0 0 0 0 UNKNOWN 1 0)"
check "gh unavailable + unmerged -> review (flagged)" \
  "REVIEW:gh unavailable, unmerged" "$(decide 0 0 0 0 UNKNOWN 0 0)"

# --- ARTIFACT GUARD: gitignored superpowers/ docs are the only local copy -----
check "SAFETY: merged PR but local superpowers/ artifacts -> review, never remove" \
  "REVIEW:local ./superpowers/ artifacts" "$(decide 0 0 0 0 MERGED 1 1)"
check "SAFETY: no-PR merged-into-base but artifacts -> review, never remove" \
  "REVIEW:local ./superpowers/ artifacts" "$(decide 0 0 0 0 NONE 1 1)"
check "gh unavailable + merged + artifacts -> review artifacts" \
  "REVIEW:local ./superpowers/ artifacts" "$(decide 0 0 0 0 UNKNOWN 1 1)"
check "artifacts do NOT override an open PR (still keep)" \
  "KEEP" "$(decide 0 0 0 0 OPEN 0 1)"
check "artifacts do NOT override main worktree (still keep)" \
  "KEEP" "$(decide 1 0 0 0 MERGED 1 1)"
check "dirty takes precedence over artifacts reason" \
  "REVIEW:uncommitted changes" "$(decide 0 1 0 0 MERGED 1 1)"
check "unpushed takes precedence over artifacts reason" \
  "REVIEW:unpushed commits" "$(decide 0 0 0 1 MERGED 1 1)"
check "closed-unmerged + artifacts still reports closed reason" \
  "REVIEW:PR closed unmerged" "$(decide 0 0 0 0 CLOSED 0 1)"

echo "----"
printf '%d passed, %d failed\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
