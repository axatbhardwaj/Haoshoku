#!/usr/bin/env bash
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
wt open-owner
wt open-user
mkdir -p "$FIXTURE/open-owner/pkg/node_modules" "$FIXTURE/open-owner/target"
echo deps > "$FIXTURE/open-owner/pkg/node_modules/data"
ln -s "$FIXTURE/open-owner/pkg" "$FIXTURE/open-user/pkg"
old "$FIXTURE/open-owner"
old "$FIXTURE/open-user"
run_cleanup --apply
assert_exists "$FIXTURE/open-user/pkg/node_modules/data"
assert_absent "$FIXTURE/open-owner/target"
# Apply rechecks a reference to the owning worktree root appearing after planning.
mkdir "$FIXTURE/open-owner/target"
# shellcheck source=../cleanup-worktrees.sh
source "$TEST_DIR/cleanup-worktrees.sh"
GH_OK=1
process_repo "$REPO"
ln -s "$FIXTURE/open-owner" "$FIXTURE/open-user/whole-tree"
apply_plan
assert_exists "$FIXTURE/open-user/whole-tree/target"
[[ ${#ERRORS[@]} == 0 ]]
echo 'PASS ancestor-directory symlinks protect nested caches at plan and apply'
