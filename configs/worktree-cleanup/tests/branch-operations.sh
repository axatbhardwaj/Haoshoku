#!/usr/bin/env bash
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
wt rebasing
echo feature > "$FIXTURE/rebasing/feature"
git -C "$FIXTURE/rebasing" add feature
git -C "$FIXTURE/rebasing" commit -qm feature
git -C "$FIXTURE/rebasing" push -q origin rebasing
if git -C "$FIXTURE/rebasing" rebase --force-rebase --exec false main > "$FIXTURE/rebase.log" 2>&1; then
  echo 'FAIL expected rebase exec stop'; exit 1
fi
# Git itself refuses to delete the branch used by this detached worktree.
if git -C "$REPO" branch -d rebasing > "$FIXTURE/delete.log" 2>&1; then
  echo 'FAIL fixture did not produce a branch in use'; exit 1
fi
for name in applying bisecting; do
  wt "$name"
  git -C "$FIXTURE/$name" checkout -q --detach
  gd=$(git -C "$FIXTURE/$name" rev-parse --absolute-git-dir)
  if [[ "$name" == applying ]]; then
    mkdir -p "$gd/rebase-apply"
    echo refs/heads/applying > "$gd/rebase-apply/head-name"
  else
    echo bisecting > "$gd/BISECT_START"
  fi
done
run_cleanup --apply
for name in rebasing applying bisecting; do
  git -C "$REPO" show-ref --verify --quiet "refs/heads/$name" || { echo "FAIL deleted $name during operation"; exit 1; }
done
# Apply must recheck a branch that entered a detached operation after planning.
git -C "$REPO" branch late main
# shellcheck source=../cleanup-worktrees.sh
source "$TEST_DIR/cleanup-worktrees.sh"
plan_branches "$REPO"
gd=$(git -C "$FIXTURE/bisecting" rev-parse --absolute-git-dir)
echo late > "$gd/BISECT_START"
apply_branches
git -C "$REPO" show-ref --verify --quiet refs/heads/late
echo 'PASS rebase and bisect branches protected during planning and application'
