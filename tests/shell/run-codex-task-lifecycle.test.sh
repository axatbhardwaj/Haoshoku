#!/usr/bin/env bash
# Tests detached Codex launcher identity, abort, and wait liveness behavior.

set -uo pipefail
umask 077
unset CODEX_WRAPPER_GATEWAY

[ ! -L /tmp/codex-wrapper ] || {
  echo "test run root must not be a symlink: /tmp/codex-wrapper" >&2
  exit 1
}
mkdir -m 700 -p /tmp/codex-wrapper || {
  echo "cannot create test run root: /tmp/codex-wrapper" >&2
  exit 1
}

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
LAUNCHER="$ROOT/configs/claude/agents/run-codex-task.sh"

pass=0 fail=0
cleanup_dirs=()
cleanup_groups=()
cleanup_links=()

ok() { printf '  ok   %s\n' "$1"; pass=$((pass + 1)); }
no() { printf '  FAIL %s\n       expected: %s\n       actual:   %s\n' "$1" "$2" "$3"; fail=$((fail + 1)); }

is() { # is <name> <expected> <actual>
  [ "$2" = "$3" ] && ok "$1" || no "$1" "$2" "$3"
}

cleanup() {
  local pgid dir link
  for pgid in "${cleanup_groups[@]}"; do
    case "$pgid" in ''|*[!0-9]*|0|1) continue ;; esac
    kill -TERM -- "-$pgid" 2>/dev/null || true
  done
  sleep 0.1
  for pgid in "${cleanup_groups[@]}"; do
    case "$pgid" in ''|*[!0-9]*|0|1) continue ;; esac
    kill -KILL -- "-$pgid" 2>/dev/null || true
    wait "$pgid" 2>/dev/null || true
  done
  for link in "${cleanup_links[@]}"; do
    case "$link" in /tmp/codex-wrapper/run-????????) rm -f -- "$link" ;; esac
  done
  for dir in "${cleanup_dirs[@]}"; do
    case "$dir" in
      /tmp/codex-wrapper/run-????????|/tmp/not-codex-wrapper/run-????????) rm -rf -- "$dir" ;;
    esac
  done
  rmdir /tmp/not-codex-wrapper 2>/dev/null || true
}
trap cleanup EXIT

register_cleanup_dir() {
  local canonical parent base
  [ -d "$1" ] && [ ! -L "$1" ] || return 1
  canonical=$(realpath -e -- "$1" 2>/dev/null) || return 1
  [ "$canonical" = "$1" ] || return 1
  parent=${canonical%/*}
  base=${canonical##*/}
  case "$parent" in /tmp/codex-wrapper|/tmp/not-codex-wrapper) ;; *) return 1 ;; esac
  [[ "$base" =~ ^run-[A-Za-z0-9]{8}$ ]] || return 1
  cleanup_dirs+=("$canonical")
}

new_run_dir() {
  REPLY=$(mktemp -d /tmp/codex-wrapper/run-XXXXXXXX)
  register_cleanup_dir "$REPLY" || return 1
}

spawn_group() {
  local duration="${1:-300}"
  setsid sleep "$duration" >/dev/null 2>&1 </dev/null &
  REPLY=$!
  cleanup_groups+=("$REPLY")
  local i actual=""
  for i in $(seq 1 50); do
    actual=$(ps -o pgid= -p "$REPLY" 2>/dev/null | tr -d '[:space:]')
    [ "$actual" = "$REPLY" ] && return 0
    sleep 0.02
  done
  return 1
}

spawn_term_resistant_group() { # spawn_term_resistant_group <descendant-pid-file>
  setsid bash -c 'trap "" TERM; sleep 300 & echo $! > "$1"; wait' bash "$1" >/dev/null 2>&1 &
  REPLY=$!
  cleanup_groups+=("$REPLY")
  disown "$REPLY" 2>/dev/null || true
  local i actual=""
  for i in $(seq 1 50); do
    actual=$(ps -o pgid= -p "$REPLY" 2>/dev/null | tr -d '[:space:]')
    [ "$actual" = "$REPLY" ] && [ -s "$1" ] && return 0
    sleep 0.02
  done
  return 1
}

