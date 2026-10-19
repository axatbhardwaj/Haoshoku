#!/usr/bin/env bash
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
export CLEANUP_REPO_ROOTS="$HOME/absent" T3_WORKTREES_ROOT="$HOME/no-t3"
output=$(run_cleanup --apply)
grep -q 'no git repos found' <<< "$output" || { echo 'FAIL empty repo discovery succeeded without its diagnostic'; exit 1; }
assert_exists "$FIXTURE/report.html"
echo 'PASS hosts with no repos succeed with a diagnostic and HTML report'
