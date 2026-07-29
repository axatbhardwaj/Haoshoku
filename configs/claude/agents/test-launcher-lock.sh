#!/bin/bash
set -u

# Resolve the launcher beside this script rather than by absolute path, so the suite
# tests the copy it ships with — including inside a git worktree — instead of silently
# exercising whatever is installed at ~/.claude.
LAUNCHER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/run-codex-task.sh"
TEST_ROOT=$(mktemp -d /tmp/test-launcher-lock.XXXXXXXX)
LOCK_HOLDER_PID=""
UNBORN_LOCK_HOLDER_PID=""
CREATED_WORKTREES=()

cleanup() {
  local pid wt repo
  for pid in "$LOCK_HOLDER_PID" "$UNBORN_LOCK_HOLDER_PID"; do
    [ -n "$pid" ] || continue
    kill "$pid" 2>/dev/null || :
    wait "$pid" 2>/dev/null || :
  done
  # Worktrees the launcher created on our behalf: it deliberately never removes them,
  # so the suite must, before the repos they are registered against disappear.
  for wt in "${CREATED_WORKTREES[@]:-}"; do
    [ -n "$wt" ] && rm -rf "$wt"
  done
  for repo in "${REPO_ONE:-}" "${REPO_TWO:-}" "${REPO_UNBORN:-}"; do
    [ -n "$repo" ] && [ -d "$repo" ] && git -C "$repo" worktree prune >/dev/null 2>&1 || :
  done
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
  # The launcher refuses any dispatch lacking the gateway marker that
  # validate-codex-wrapper.sh injects in production (blocked_no_gateway_marker, exit 6).
  # Without this the suite dies on its first assertion and tests nothing — which is
  # exactly what it did, silently, from the commit that introduced the gate until now.
  if CODEX_ATTEMPT_LOG="$TEST_ROOT/codex-attempts.log" \
    CODEX_WRAPPER_GATEWAY="validate-codex-wrapper" \
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

WORKTREE_OUT="$TEST_ROOT/same-workspace-worktree.json"
run_launcher "$WORKTREE_OUT" \
  --mode implementation \
  --model sol \
  --workspace "$REPO_ONE" \
  --prompt-file "$PROMPT_FILE" \
  --worktree-on-contention
assert_not_lock_blocked "$WORKTREE_OUT" "same-workspace implementation with --worktree-on-contention"
WORKTREE_RUN_DIR=$(jq -r '.run_dir // empty' "$WORKTREE_OUT")
[ -n "$WORKTREE_RUN_DIR" ] && [ -f "$WORKTREE_RUN_DIR/report.json" ] ||
  fail "worktree isolation produced no report.json"
WORKTREE_USED=$(jq -r '.workspace' "$WORKTREE_RUN_DIR/report.json")
case "$WORKTREE_USED" in
  /tmp/codex-wrapper/worktrees/*) CREATED_WORKTREES+=("$WORKTREE_USED") ;;
  *) fail "worktree isolation reported workspace '$WORKTREE_USED', expected a path under /tmp/codex-wrapper/worktrees/" ;;
esac
[ "$(wc -l < "$TEST_ROOT/codex-attempts.log")" -eq 3 ] ||
  fail "worktree isolation did not reach the codex invocation"
pass "contention with --worktree-on-contention runs in an isolated worktree instead of exiting 4"

# The launcher must never clean up after itself here: the worktree holds the only copy
# of the dispatch's uncommitted work until the chair merges it back.
[ -d "$WORKTREE_USED" ] ||
  fail "launcher removed the worktree it created; that would destroy the run's only copy"
[ -f "$WORKTREE_USED/tracked.txt" ] ||
  fail "worktree does not contain the repository's tracked content"
pass "launcher leaves the worktree in place after the run"

# Isolation needs a commit to branch from. An unborn HEAD is not an anomaly worth its own
# status — the dispatch simply cannot be isolated, so it must report the ordinary refusal.
REPO_UNBORN="$TEST_ROOT/workspace-unborn"
mkdir -p "$REPO_UNBORN"
git -C "$REPO_UNBORN" init -q
UNBORN_SLUG=$(printf '%s' "$(realpath "$REPO_UNBORN")" | sha256sum | cut -d' ' -f1)
UNBORN_READY="$TEST_ROOT/unborn-lock-ready"
(
  exec 8>"/tmp/codex-wrapper/locks/$UNBORN_SLUG.lock"
  flock -n 8 || exit 1
  : > "$UNBORN_READY"
  sleep 30
) &
UNBORN_LOCK_HOLDER_PID=$!
for _ in $(seq 1 100); do
  [ -e "$UNBORN_READY" ] && break
  kill -0 "$UNBORN_LOCK_HOLDER_PID" 2>/dev/null ||
    fail "background process failed to acquire the unborn-repo lock"
  sleep 0.05
done
[ -e "$UNBORN_READY" ] || fail "timed out waiting for the unborn-repo lock"

UNBORN_OUT="$TEST_ROOT/unborn-worktree.json"
run_launcher "$UNBORN_OUT" \
  --mode implementation \
  --model sol \
  --workspace "$REPO_UNBORN" \
  --prompt-file "$PROMPT_FILE" \
  --worktree-on-contention
[ "$LAUNCHER_EXIT" -eq 4 ] ||
  fail "unborn-HEAD workspace with --worktree-on-contention: expected fallback exit 4, got $LAUNCHER_EXIT"
jq -e '.launcher_status == "blocked_concurrent_dispatch"' "$UNBORN_OUT" >/dev/null ||
  fail "unborn-HEAD workspace did not fall back to blocked_concurrent_dispatch"
pass "unborn HEAD falls back to the ordinary refusal rather than attempting a worktree"

printf 'All launcher lock tests passed.\n'
