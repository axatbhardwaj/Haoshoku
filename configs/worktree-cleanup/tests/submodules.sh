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
populate() {
  local layout=$1 worktree=$2
  case "$layout" in
    initialized) git -c protocol.file.allow=always -C "$worktree" submodule update --init -q ;;
    cloned) git clone -q "$FIXTURE/submodule" "$worktree/nested" ;;
    gitfile) git clone -q --separate-git-dir "$worktree-external.git" "$FIXTURE/submodule" "$worktree/nested" ;;
  esac
  if [[ "$layout" != initialized ]]; then
    [[ ! -e "$(git -C "$worktree" rev-parse --absolute-git-dir)/modules" ]]
  fi
  old "$worktree"
}

# Prove the production Git refusal first, without force or deinitialization.
for layout in initialized cloned gitfile; do
  wt "$layout"
  populate "$layout" "$FIXTURE/$layout"
  if refusal=$(git -C "$REPO" worktree remove "$FIXTURE/$layout" 2>&1); then
    echo "FAIL Git unexpectedly removed a $layout submodule worktree"; exit 1
  fi
  printf '%s: %s\n' "$layout" "$refusal"
  [[ "$refusal" == *'working trees containing submodules cannot be moved or removed'* ]]
  assert_exists "$FIXTURE/$layout/nested/file"
done

# Observe all removal attempts, forwarding to real Git without changing results.
export REAL_GIT REMOVE_LOG="$FIXTURE/remove.log"
REAL_GIT=$(command -v git)
cat > "$FIXTURE/bin/git" <<'GIT'
#!/usr/bin/env bash
if [[ "$*" == *'worktree remove'* ]]; then printf '%s\n' "$*" >> "$REMOVE_LOG"; fi
exec "$REAL_GIT" "$@"
GIT
chmod 755 "$FIXTURE/bin/git"
hash -r

failed=0
output=$(run_cleanup --dry-run)
printf '%s\n' "$output"
[[ "$output" == *'would-remove=0 '* ]] || {
  echo 'FAIL populated gitlink worktree planned for removal'; failed=1;
}
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
for layout in initialized cloned gitfile; do assert_exists "$FIXTURE/$layout/nested/file"; done

# Populate more worktrees only AFTER they were planned for removal.
for layout in initialized cloned gitfile; do wt "$layout-race"; old "$FIXTURE/$layout-race"; done
# shellcheck source=../cleanup-worktrees.sh
source "$TEST_DIR/cleanup-worktrees.sh"
GH_OK=1
process_repo "$REPO"
for layout in initialized cloned gitfile; do
  [[ " ${PLAN_REVIEW[*]} " == *"$FIXTURE/$layout|$layout|initialized submodules; remove manually"* ]] || {
    echo "FAIL $layout submodule was not planned for REVIEW"; failed=1;
  }
  [[ " ${PLAN_REMOVE[*]} " == *"$FIXTURE/$layout-race|"* ]] || {
    echo 'FAIL uninitialized worktree was not eligible for removal'; exit 1;
  }
  populate "$layout" "$FIXTURE/$layout-race"
done
apply_plan
[[ ${#ERRORS[@]} == 0 && ${#DONE_REMOVE[@]} == 0 ]] || {
  echo 'FAIL apply did not re-check initialized submodules'; failed=1;
}
for layout in initialized cloned gitfile; do
  [[ " ${PLAN_REVIEW[*]} " == *"$FIXTURE/$layout-race|$layout-race|initialized submodules; remove manually"* ]] || {
    echo "FAIL apply-time $layout submodule was not reported for REVIEW"; failed=1;
  }
  assert_exists "$FIXTURE/$layout-race/nested/file"
done
if [[ -e "$REMOVE_LOG" ]]; then echo 'FAIL apply re-check reached git worktree remove'; failed=1; fi
(( failed == 0 )) || exit 1
echo 'PASS initialized submodules are REVIEW without removal attempts or job errors, including apply races'
