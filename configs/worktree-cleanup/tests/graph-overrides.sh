#!/usr/bin/env bash
if [[ $# == 0 ]]; then
  for kind in graft replace; do bash "$0" "$kind" || exit 1; done
  exit 0
fi
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
orphan=$(echo local-root | git -C "$REPO" commit-tree main^{tree})
main=$(git -C "$REPO" rev-parse main)
if [[ "$1" == graft ]]; then
  mkdir -p "$REPO/.git/info"
  printf '%s %s\n' "$main" "$orphan" > "$REPO/.git/info/grafts"
else
  replacement=$(echo substitute | git -C "$REPO" commit-tree main^{tree} -p "$orphan")
  git -C "$REPO" replace "$main" "$replacement"
fi
wt endangered
git -C "$FIXTURE/endangered" checkout -q --detach "$orphan"
gd=$(git -C "$FIXTURE/endangered" rev-parse --absolute-git-dir)
mv "$FIXTURE/endangered" "$FIXTURE/saved"
touch -d '1 year ago' "$gd/gitdir"
# With the override, an actual local-only commit appears in remote ancestry.
[[ -z "$(git -C "$REPO" rev-list "$orphan" --not --branches --tags --remotes)" ]]
run_cleanup --apply
assert_exists "$gd/HEAD"
echo "PASS $1 cannot fabricate remote/branch reachability for pruning"
