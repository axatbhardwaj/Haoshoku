#!/usr/bin/env bash
if [[ $# == 0 ]]; then
  for scope in repo global; do bash "$0" "$scope" || exit 1; done
  exit 0
fi
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
export GIT_OPTIONAL_LOCKS=0
if [[ "$1" == global ]]; then
  export GIT_CONFIG_GLOBAL="$HOME/.gitconfig"
  git config --global status.showUntrackedFiles no
else
  git -C "$REPO" config status.showUntrackedFiles no
fi
git -C "$REPO" config core.untrackedCache true
wt hidden
old "$FIXTURE/hidden"
mkdir "$FIXTURE/hidden/notes"
echo precious > "$FIXTURE/hidden/notes/new.txt"
# Demonstrate that the configured ordinary status hides this real file.
[[ -z "$(git -C "$FIXTURE/hidden" status --porcelain)" ]]
run_cleanup --apply
assert_exists "$FIXTURE/hidden/notes/new.txt"
# The identical check must protect untracked content added after planning.
wt late
old "$FIXTURE/late"
# shellcheck source=../cleanup-worktrees.sh
source "$TEST_DIR/cleanup-worktrees.sh"
GH_OK=1
process_repo "$REPO"
echo precious > "$FIXTURE/late/new.txt"
apply_plan
assert_exists "$FIXTURE/late/new.txt"
[[ ${#ERRORS[@]} == 0 ]]
echo "PASS untracked files survive hiding $1 status config at plan and apply"