write_identity() { # write_identity <run_dir> <pid> <pgid>
  printf 'pid=%s\npgid=%s\n' "$2" "$3" > "$1/launcher.pid"
}

json_status() {
  jq -r '.launcher_status // empty' <<<"$1" 2>/dev/null
}

[ -f "$LAUNCHER" ] || { echo "run-codex-task.sh not found at $LAUNCHER" >&2; exit 1; }

echo "detach identity"
new_run_dir; fixture_dir="$REPLY"
mkdir -p "$fixture_dir/fakebin"
printf 'Do nothing.\n' > "$fixture_dir/prompt.md"
cat > "$fixture_dir/fakebin/codex" <<'EOF'
#!/usr/bin/env bash
trap 'exit 143' TERM
sleep 300
EOF
chmod +x "$fixture_dir/fakebin/codex"

detach_output=$(CODEX_WRAPPER_GATEWAY=sol-wrapper PATH="$fixture_dir/fakebin:$PATH" bash "$LAUNCHER" \
  --mode review --model sol --workspace "$ROOT" --prompt-file "$fixture_dir/prompt.md" --detach \
  2>"$fixture_dir/detach-parent.err")
detach_status=$?
detach_run_dir=$(jq -r '.run_dir // empty' <<<"$detach_output" 2>/dev/null)
detach_pid=$(jq -r '.child_pid // empty' <<<"$detach_output" 2>/dev/null)
detach_pgid=$(jq -r '.child_pgid // empty' <<<"$detach_output" 2>/dev/null)
[ -n "$detach_run_dir" ] && register_cleanup_dir "$detach_run_dir" || true
case "$detach_pgid" in ''|*[!0-9]*|0|1) ;; *) cleanup_groups+=("$detach_pgid") ;; esac

is "detach still exits successfully" "0" "$detach_status"
is "detach still returns detached JSON" "detached" "$(json_status "$detach_output")"
if [ -f "$detach_run_dir/launcher.pid" ]; then
  ok "detach persists launcher.pid before returning"
  persisted_pid=$(sed -n 's/^pid=//p' "$detach_run_dir/launcher.pid")
  persisted_pgid=$(sed -n 's/^pgid=//p' "$detach_run_dir/launcher.pid")
else
  no "detach persists launcher.pid before returning" "a regular file" "missing"
  persisted_pid="" persisted_pgid=""
fi
is "launcher.pid records the returned child pid" "$detach_pid" "$persisted_pid"
is "detached JSON includes the recorded child pgid" "$persisted_pgid" "$detach_pgid"
actual_detach_pgid=$(ps -o pgid= -p "$detach_pid" 2>/dev/null | tr -d '[:space:]')
is "launcher.pid records the real process group" "$actual_detach_pgid" "$persisted_pgid"
case "$detach_pid" in ''|*[!0-9]*|0|1) ;; *)
  kill -TERM -- "-${detach_pgid:-$detach_pid}" 2>/dev/null || true
  ;;
esac

echo "detach parent-group measurement"
new_run_dir; measurement_dir="$REPLY"
mkdir -p "$measurement_dir/fakebin"
printf 'Do nothing.\n' > "$measurement_dir/prompt.md"
cat > "$measurement_dir/fakebin/ps" <<'EOF'
#!/usr/bin/env bash
if mkdir "$FAKE_PS_STATE" 2>/dev/null; then
  exit 1
fi
printf '%s\n' "$FAKE_PS_PGID"
EOF
cat > "$measurement_dir/fakebin/codex" <<'EOF'
#!/usr/bin/env bash
trap 'exit 143' TERM
sleep 300
EOF
chmod +x "$measurement_dir/fakebin/ps" "$measurement_dir/fakebin/codex"
measurement_output=$(FAKE_PS_STATE="$measurement_dir/ps-called" \
  FAKE_PS_PGID=424242 \
  CODEX_WRAPPER_GATEWAY=sol-wrapper PATH="$measurement_dir/fakebin:$PATH" bash "$LAUNCHER" \
  --mode review --model sol --workspace "$ROOT" --prompt-file "$measurement_dir/prompt.md" \
  --run-dir "$measurement_dir" --detach 2>"$measurement_dir/detach-parent.err")
