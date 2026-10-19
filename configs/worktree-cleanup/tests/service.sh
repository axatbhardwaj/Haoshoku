#!/usr/bin/env bash
# Model oneshot ExecStart failure semantics, using the actual unit and entrypoint.
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
live="$HOME/.local/share/disk-cleanup"
mkdir -p "$live"
cp "$TEST_DIR/"*.sh "$live/"
export STEP_LOG="$FIXTURE/steps.log" WORKTREE_STATUS=1 TEMP_STATUS=0
cat > "$live/cleanup-worktrees.sh" <<'STUB'
#!/usr/bin/env bash
printf 'worktrees %s\n' "$*" >> "$STEP_LOG"
exit "$WORKTREE_STATUS"
STUB
cat > "$live/cleanup-temp.sh" <<'STUB'
#!/usr/bin/env bash
printf 'temp %s\n' "$*" >> "$STEP_LOG"
exit "$TEMP_STATUS"
STUB
chmod 755 "$live/cleanup-worktrees.sh" "$live/cleanup-temp.sh"
run_service() {
  local line command result=0
  local -a args
  while IFS= read -r line; do
    [[ "$line" == ExecStart=* ]] || continue
    command=${line#ExecStart=}
    command=${command//%h/$HOME}
    read -ra args <<< "$command"
    "${args[@]}" || { result=$?; break; }
  done < "$TEST_DIR/disk-cleanup.service"
  return "$result"
}
for pair in '1 0' '0 1' '1 1' '0 0'; do
  read -r WORKTREE_STATUS TEMP_STATUS <<< "$pair"
  : > "$STEP_LOG"
  result=0
  run_service || result=$?
  grep -Fxq 'worktrees --apply' "$STEP_LOG"
  grep -Fxq 'temp --apply' "$STEP_LOG" || { echo "FAIL first=$WORKTREE_STATUS temp=$TEMP_STATUS: temp step was skipped"; exit 1; }
  expected=0
  (( WORKTREE_STATUS != 0 || TEMP_STATUS != 0 )) && expected=1
  [[ "$result" == "$expected" ]] || { echo "FAIL expected service result $expected, got $result"; exit 1; }
done
echo 'PASS service always runs both steps and preserves any failure'
