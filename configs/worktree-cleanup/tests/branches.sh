#!/usr/bin/env bash
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
for branch in stale moved checked recent; do git -C "$REPO" branch "$branch" main; done
wt work
# Separate checked-out branch, even when its worktree will be removable.
git -C "$REPO" worktree add -q "$FIXTURE/checked" checked
old "$FIXTURE/checked"
local_tip=$(echo local | git -C "$REPO" commit-tree main^{tree} -p main)
git -C "$REPO" branch unpushed "$local_tip"
recent_tip=$(echo recent | GIT_AUTHOR_DATE="$(date -Iseconds)" GIT_COMMITTER_DATE="$(date -Iseconds)" git -C "$REPO" commit-tree main^{tree} -p main)
git -C "$REPO" update-ref refs/heads/recent "$recent_tip"
git -C "$REPO" push -q origin recent
# An unrelated pushed remote ref is enough to preserve every commit.
git -C "$REPO" push -q origin stale
run_cleanup --dry-run
git -C "$REPO" show-ref --verify --quiet refs/heads/stale
# Plan through production functions, then move a tip before executing the plan.
# shellcheck source=../cleanup-worktrees.sh
source "$TEST_DIR/cleanup-worktrees.sh"
GH_OK=1
process_repo "$REPO"
git -C "$REPO" update-ref refs/heads/moved "$local_tip"
apply_plan
[[ ${#ERRORS[@]} == 0 ]] || { echo 'FAIL moved-tip race should be KEEP without errors'; exit 1; }
[[ "${PLAN_KEEP[*]}" == *'branch moved since planning; kept'* ]] || { echo 'FAIL moved branch was not reported KEEP'; exit 1; }
if git -C "$REPO" show-ref --verify --quiet refs/heads/stale; then echo 'FAIL stale pushed branch kept'; exit 1; fi
for branch in main unpushed checked recent moved; do git -C "$REPO" show-ref --verify --quiet "refs/heads/$branch"; done
[[ "$(git -C "$REPO" rev-parse moved)" == "$local_tip" ]]
echo 'PASS stale pushed branches and atomic moved-tip preservation'