measurement_status=$?
measurement_pid=$(jq -r '.child_pid // empty' <<<"$measurement_output" 2>/dev/null)
case "$measurement_pid" in ''|*[!0-9]*|0|1) ;; *)
  measurement_actual_pgid=$(/usr/bin/ps -o pgid= -p "$measurement_pid" 2>/dev/null | tr -d '[:space:]')
  case "$measurement_actual_pgid" in ''|*[!0-9]*|0|1) ;; *) cleanup_groups+=("$measurement_actual_pgid") ;; esac
  ;;
esac
is "detach refuses when its parent pgid cannot be measured" "73" "$measurement_status"
is "failed parent-pgid measurement returns no detached JSON" "" "$(json_status "$measurement_output")"

echo "abort live group"
new_run_dir; abort_dir="$REPLY"
if spawn_group; then
  live_pgid="$REPLY"
  write_identity "$abort_dir" "$live_pgid" "$live_pgid"
  abort_output=$(bash "$LAUNCHER" --abort "$abort_dir" 2>"$abort_dir/abort.err")
  abort_status=$?
  is "a newly recorded abort exits 8" "8" "$abort_status"
  is "abort publishes aborted JSON" "aborted" "$(json_status "$abort_output")"
  gone=0
  for _ in $(seq 1 30); do
    if ! kill -0 "$live_pgid" 2>/dev/null; then gone=1; break; fi
    sleep 0.1
  done
  if [ "$gone" -eq 1 ]; then
    ok "abort kills the live process group"
    wait "$live_pgid" 2>/dev/null || true
  else
    no "abort kills the live process group" "kill -0 fails" "process $live_pgid remains"
  fi

  second_output=$(bash "$LAUNCHER" --abort "$abort_dir" 2>"$abort_dir/abort-second.err")
  second_status=$?
  is "a repeated abort uses existing non-ok report status" "5" "$second_status"
  is "a repeated abort still prints valid aborted JSON" "aborted" "$(json_status "$second_output")"
else
  no "spawns a real setsid process group" "pgid equals pid" "setsid did not settle"
fi

echo "abort without identity"
new_run_dir; missing_identity_dir="$REPLY"
missing_identity_output=$(bash "$LAUNCHER" --abort "$missing_identity_dir" 2>"$missing_identity_dir/abort.err")
missing_identity_status=$?
is "abort without launcher.pid still exits 8" "8" "$missing_identity_status"
is "abort without launcher.pid still publishes aborted JSON" "aborted" "$(json_status "$missing_identity_output")"

echo "abort TERM escalation"
new_run_dir; escalation_dir="$REPLY"
if spawn_term_resistant_group "$escalation_dir/descendant.pid"; then
  escalation_pgid="$REPLY"
  write_identity "$escalation_dir" "$escalation_pgid" "$escalation_pgid"
  escalation_output=$(bash "$LAUNCHER" --abort "$escalation_dir" 2>"$escalation_dir/abort.err")
  escalation_status=$?
  is "TERM-resistant group abort exits 8" "8" "$escalation_status"
  is "TERM-resistant group publishes aborted JSON" "aborted" "$(json_status "$escalation_output")"
  wait "$escalation_pgid" 2>/dev/null || true
  live_group_members=$(ps -eo pgid=,stat= | awk -v pgid="$escalation_pgid" '$1 == pgid && $2 !~ /^Z/ { count++ } END { print count + 0 }')
  is "abort escalates to KILL for every live group member" "0" "$live_group_members"
else
  no "spawns a TERM-resistant process group" "leader, descendant, and settled pgid" "fixture did not settle"
fi

