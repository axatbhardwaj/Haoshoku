#!/usr/bin/env bash
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
GIT_COMMITTER_DATE="$(date -Iseconds)" git -C "$REPO" branch fresh main
run_cleanup --apply
git -C "$REPO" show-ref --verify --quiet refs/heads/fresh || { echo 'FAIL fresh branch on old tip deleted'; exit 1; }
# A reflog update to the same old tip after planning also renews activity.
git -C "$REPO" branch renewed main
# shellcheck source=../cleanup-worktrees.sh
source "$TEST_DIR/cleanup-worktrees.sh"
plan_branches "$REPO"
other=$(echo renewed | git -C "$REPO" commit-tree main^{tree} -p main)
GIT_COMMITTER_DATE="$(date -Iseconds)" git -C "$REPO" update-ref refs/heads/renewed "$other"
GIT_COMMITTER_DATE="$(date -Iseconds)" git -C "$REPO" update-ref refs/heads/renewed main
apply_branches
git -C "$REPO" show-ref --verify --quiet refs/heads/renewed || { echo 'FAIL newly renewed branch deleted'; exit 1; }
echo 'PASS branch staleness includes reflog update time'
