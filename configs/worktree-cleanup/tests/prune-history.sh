#!/usr/bin/env bash
if [[ $# == 0 ]]; then
  for scenario in mount reflog operation; do bash "$0" "$scenario" || exit 1; done
  exit 0
fi
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
wt endangered
git -C "$FIXTURE/endangered" checkout -q --detach
orphan=$(echo orphan | git -C "$REPO" commit-tree main^{tree} -p main)
git -C "$FIXTURE/endangered" reset -q --hard "$orphan"
if [[ "$1" == reflog ]]; then git -C "$FIXTURE/endangered" reset -q --hard main; fi
gd=$(git -C "$FIXTURE/endangered" rev-parse --absolute-git-dir)
if [[ "$1" == operation ]]; then
  mkdir "$gd/sequencer"
  git -C "$REPO" tag saved "$orphan"
fi
mv -- "$FIXTURE/endangered" "$FIXTURE/saved"
# A volume's empty mount point still exists, but Git calls it prunable.
if [[ "$1" == mount ]]; then mkdir "$FIXTURE/endangered"; fi
touch -d '1 year ago' "$gd/gitdir"
git -C "$REPO" worktree list --porcelain | grep -q '^prunable '
run_cleanup --dry-run
grep -q 'unreferenced commits' "$FIXTURE/report.html" || { echo "FAIL $1 did not REVIEW endangered registration"; exit 1; }
run_cleanup --apply
assert_exists "$gd/HEAD"
assert_exists "$gd/logs/HEAD"
# Tagging the only local commit makes every HEAD/reflog commit reachable.
if [[ "$1" == operation ]]; then
  mv "$gd/sequencer" "$FIXTURE/saved-sequencer"
else
  git -C "$REPO" tag saved "$orphan"
fi
run_cleanup --apply
assert_absent "$gd"
echo "PASS prunable $1 registration protects all HEAD/reflog commits"