echo "abort signal refusal"
new_run_dir; signal_refusal_dir="$REPLY"
if spawn_group 349; then
  signal_refusal_pgid="$REPLY"
  write_identity "$signal_refusal_dir" "$signal_refusal_pgid" "$signal_refusal_pgid"
  kill() {
    if [ "${3:-}" = "-${BLOCKED_PGID:-}" ]; then
      return 1
    fi
    builtin kill "$@"
  }
  export -f kill
  signal_refusal_output=$(BLOCKED_PGID="$signal_refusal_pgid" bash "$LAUNCHER" \
    --abort "$signal_refusal_dir" 2>"$signal_refusal_dir/abort.err")
  signal_refusal_status=$?
  unset -f kill
  is "signal refusal uses abort failure exit 10" "10" "$signal_refusal_status"
  is "signal refusal publishes abort_failed JSON" "abort_failed" "$(json_status "$signal_refusal_output")"
  is "signal refusal report records the live-group reason" \
    "launcher process group remained live after TERM/KILL" \
    "$(jq -r '.reason // empty' <<<"$signal_refusal_output" 2>/dev/null)"
  if kill -0 -- "-$signal_refusal_pgid" 2>/dev/null; then
    ok "signal refusal leaves the live process group for manual recovery"
  else
    no "signal refusal leaves the live process group for manual recovery" \
      "process group remains live" "process group disappeared"
  fi
else
  no "spawns a live group for signal refusal coverage" "pgid equals pid" "setsid did not settle"
fi

echo "abort validation"
mkdir -p /tmp/not-codex-wrapper
outside_dir=$(mktemp -d /tmp/not-codex-wrapper/run-XXXXXXXX)
register_cleanup_dir "$outside_dir" || { echo "cannot register outside fixture" >&2; exit 1; }
printf 'untouched\n' > "$outside_dir/sentinel"
outside_output=$(bash "$LAUNCHER" --abort "$outside_dir" 2>"$outside_dir/abort.err")
outside_status=$?
is "abort refuses a run dir outside /tmp/codex-wrapper" "64" "$outside_status"
is "refused abort leaves its sentinel untouched" "untouched" "$(cat "$outside_dir/sentinel")"
if [ ! -e "$outside_dir/report.json" ]; then
  ok "refused abort does not publish a report outside the boundary"
else
  no "refused abort does not publish a report outside the boundary" "missing" "created"
fi

echo "abort canonical path validation"
new_run_dir; traversal_parent="$REPLY"
new_run_dir; traversal_target="$REPLY"
traversal_path="$traversal_parent/../${traversal_target##*/}"
traversal_output=$(bash "$LAUNCHER" --abort "$traversal_path" 2>"$traversal_parent/traversal.err")
traversal_status=$?
is "abort rejects a traversal spelling of a run dir" "64" "$traversal_status"
if [ ! -e "$traversal_target/report.json" ]; then
  ok "traversal refusal does not publish through the resolved target"
else
  no "traversal refusal does not publish through the resolved target" "missing" "created"
fi

symlink_target=$(mktemp -d /tmp/not-codex-wrapper/run-XXXXXXXX)
register_cleanup_dir "$symlink_target" || { echo "cannot register symlink target" >&2; exit 1; }
symlink_path=/tmp/codex-wrapper/run-SYMLINK1
rm -f -- "$symlink_path"
ln -s "$symlink_target" "$symlink_path"
cleanup_links+=("$symlink_path")
symlink_output=$(bash "$LAUNCHER" --abort "$symlink_path" 2>"$symlink_target/symlink.err")
symlink_status=$?
is "abort rejects a symlink run dir" "64" "$symlink_status"
if [ ! -e "$symlink_target/report.json" ]; then
  ok "symlink refusal does not publish through the target"
else
  no "symlink refusal does not publish through the target" "missing" "created"
fi

