#!/usr/bin/env bash
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
# The remote default must survive even if origin/HEAD is absent locally.
git -C "$REPO" branch protected main
git -C "$REPO" push -q origin protected
git --git-dir="$FIXTURE/remote.git" symbolic-ref HEAD refs/heads/protected
git -C "$REPO" remote set-head origin -d
run_cleanup --apply
git -C "$REPO" show-ref --verify --quiet refs/heads/protected || { echo 'FAIL unknown remote default branch deleted'; exit 1; }
# Refuse a symlink before even attempting the destructive Git boundary.
wt linked
old "$FIXTURE/linked"
ln -s "$FIXTURE/linked" "$FIXTURE/link"
export REAL_GIT
REAL_GIT=$(command -v git)
export REMOVE_LOG="$FIXTURE/remove.log"
cat > "$FIXTURE/bin/git" <<'STUB'
#!/usr/bin/env bash
if [[ "$*" == *'worktree remove'* ]]; then echo attempted > "$REMOVE_LOG"; exit 1; fi
exec "$REAL_GIT" "$@"
STUB
chmod 755 "$FIXTURE/bin/git"
hash -r
# shellcheck source=../cleanup-worktrees.sh
source "$TEST_DIR/cleanup-worktrees.sh"
do_remove "$REPO" "$FIXTURE/link" linked
[[ ! -e "$REMOVE_LOG" ]] || { echo 'FAIL symlink reached destructive git call'; exit 1; }
assert_exists "$FIXTURE/linked"
[[ ${#ERRORS[@]} -gt 0 ]] || { echo 'FAIL unsafe path was not reported'; exit 1; }
echo 'PASS unknown-default protection and validated removal paths'
