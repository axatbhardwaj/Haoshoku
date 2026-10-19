#!/usr/bin/env bash
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
export REAL_GIT
REAL_GIT=$(command -v git)
cat > "$FIXTURE/bin/git" <<'STUB'
#!/usr/bin/env bash
if [[ "$*" == *'fetch --all'* ]]; then exit 1; fi
exec "$REAL_GIT" "$@"
STUB
chmod 755 "$FIXTURE/bin/git"
bash "$TEST_DIR/cleanup-worktrees.sh" --dry-run --html "$FIXTURE/report.html" > "$FIXTURE/output" 2>&1
cat "$FIXTURE/output"
grep -q 'WARNING:.*fetch.*failed' "$FIXTURE/output" || { echo 'FAIL fetch failure was silent'; exit 1; }
echo 'PASS fetch failure warns without failing the job'
