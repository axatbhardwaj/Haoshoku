#!/usr/bin/env bash
if [[ $# == 0 ]]; then
  for scenario in symbolic default symbolic-race; do bash "$0" "$scenario" || exit 1; done
  exit 0
fi
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
if [[ "$1" == symbolic ]]; then
  git -C "$REPO" symbolic-ref refs/heads/alias refs/heads/main
  run_cleanup --apply
  git -C "$REPO" show-ref --verify --quiet refs/heads/main || { echo 'FAIL deleting alias deleted main'; exit 1; }
  git -C "$REPO" symbolic-ref --quiet refs/heads/alias
else
  git -C "$REPO" branch candidate main
  git -C "$REPO" push -q origin candidate
  # shellcheck source=../cleanup-worktrees.sh
  source "$TEST_DIR/cleanup-worktrees.sh"
  plan_branches "$REPO"
  if [[ "$1" == default ]]; then
    git -C "$REPO" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/candidate
  else
    git -C "$REPO" symbolic-ref refs/heads/candidate refs/heads/main
  fi
  apply_branches
  git -C "$REPO" show-ref --verify --quiet refs/heads/main
  git -C "$REPO" show-ref --verify --quiet refs/heads/candidate || { echo 'FAIL changed ref state was not kept'; exit 1; }
fi
echo "PASS $1 branch state protected"
