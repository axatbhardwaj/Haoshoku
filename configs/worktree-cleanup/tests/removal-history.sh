#!/usr/bin/env bash
if [[ $# == 0 ]]; then
  for scenario in worktree branch; do bash "$0" "$scenario" || exit 1; done
  exit 0
fi
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
orphan=$(echo orphan | git -C "$REPO" commit-tree main^{tree} -p main)
if [[ "$1" == worktree ]]; then
  wt endangered
  git -C "$FIXTURE/endangered" checkout -q --detach
  git -C "$FIXTURE/endangered" reset -q --hard "$orphan"
  git -C "$FIXTURE/endangered" reset -q --hard main
  old "$FIXTURE/endangered"
else
  git -C "$REPO" branch endangered "$orphan"
  git -C "$REPO" update-ref refs/heads/endangered "$(git -C "$REPO" rev-parse main)"
fi
run_cleanup --apply
if [[ "$1" == worktree ]]; then
  assert_exists "$FIXTURE/endangered/.git"
else
  git -C "$REPO" show-ref --verify --quiet refs/heads/endangered || { echo 'FAIL sole branch reflog history discarded'; exit 1; }
fi
# A tag proves this history survives independently of the worktree/ref log.
git -C "$REPO" tag saved "$orphan"
run_cleanup --apply
if [[ "$1" == worktree ]]; then
  assert_absent "$FIXTURE/endangered"
else
  if git -C "$REPO" show-ref --verify --quiet refs/heads/endangered; then echo 'FAIL safe stale ref kept'; exit 1; fi
fi
# Preserve reflog-only commits introduced after the original plan as well.
# shellcheck source=../cleanup-worktrees.sh
source "$TEST_DIR/cleanup-worktrees.sh"
GH_OK=1
other=$(echo later | git -C "$REPO" commit-tree main^{tree} -p main)
if [[ "$1" == worktree ]]; then
  wt late
  old "$FIXTURE/late"
  process_repo "$REPO"
  git -C "$FIXTURE/late" reset -q --hard "$other"
  git -C "$FIXTURE/late" reset -q --hard main
  old "$FIXTURE/late"
  apply_plan
  assert_exists "$FIXTURE/late/.git"
else
  git -C "$REPO" branch late main
  plan_branches "$REPO"
  git -C "$REPO" update-ref refs/heads/late "$other"
  git -C "$REPO" update-ref refs/heads/late "$(git -C "$REPO" rev-parse main)"
  apply_branches
  git -C "$REPO" show-ref --verify --quiet refs/heads/late
fi
[[ ${#ERRORS[@]} == 0 ]]
echo "PASS $1 removal preserves otherwise unreferenced reflog commits at plan and apply"
