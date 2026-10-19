#!/usr/bin/env bash
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
wt locked
old "$FIXTURE/locked"
git -C "$REPO" worktree lock --reason 'fixture active lease' "$FIXTURE/locked"
if ! run_cleanup --apply; then echo 'FAIL locked worktree failed the job'; exit 1; fi
assert_exists "$FIXTURE/locked"
grep -q 'locked' "$FIXTURE/report.html"
# A lock acquired after planning is also a benign KEEP race.
wt late-lock
old "$FIXTURE/late-lock"
# shellcheck source=../cleanup-worktrees.sh
source "$TEST_DIR/cleanup-worktrees.sh"
GH_OK=1
process_repo "$REPO"
git -C "$REPO" worktree lock "$FIXTURE/late-lock"
apply_plan
[[ ${#ERRORS[@]} == 0 ]] || { echo 'FAIL late lock was reported as an error'; exit 1; }
assert_exists "$FIXTURE/late-lock"
echo 'PASS locked worktrees kept at planning and execution'
