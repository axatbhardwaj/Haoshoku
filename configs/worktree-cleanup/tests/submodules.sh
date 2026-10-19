#!/usr/bin/env bash
# Real initialized submodules must be review-only, including apply-time races.
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
git init -q --initial-branch=main "$FIXTURE/submodule"
echo nested > "$FIXTURE/submodule/file"
git -C "$FIXTURE/submodule" add file
git -C "$FIXTURE/submodule" commit -qm nested
git -c protocol.file.allow=always -C "$REPO" submodule add -q "$FIXTURE/submodule" nested
git -C "$REPO" commit -qm 'add submodule'
git -C "$REPO" push -q origin main
wt initialized
git -c protocol.file.allow=always -C "$FIXTURE/initialized" submodule update --init -q
old "$FIXTURE/initialized"

# Prove the production Git refusal first, without force or deinitialization.
if refusal=$(git -C "$REPO" worktree remove "$FIXTURE/initialized" 2>&1); then
  echo 'FAIL Git unexpectedly removed an initialized-submodule worktree'; exit 1
fi
printf '%s\n' "$refusal"
[[ "$refusal" == *'working trees containing submodules cannot be moved or removed'* ]]
assert_exists "$FIXTURE/initialized/nested/file"

# Observe all removal attempts, forwarding to real Git without changing results.
export REAL_GIT REMOVE_LOG="$FIXTURE/remove.log"
REAL_GIT=$(command -v git)
cat > "$FIXTURE/bin/git" <<'GIT'
#!/usr/bin/env bash
if [[ "$*" == *'worktree remove'* ]]; then printf '%s\n' "$*" >> "$REMOVE_LOG"; fi
exec "$REAL_GIT" "$@"
GIT
chmod 755 "$FIXTURE/bin/git"

failed=0
run_cleanup --dry-run
grep -q 'initialized submodules; remove manually' "$FIXTURE/report.html" || {
  echo 'FAIL planning did not report initialized submodules for REVIEW'; failed=1;
}
if output=$(run_cleanup --apply 2>&1); then
  printf '%s\n' "$output"
else
  printf '%s\nFAIL submodule-only apply exited nonzero\n' "$output"; failed=1
fi
if [[ -e "$REMOVE_LOG" ]]; then echo 'FAIL initialized worktree reached git worktree remove'; failed=1; fi
[[ "$output" == *'errors=0'* && "$output" != *'ERROR:'* ]] || {
  echo 'FAIL initialized submodules counted as errors'; failed=1;
}
assert_exists "$FIXTURE/initialized/nested/file"

# Initialize a second worktree only AFTER it was planned for removal.
wt race
old "$FIXTURE/race"
# shellcheck source=../cleanup-worktrees.sh
source "$TEST_DIR/cleanup-worktrees.sh"
GH_OK=1
process_repo "$REPO"
[[ " ${PLAN_REMOVE[*]} " == *"$FIXTURE/race|"* ]] || {
  echo 'FAIL uninitialized worktree was not eligible for removal'; exit 1;
}
git -c protocol.file.allow=always -C "$FIXTURE/race" submodule update --init -q
old "$FIXTURE/race"
apply_plan
[[ ${#ERRORS[@]} == 0 && ${#DONE_REMOVE[@]} == 0 ]] || {
  echo 'FAIL apply did not re-check initialized submodules'; failed=1;
}
[[ " ${PLAN_REVIEW[*]} " == *"$FIXTURE/race|race|initialized submodules; remove manually"* ]] || {
  echo 'FAIL apply-time submodule initialization was not reported for REVIEW'; failed=1;
}
if [[ -e "$REMOVE_LOG" ]]; then echo 'FAIL apply re-check reached git worktree remove'; failed=1; fi
assert_exists "$FIXTURE/race/nested/file"
(( failed == 0 )) || exit 1
echo 'PASS initialized submodules are REVIEW without removal attempts or job errors, including apply races'
