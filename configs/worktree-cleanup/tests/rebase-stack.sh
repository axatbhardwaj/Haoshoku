#!/usr/bin/env bash
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
wt top
echo lower > "$FIXTURE/top/lower"
git -C "$FIXTURE/top" add lower
git -C "$FIXTURE/top" commit -qm lower
git -C "$REPO" branch lower top
echo upper > "$FIXTURE/top/upper"
git -C "$FIXTURE/top" add upper
git -C "$FIXTURE/top" commit -qm upper
git -C "$REPO" push -q origin top lower
if git -C "$FIXTURE/top" rebase --force-rebase --update-refs --exec false main > "$FIXTURE/rebase.log" 2>&1; then
  echo 'FAIL expected stopped stacked rebase'; exit 1
fi
gd=$(git -C "$FIXTURE/top" rev-parse --absolute-git-dir)
grep -Fxq refs/heads/lower "$gd/rebase-merge/update-refs"
old "$FIXTURE/top"
mkdir "$FIXTURE/top/target"
run_cleanup --apply
assert_exists "$gd/rebase-merge/update-refs"
assert_exists "$FIXTURE/top/target"
git -C "$REPO" show-ref --verify --quiet refs/heads/lower || { echo 'FAIL stacked rebase branch deleted'; exit 1; }
echo 'PASS idle rebase --update-refs worktree, cache and stacked branch survive'
