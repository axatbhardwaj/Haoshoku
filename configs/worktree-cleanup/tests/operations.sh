#!/usr/bin/env bash
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
for state in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_START BISECT_LOG sequencer; do
  name="op-$state"
  wt "$name"
  git -C "$FIXTURE/$name" checkout -q --detach
  gd=$(git -C "$FIXTURE/$name" rev-parse --absolute-git-dir)
  case "$state" in
    rebase-*|sequencer) mkdir "$gd/$state" ;;
    *) git -C "$REPO" rev-parse main > "$gd/$state" ;;
  esac
  mkdir "$FIXTURE/$name/target"
  old "$FIXTURE/$name"
done
run_cleanup --apply
for state in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_START BISECT_LOG sequencer; do
  assert_exists "$FIXTURE/op-$state/target"
done
# An actual merge --no-commit must be KEEP, rather than dirty REVIEW.
wt merging
side=$(echo side | git -C "$REPO" commit-tree main^{tree} -p main)
git -C "$REPO" branch side "$side"
git -C "$FIXTURE/merging" merge --no-commit --no-ff side >/dev/null 2>&1
old "$FIXTURE/merging"
# shellcheck source=../cleanup-worktrees.sh
source "$TEST_DIR/cleanup-worktrees.sh"
GH_OK=1
process_repo "$REPO"
[[ "${PLAN_KEEP[*]}" == *"$FIXTURE/merging|"* ]] || { echo 'FAIL actual merge was not KEEP'; exit 1; }
# Operation state can appear after planning, without touching HEAD/index mtimes.
wt late
old "$FIXTURE/late"
process_repo "$REPO"
gd=$(git -C "$FIXTURE/late" rev-parse --absolute-git-dir)
echo main > "$gd/BISECT_START"
do_remove "$REPO" "$FIXTURE/late" late
assert_exists "$FIXTURE/late"
wt open-late-cache
mkdir "$FIXTURE/open-late-cache/target"
old "$FIXTURE/open-late-cache"
process_repo "$REPO"
gd=$(git -C "$FIXTURE/open-late-cache" rev-parse --absolute-git-dir)
echo main > "$gd/CHERRY_PICK_HEAD"
apply_caches
assert_exists "$FIXTURE/open-late-cache/target"
[[ ${#ERRORS[@]} == 0 ]]
echo 'PASS every operation marker protects idle worktrees and caches, including apply races'