echo "abort report preservation"
new_run_dir; completed_dir="$REPLY"
printf 'not an identity\n' > "$completed_dir/launcher.pid"
printf '{"launcher_status":"sentinel","marker":"preserve"}\n' > "$completed_dir/report.json"
before_digest=$(sha256sum "$completed_dir/report.json" | cut -d' ' -f1)
completed_output=$(bash "$LAUNCHER" --abort "$completed_dir" 2>"$completed_dir/abort.err")
completed_status=$?
after_digest=$(sha256sum "$completed_dir/report.json" | cut -d' ' -f1)
is "malformed identity cannot replace an existing report byte for byte" "$before_digest" "$after_digest"
is "malformed identity abort prints the existing report" "sentinel" "$(json_status "$completed_output")"
is "malformed identity with an existing non-ok report retains exit 5" "5" "$completed_status"

echo "abort existing report avoids stale identity"
new_run_dir; stale_dir="$REPLY"
if spawn_group; then
  stale_pgid="$REPLY"
  write_identity "$stale_dir" "$stale_pgid" "$stale_pgid"
  printf '{"launcher_status":"sentinel","marker":"finished"}\n' > "$stale_dir/report.json"
  stale_output=$(bash "$LAUNCHER" --abort "$stale_dir" 2>"$stale_dir/abort.err")
  stale_status=$?
  is "existing report retains its non-ok exit" "5" "$stale_status"
  is "existing report is returned before stale identity signaling" "sentinel" "$(json_status "$stale_output")"
  if kill -0 "$stale_pgid" 2>/dev/null; then
    ok "existing report prevents signaling a recorded stale group"
  else
    no "existing report prevents signaling a recorded stale group" "process remains live" "process was signaled"
  fi
else
  no "spawns a group for stale identity coverage" "pgid equals pid" "setsid did not settle"
fi

echo "abort own-group measurement"
new_run_dir; own_measure_dir="$REPLY"
mkdir -p "$own_measure_dir/fakebin"
cat > "$own_measure_dir/fakebin/ps" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod +x "$own_measure_dir/fakebin/ps"
if spawn_group; then
  own_measure_pgid="$REPLY"
  write_identity "$own_measure_dir" "$own_measure_pgid" "$own_measure_pgid"
  own_measure_output=$(PATH="$own_measure_dir/fakebin:$PATH" bash "$LAUNCHER" \
    --abort "$own_measure_dir" 2>"$own_measure_dir/abort.err")
  own_measure_status=$?
  is "unmeasurable own pgid uses abort failure exit 10" "10" "$own_measure_status"
  is "unmeasurable own pgid publishes abort_failed JSON" "abort_failed" "$(json_status "$own_measure_output")"
  if kill -0 "$own_measure_pgid" 2>/dev/null; then
    ok "unmeasurable own pgid fails closed without signaling"
  else
    no "unmeasurable own pgid fails closed without signaling" "process remains live" "process was signaled"
  fi
else
  no "spawns a group for own-pgid measurement coverage" "pgid equals pid" "setsid did not settle"
fi

echo "abort malformed identity"
new_run_dir; malformed_dir="$REPLY"
malformed_sleep=347
if spawn_group "$malformed_sleep"; then
  malformed_pgid="$REPLY"
  malformed_pid=$(pgrep -g "$malformed_pgid" -f "^sleep $malformed_sleep$" | head -n 1)
  if [ -n "$malformed_pid" ]; then
    ok "resolves the real malformed-identity fixture pid"
  else
    no "resolves the real malformed-identity fixture pid" "a live sleep pid" "missing"
  fi
  printf '{"pid":1,"pgid":1}\n' > "$malformed_dir/launcher.pid"
  malformed_output=$(bash "$LAUNCHER" --abort "$malformed_dir" 2>"$malformed_dir/abort.err")
  malformed_status=$?
  is "malformed identity publishes abort_failed" "abort_failed" "$(json_status "$malformed_output")"
  is "malformed identity uses distinct exit 10" "10" "$malformed_status"
  is "malformed identity report records its reason" "malformed launcher identity file" \
    "$(jq -r '.reason // empty' <<<"$malformed_output" 2>/dev/null)"
  if grep -Fq 'ps aux | grep run-codex-task' "$malformed_dir/abort.err"; then
    ok "malformed identity stderr gives the manual process lookup"
  else
    no "malformed identity stderr gives the manual process lookup" \
      "ps aux | grep run-codex-task" "$(cat "$malformed_dir/abort.err")"
  fi
  if [ -n "$malformed_pid" ] && kill -0 "$malformed_pid" 2>/dev/null && kill -0 -- "-$malformed_pgid" 2>/dev/null; then
    ok "malformed identity leaves the live process group unsignalled"
  else
    no "malformed identity leaves the live process group unsignalled" \
      "pid and pgid remain live" "pid=${malformed_pid:-missing} pgid=$malformed_pgid"
  fi
