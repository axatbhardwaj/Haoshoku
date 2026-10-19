#!/usr/bin/env bash
if [[ $# == 0 ]]; then
  for scenario in pathspec find-failure; do bash "$0" "$scenario" || exit 1; done
  exit 0
fi
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
wt open-owner
wt open-user
cache="$FIXTURE/open-owner/pkg[1]/target"
mkdir -p "$cache"
echo cache > "$cache/data"
old "$FIXTURE/open-owner"
old "$FIXTURE/open-user"
# shellcheck source=../cleanup-worktrees.sh
source "$TEST_DIR/cleanup-worktrees.sh"
GH_OK=1
process_repo "$REPO"
[[ ${#PLAN_CACHE[@]} == 1 ]]
if [[ "$1" == pathspec ]]; then
  git --literal-pathspecs -C "$FIXTURE/open-owner" add -f -- 'pkg[1]/target/data'
  git -C "$FIXTURE/open-owner" commit -qm tracked-cache-file
  old "$FIXTURE/open-owner"
else
  ln -s "$cache" "$FIXTURE/open-user/deps"
  export REAL_FIND FIND_UNREADABLE="$FIXTURE/open-user"
  REAL_FIND=$(command -v find)
  cat > "$FIXTURE/bin/find" <<'STUB'
#!/usr/bin/env bash
if [[ "$1" == "$FIND_UNREADABLE" ]]; then echo 'find: Permission denied' >&2; exit 1; fi
exec "$REAL_FIND" "$@"
STUB
  chmod 755 "$FIXTURE/bin/find"
fi
apply_caches
assert_exists "$cache/data"
[[ ${#ERRORS[@]} == 0 ]]
echo "PASS $1 cannot cause unsafe cache removal"
