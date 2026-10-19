#!/usr/bin/env bash
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
wt missing
missing="$FIXTURE/missing"
gitdir=$(git -C "$missing" rev-parse --absolute-git-dir)
mv -- "$missing" "$FIXTURE/saved-checkout"
touch -d '1 year ago' "$gitdir/gitdir"
# shellcheck source=../cleanup-worktrees.sh
source "$TEST_DIR/cleanup-worktrees.sh"
if in_use "$missing"; then echo 'FAIL missing worktree was treated as in use'; exit 1; fi
export REAL_GIT PRUNE_LOG="$FIXTURE/prune.log"
REAL_GIT=$(command -v git)
cat > "$FIXTURE/bin/git" <<'STUB'
#!/usr/bin/env bash
if [[ "$*" == *'worktree prune'* ]]; then printf 'prune\n' >> "$PRUNE_LOG"; fi
exec "$REAL_GIT" "$@"
STUB
chmod 755 "$FIXTURE/bin/git"
run_cleanup --dry-run
assert_exists "$gitdir"
[[ ! -e "$PRUNE_LOG" ]] || { echo 'FAIL dry run pruned registrations'; exit 1; }
run_cleanup --apply
assert_absent "$gitdir"
[[ "$(wc -l < "$PRUNE_LOG")" == 1 ]] || { echo 'FAIL expected one prune without removals'; exit 1; }
: > "$PRUNE_LOG"
wt merged-one
wt merged-two
old "$FIXTURE/merged-one"
old "$FIXTURE/merged-two"
run_cleanup --apply
assert_absent "$FIXTURE/merged-one"
assert_absent "$FIXTURE/merged-two"
[[ "$(wc -l < "$PRUNE_LOG")" == 1 ]] || { echo 'FAIL expected one prune per repo with multiple removals'; exit 1; }
echo 'PASS missing paths are not busy; apply prunes once per repo, dry run never prunes'