else
  no "spawns a distinct live group for malformed identity" "pgid equals pid" "setsid did not settle"
fi

echo "terminal abort report is first-writer-wins"
new_run_dir; publication_dir="$REPLY"
mkdir -p "$publication_dir/fakebin"
printf 'Do nothing.\n' > "$publication_dir/prompt.md"
printf '{"launcher_status":"aborted","marker":"terminal"}\n' > "$publication_dir/report.json"
cat > "$publication_dir/fakebin/codex" <<'EOF'
#!/usr/bin/env bash
output=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output-last-message) output="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done
printf '{}\n' > "$output"
EOF
chmod +x "$publication_dir/fakebin/codex"
publication_output=$(CODEX_WRAPPER_GATEWAY=sol-wrapper PATH="$publication_dir/fakebin:$PATH" bash "$LAUNCHER" \
  --mode review --model sol --workspace "$ROOT" --prompt-file "$publication_dir/prompt.md" \
  --run-dir "$publication_dir" 2>"$publication_dir/foreground.err")
publication_status=$?
is "foreground completion itself still exits successfully" "0" "$publication_status"
is "normal reporter cannot replace a terminal abort report" "aborted" \
  "$(jq -r '.launcher_status // empty' "$publication_dir/report.json" 2>/dev/null)"
is "terminal abort report bytes remain identifiable" "terminal" \
  "$(jq -r '.marker // empty' "$publication_dir/report.json" 2>/dev/null)"

echo "wait dead group"
new_run_dir; dead_dir="$REPLY"
write_identity "$dead_dir" 2147483646 2147483646
dead_started=$(date +%s)
dead_output=$(bash "$LAUNCHER" --wait "$dead_dir" --wait-seconds 60 2>"$dead_dir/wait.err")
dead_status=$?
dead_elapsed=$(($(date +%s) - dead_started))
is "wait reports died for a recorded dead group" "died" "$(json_status "$dead_output")"
is "dead wait uses exit 9" "9" "$dead_status"
if [ "$dead_elapsed" -lt 10 ]; then
  ok "dead wait returns promptly"
else
  no "dead wait returns promptly" "under 10 seconds" "${dead_elapsed} seconds"
fi

echo "wait live group"
new_run_dir; live_wait_dir="$REPLY"
if spawn_group; then
  wait_pgid="$REPLY"
  write_identity "$live_wait_dir" "$wait_pgid" "$wait_pgid"
  live_output=$(bash "$LAUNCHER" --wait "$live_wait_dir" --wait-seconds 3 2>"$live_wait_dir/wait.err")
  live_status=$?
  is "wait retains still_running for a live group" "still_running" "$(json_status "$live_output")"
  is "live timeout retains exit 7" "7" "$live_status"
else
  no "spawns a live group for wait" "pgid equals pid" "setsid did not settle"
fi

echo "wait legacy run without identity"
new_run_dir; legacy_dir="$REPLY"
legacy_output=$(bash "$LAUNCHER" --wait "$legacy_dir" --wait-seconds 3 2>"$legacy_dir/wait.err")
legacy_status=$?
is "wait without launcher.pid retains still_running" "still_running" "$(json_status "$legacy_output")"
is "legacy timeout retains exit 7" "7" "$legacy_status"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
