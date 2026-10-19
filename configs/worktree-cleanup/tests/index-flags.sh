#!/usr/bin/env bash
if [[ $# == 0 ]]; then
  for flag in assume-unchanged skip-worktree file-mode stat-cache case-hidden; do bash "$0" "$flag" || exit 1; done
  exit 0
fi
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
export GIT_OPTIONAL_LOCKS=0
wt hidden-index
if [[ "$1" == file-mode ]]; then
  git -C "$REPO" config core.fileMode false
  chmod 755 "$FIXTURE/hidden-index/file"
elif [[ "$1" == case-hidden ]]; then
  git -C "$REPO" config core.ignoreCase true
  echo precious > "$FIXTURE/hidden-index/FILE"
elif [[ "$1" == stat-cache ]]; then
  git -C "$REPO" config core.trustctime false
  git -C "$REPO" config core.checkStat minimal
  touch -d '100 days ago' "$FIXTURE/hidden-index/file"
  git -C "$FIXTURE/hidden-index" update-index --refresh
  cp -p "$FIXTURE/hidden-index/file" "$FIXTURE/stat-snapshot"
  printf 'private\n' > "$FIXTURE/hidden-index/file"
  touch -r "$FIXTURE/stat-snapshot" "$FIXTURE/hidden-index/file"
else
  git -C "$FIXTURE/hidden-index" update-index "--$1" file
  echo precious > "$FIXTURE/hidden-index/file"
fi
old "$FIXTURE/hidden-index"
[[ -z "$(git -C "$FIXTURE/hidden-index" status --porcelain --untracked-files=all)" ]]
run_cleanup --apply
assert_exists "$FIXTURE/hidden-index/file"
case "$1" in
  stat-cache) grep -Fxq private "$FIXTURE/hidden-index/file" ;;
  case-hidden) grep -Fxq precious "$FIXTURE/hidden-index/FILE" ;;
  file-mode) ;;
  *) grep -Fxq precious "$FIXTURE/hidden-index/file" ;;
esac
echo "PASS $1 cannot hide tracked edits from cleanup"
