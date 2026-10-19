#!/usr/bin/env bash
# A large real Git listing must not turn registered T3 checkouts into orphans.
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
registered="$T3_WORKTREES_ROOT/project/registered"
git -C "$REPO" worktree add -qb registered "$registered" main
# Force output past pipe capacity after the matching worktree line. An early
# grep -q exit used to give the real Git producer SIGPIPE under pipefail.
reason=$(printf '%100000s' x)
reason=${reason// /x}
for ((padding=0; padding<20; padding++)); do
  git -C "$REPO" worktree add -q --detach "$FIXTURE/z-padding-$padding" main
  git -C "$REPO" worktree lock --reason "$reason" "$FIXTURE/z-padding-$padding"
done
export CLEANUP_REPO_ROOTS="$HOME/absent"
# shellcheck source=../cleanup-worktrees.sh
source "$TEST_DIR/cleanup-worktrees.sh"
failed=0
for ((attempt=0; attempt<5; attempt++)); do
  if ! registered_worktree "$registered"; then
    echo 'FAIL real registered worktree rejected with large listing'; failed=1
  fi
done
report_orphans
for entry in "${PLAN_REVIEW[@]}"; do
  if [[ "$entry" == "$registered|"* ]]; then
    echo 'FAIL registered T3 checkout reported as unregistered'; failed=1
  fi
done
repos=$(discover_repos)
[[ "$repos" == "$registered" ]] || {
  echo 'FAIL T3-only repository discovery missed registered checkout'; failed=1;
}
[[ " ${PLAN_REVIEW[*]} " == *"$T3_WORKTREES_ROOT/project/orphan||unregistered T3 directory (report only)"* ]] || {
  echo 'FAIL genuine orphan was not reported'; failed=1;
}
(( failed == 0 )) || exit 1
echo 'PASS large real Git listing preserves registration, discovery and genuine orphan reports under pipefail'
