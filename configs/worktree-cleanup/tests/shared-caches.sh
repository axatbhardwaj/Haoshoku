#!/usr/bin/env bash
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
wt open-owner
wt open-consumer
mkdir -p "$REPO/node_modules" "$FIXTURE/open-owner/node_modules" "$FIXTURE/open-owner/target"
echo deps > "$REPO/node_modules/data"
echo deps > "$FIXTURE/open-owner/node_modules/data"
ln -s "$FIXTURE/open-owner/node_modules" "$FIXTURE/open-consumer/node_modules"
for dir in "$REPO" "$FIXTURE/open-owner" "$FIXTURE/open-consumer"; do old "$dir"; done
run_cleanup --apply
assert_exists "$REPO/node_modules/data"
assert_exists "$FIXTURE/open-consumer/node_modules/data"
assert_absent "$FIXTURE/open-owner/target"
# A consumer can appear after planning. Recheck references before deleting.
mkdir -p "$FIXTURE/open-owner/target"
# shellcheck source=../cleanup-worktrees.sh
source "$TEST_DIR/cleanup-worktrees.sh"
GH_OK=1
process_repo "$REPO"
ln -s "$FIXTURE/open-owner/target" "$FIXTURE/open-consumer/target"
apply_plan
assert_exists "$FIXTURE/open-owner/target"
[[ ${#ERRORS[@]} == 0 ]]
echo 'PASS primary caches and caches referenced by another worktree survive'
