#!/usr/bin/env bash
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
for branch in merged dirty unpushed open-pr in-use recent; do wt "$branch"; old "$FIXTURE/$branch"; done
echo dirty >> "$FIXTURE/dirty/file"
echo local >> "$FIXTURE/unpushed/file"
git -C "$FIXTURE/unpushed" commit -qam local
old "$FIXTURE/unpushed"
recent_gitdir=$(git -C "$FIXTURE/recent" rev-parse --absolute-git-dir)
touch "$recent_gitdir/HEAD"
git -C "$REPO" worktree add -q --detach "$REPO/.git/axstack/runs/x/checkouts/reviewer" main
old "$REPO/.git/axstack/runs/x/checkouts/reviewer"
# A T3 worktree discovers its owning repo even outside the configured roots.
git clone -q "$FIXTURE/remote.git" "$FIXTURE/outside"
git -C "$FIXTURE/outside" worktree add -qb t3 "$T3_WORKTREES_ROOT/project/t3" main
old "$T3_WORKTREES_ROOT/project/t3"
(cd "$FIXTURE/in-use" && exec sleep 120) &
busy_pid=$!
trap 'kill "$busy_pid" 2>/dev/null || true' EXIT
index=$(git -C "$FIXTURE/open-pr" rev-parse --git-path index)
before=$(stat -c %Y "$index")
run_cleanup --dry-run
assert_exists "$FIXTURE/merged"
grep -q 'unregistered T3 directory' "$FIXTURE/report.html"
run_cleanup --apply
assert_absent "$FIXTURE/merged"
assert_absent "$REPO/.git/axstack/runs/x/checkouts/reviewer"
assert_absent "$T3_WORKTREES_ROOT/project/t3"
for branch in dirty unpushed open-pr in-use recent; do assert_exists "$FIXTURE/$branch"; done
assert_exists "$T3_WORKTREES_ROOT/project/orphan"
[[ "$(stat -c %Y "$index")" == "$before" ]] || { echo 'FAIL git probe refreshed index'; exit 1; }
echo 'PASS worktree activity, discovery, dry-run and removal guards'
