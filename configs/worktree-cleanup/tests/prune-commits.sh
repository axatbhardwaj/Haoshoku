#!/usr/bin/env bash
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
wt missing-detached
git -C "$FIXTURE/missing-detached" checkout -q --detach
commit=$(echo orphan | git -C "$REPO" commit-tree main^{tree} -p main)
git -C "$FIXTURE/missing-detached" reset -q --hard "$commit"
gitdir=$(git -C "$FIXTURE/missing-detached" rev-parse --absolute-git-dir)
mv -- "$FIXTURE/missing-detached" "$FIXTURE/moved"
touch -d '1 year ago' "$gitdir/gitdir"
# One unsafe registration blocks pruning the whole repo, including safe ones.
wt missing-safe
safe_gitdir=$(git -C "$FIXTURE/missing-safe" rev-parse --absolute-git-dir)
mv -- "$FIXTURE/missing-safe" "$FIXTURE/moved-safe"
touch -d '1 year ago' "$safe_gitdir/gitdir"
run_cleanup --apply
assert_exists "$gitdir/HEAD"
assert_exists "$safe_gitdir/HEAD"
grep -q 'prunable worktree has unreferenced commits' "$FIXTURE/report.html"
# Once a ref preserves the commit, ordinary git defaults may prune both.
git -C "$REPO" tag saved "$commit"
run_cleanup --apply
assert_absent "$gitdir"
assert_absent "$safe_gitdir"
echo 'PASS missing detached commits retain all registrations until a ref preserves them'
