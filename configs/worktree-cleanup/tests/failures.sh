#!/usr/bin/env bash
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
wt merged
old "$FIXTURE/merged"
export REAL_GIT REMOVE_LOG="$FIXTURE/remove.log"
REAL_GIT=$(command -v git)
cat > "$FIXTURE/bin/git" <<'STUB'
#!/usr/bin/env bash
if [[ "$*" == *'worktree remove'* ]]; then
  echo attempted > "$REMOVE_LOG"
  echo 'fixture removal denied' >&2
  exit 1
fi
exec "$REAL_GIT" "$@"
STUB
chmod 755 "$FIXTURE/bin/git"
if run_cleanup --apply; then echo 'FAIL apply failure did not exit nonzero'; exit 1; fi
assert_exists "$REMOVE_LOG"
assert_exists "$FIXTURE/merged"
grep -q 'fixture removal denied' "$FIXTURE/report.html"
echo 'PASS failed apply exits 1 and retains its worktree with HTML error evidence'
