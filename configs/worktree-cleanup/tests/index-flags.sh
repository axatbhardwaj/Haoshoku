#!/usr/bin/env bash
if [[ $# == 0 ]]; then
  for flag in assume-unchanged skip-worktree file-mode; do bash "$0" "$flag" || exit 1; done
  exit 0
fi
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
export GIT_OPTIONAL_LOCKS=0
wt hidden-index
if [[ "$1" == file-mode ]]; then
  git -C "$REPO" config core.fileMode false
  chmod 755 "$FIXTURE/hidden-index/file"
else
  git -C "$FIXTURE/hidden-index" update-index "--$1" file
  echo precious > "$FIXTURE/hidden-index/file"
fi
old "$FIXTURE/hidden-index"
[[ -z "$(git -C "$FIXTURE/hidden-index" status --porcelain --untracked-files=all)" ]]
run_cleanup --apply
assert_exists "$FIXTURE/hidden-index/file"
if [[ "$1" != file-mode ]]; then grep -Fxq precious "$FIXTURE/hidden-index/file"; fi
echo "PASS $1 cannot hide tracked edits from cleanup"
