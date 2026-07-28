#!/bin/bash
set -u

LAUNCHER="$HOME/.claude/agents/run-codex-task.sh"
TEST_ROOT=$(mktemp -d /tmp/test-launcher-lock.XXXXXXXX)
LOCK_HOLDER_PID=""

cleanup() {
  if [ -n "$LOCK_HOLDER_PID" ]; then
    kill "$LOCK_HOLDER_PID" 2>/dev/null || :
    wait "$LOCK_HOLDER_PID" 2>/dev/null || :
  fi
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

pass() {
  printf 'PASS: %s\n' "$1"
}

make_clean_repo() {
  local repo="$1"
  mkdir -p "$repo"
  git -C "$repo" init -q
  printf 'initial\n' > "$repo/tracked.txt"
  git -C "$repo" add tracked.txt
  git -C "$repo" \
    -c user.name="Launcher Lock Test" \
    -c user.email="launcher-lock-test@example.invalid" \
    commit -qm "test: initial commit"
}

run_launcher() {
  local output_file="$1"
  shift
  if CODEX_ATTEMPT_LOG="$TEST_ROOT/codex-attempts.log" \
    PATH="$TEST_ROOT/bin:$PATH" \
    bash "$LAUNCHER" "$@" > "$output_file" 2>"$output_file.stderr"; then
    LAUNCHER_EXIT=0
  else
    LAUNCHER_EXIT=$?
  fi
}

assert_not_lock_blocked() {
  local output_file="$1"
  local description="$2"
  local run_dir

  [ "$LAUNCHER_EXIT" -ne 4 ] ||
    fail "$description exited 4 while another workspace lock was held"
  ! jq -e '.launcher_status == "blocked_concurrent_dispatch"' "$output_file" >/dev/null 2>&1 ||
    fail "$description stdout reported blocked_concurrent_dispatch"

  run_dir=$(jq -r '.run_dir // empty' "$output_file" 2>/dev/null)
  if [ -n "$run_dir" ] && [ -f "$run_dir/report.json" ]; then
    ! jq -e '.launcher_status == "blocked_concurrent_dispatch"' "$run_dir/report.json" >/dev/null 2>&1 ||
      fail "$description report.json reported blocked_concurrent_dispatch"
  fi
}

REPO_ONE="$TEST_ROOT/workspace-one"
REPO_TWO="$TEST_ROOT/workspace-two"
PROMPT_FILE="$TEST_ROOT/prompt.md"
FAKE_CODEX="$TEST_ROOT/bin/codex"
mkdir -p "$TEST_ROOT/bin" "/tmp/codex-wrapper/locks"
make_clean_repo "$REPO_ONE"
make_clean_repo "$REPO_TWO"
printf 'Launcher lock regression test.\n' > "$PROMPT_FILE"

cat > "$FAKE_CODEX" <<'EOF'
#!/bin/bash
printf 'codex invoked\n' >> "$CODEX_ATTEMPT_LOG"
exit 23
EOF
chmod +x "$FAKE_CODEX"

WORKSPACE_ABS=$(realpath "$REPO_ONE")
WORKSPACE_SLUG=$(printf '%s' "$WORKSPACE_ABS" | sha256sum | cut -d' ' -f1)
# This deliberately shares /tmp/codex-wrapper/locks with real production locks, but is safe
# because each lock is keyed by a workspace slug: sha256 of the realpath'd absolute workspace
# path. These fake workspaces live under a per-run mktemp -d root, so their paths cannot equal
# a real repository path; isolation comes from the key (the slug), not directory separation.
# Do not point --workspace at a real repository here: that would wedge/collide with production
# dispatches against the same repository.
LOCK_FILE="/tmp/codex-wrapper/locks/$WORKSPACE_SLUG.lock"
LOCK_READY="$TEST_ROOT/lock-ready"
(
  exec 9>"$LOCK_FILE"
  flock -n 9 || exit 1
  : > "$LOCK_READY"
  sleep 30
) &
LOCK_HOLDER_PID=$!

for _ in $(seq 1 100); do
  [ -e "$LOCK_READY" ] && break
  kill -0 "$LOCK_HOLDER_PID" 2>/dev/null ||
    fail "background process failed to acquire the simulated workspace lock"
  sleep 0.05
done
[ -e "$LOCK_READY" ] || fail "timed out waiting for the simulated workspace lock"

SAME_IMPL_OUT="$TEST_ROOT/same-workspace-implementation.json"
run_launcher "$SAME_IMPL_OUT" \
  --mode implementation \
  --model sol \
  --workspace "$REPO_ONE" \
  --prompt-file "$PROMPT_FILE"

[ "$LAUNCHER_EXIT" -eq 4 ] ||
  fail "same-workspace implementation exit code: expected 4, got $LAUNCHER_EXIT; stdout=$(tr '\n' ' ' < "$SAME_IMPL_OUT")"
jq -e '.launcher_status == "blocked_concurrent_dispatch"' "$SAME_IMPL_OUT" >/dev/null ||
  fail "same-workspace implementation stdout did not report blocked_concurrent_dispatch"
SAME_IMPL_RUN_DIR=$(jq -r '.run_dir' "$SAME_IMPL_OUT")
jq -e '.launcher_status == "blocked_concurrent_dispatch"' "$SAME_IMPL_RUN_DIR/report.json" >/dev/null ||
  fail "same-workspace implementation report.json did not report blocked_concurrent_dispatch"
[ ! -s "$TEST_ROOT/codex-attempts.log" ] ||
  fail "same-workspace implementation invoked codex before rejecting the held lock"
pass "same-workspace implementation fails immediately with exit 4 and blocked_concurrent_dispatch"

REVIEW_OUT="$TEST_ROOT/same-workspace-review.json"
run_launcher "$REVIEW_OUT" \
  --mode review \
  --model sol \
  --workspace "$REPO_ONE" \
  --prompt-file "$PROMPT_FILE"
assert_not_lock_blocked "$REVIEW_OUT" "same-workspace review"
[ "$(wc -l < "$TEST_ROOT/codex-attempts.log")" -eq 1 ] ||
  fail "same-workspace review did not reach the codex invocation"
pass "same-workspace review bypasses the implementation lock"

OTHER_IMPL_OUT="$TEST_ROOT/different-workspace-implementation.json"
run_launcher "$OTHER_IMPL_OUT" \
  --mode implementation \
  --model sol \
  --workspace "$REPO_TWO" \
  --prompt-file "$PROMPT_FILE"
assert_not_lock_blocked "$OTHER_IMPL_OUT" "different-workspace implementation"
[ "$(wc -l < "$TEST_ROOT/codex-attempts.log")" -eq 2 ] ||
  fail "different-workspace implementation did not reach the codex invocation"
pass "different-workspace implementation is independent of the held lock"

printf 'All launcher lock tests passed.\n'
