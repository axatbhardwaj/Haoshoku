#!/bin/bash
# Fixed Codex launcher. The codex-wrapper agent may ONLY execute this script.
# Owns: model allowlist, mode->sandbox mapping, clean-tree precondition,
# unique run dirs, stdin prompt piping, exit-code capture, pre/post git
# snapshots, and a machine-readable report.
#
# Modes of invocation:
#   Foreground:  run-codex-task.sh --mode M --model X --workspace D --prompt-file F [--effort E]
#   Detached:    ... same args plus --detach   -> prints {launcher_status:"detached", run_dir}
#                and runs the codex+report flow in a setsid child that survives
#                the caller's 10-minute Bash-tool cap.
#   Standing:    --persist drops --ephemeral so the session is recorded and resumable;
#                report.json carries codex_session_id. --resume <id> (UUID-shaped)
#                continues a recorded session (implies persist). --resume-from-pointer
#                reads the workspace's durable session pointer and falls back to a fresh
#                persisted run when it cannot. All work in either mode; implementation
#                runs (fresh or resumed) keep the clean-tree precondition per run.
#   Wait/poll:   run-codex-task.sh --wait <run_dir> [--wait-seconds N]
#                blocks (<=N s, default 540) until report.json exists, then cats it
#                (exit 0 on launcher_status ok, 5 otherwise); prints
#                {"launcher_status":"still_running"} and exits 7 on poll timeout.
set -u

command -v jq >/dev/null 2>&1 || { echo "run-codex-task.sh requires jq (pacman -S jq / apt install jq)" >&2; exit 69; }

usage() { echo "usage: run-codex-task.sh --mode implementation|review --model sol --workspace <dir> --prompt-file <path> [--effort xhigh] [--tier default|fast|priority|flex] [--persist] [--resume <session_id>] [--resume-from-pointer] [--detach] | --wait <run_dir> [--wait-seconds <n>]  (--persist/--resume/--resume-from-pointer work in both modes; implementation needs a clean tree per run)" >&2; exit 64; }

MODE="" MODEL="" WORKSPACE="" PROMPT_FILE="" EFFORT="xhigh" TIER="" DETACH=0 RUN_DIR_ARG="" WAIT_DIR="" WAIT_SECS=540 PERSIST=0 RESUME_ID="" RESUME_REQUESTED=0 RESUME_FROM_POINTER=0 RESUME_SOURCE_ARG="" RESUME_SOURCE="" CODEX_SESSION_ID="" SESSION_POINTER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 || usage ;;
    --model) MODEL="${2:-}"; shift 2 || usage ;;
    --workspace) WORKSPACE="${2:-}"; shift 2 || usage ;;
    --prompt-file) PROMPT_FILE="${2:-}"; shift 2 || usage ;;
    --effort) EFFORT="${2:-}"; shift 2 || usage ;;
    --tier) TIER="${2:-}"; shift 2 || usage ;;   # service_tier: the codex /fast equivalent ("priority")
    --persist) PERSIST=1; shift ;;
    --resume) RESUME_ID="${2:-}"; RESUME_REQUESTED=1; shift 2 || usage ;;
    --resume-from-pointer) RESUME_FROM_POINTER=1; shift ;;
    --resume-source) RESUME_SOURCE_ARG="${2:-}"; shift 2 || usage ;;   # internal: detached resolution result
    --detach) DETACH=1; shift ;;
    --run-dir) RUN_DIR_ARG="${2:-}"; shift 2 || usage ;;   # internal: detached self-reinvocation
    --wait) WAIT_DIR="${2:-}"; shift 2 || usage ;;
    --wait-seconds) WAIT_SECS="${2:-}"; shift 2 || usage ;;
    *) usage ;;
  esac
done

# ---- Wait/poll mode: no codex involved, safe to call repeatedly. ----
if [ -n "$WAIT_DIR" ]; then
  case "$WAIT_DIR" in /tmp/codex-wrapper/run-*) ;; *) echo "refusing --wait outside /tmp/codex-wrapper: $WAIT_DIR" >&2; exit 64 ;; esac
  case "$WAIT_SECS" in ''|*[!0-9]*) usage ;; esac
  ELAPSED=0
  while :; do
    if [ -e "$WAIT_DIR/report.json" ] || [ -L "$WAIT_DIR/report.json" ]; then
      if [ -s "$WAIT_DIR/report.json" ] &&
        jq -se 'length == 1 and (.[0] | type == "object" and (.launcher_status | type == "string"))' "$WAIT_DIR/report.json" >/dev/null 2>&1; then
        cat "$WAIT_DIR/report.json"
        [ "$(jq -sr '.[0].launcher_status' "$WAIT_DIR/report.json")" = "ok" ] && exit 0 || exit 5
      fi
      # Atomic report publication makes any visible invalid file terminal, not in-progress.
      jq -n --arg run_dir "$WAIT_DIR" '{launcher_status:"invalid_report", run_dir:$run_dir}'
      exit 5
    fi
    [ "$ELAPSED" -ge "$WAIT_SECS" ] && break
    sleep 5; ELAPSED=$((ELAPSED + 5))
  done
  jq -n --arg run_dir "$WAIT_DIR" '{launcher_status:"still_running", run_dir:$run_dir}'
  exit 7
fi

[ -n "$MODE" ] && [ -n "$MODEL" ] && [ -n "$WORKSPACE" ] && [ -n "$PROMPT_FILE" ] || usage

# Mode -> sandbox is decided HERE, in code. Review is always read-only.
case "$MODE" in
  implementation) SANDBOX="workspace-write" ;;
  review)         SANDBOX="read-only" ;;
  *) echo "invalid --mode: $MODE" >&2; exit 64 ;;
esac

case "$RESUME_SOURCE_ARG" in ""|explicit|pointer|pointer_missing_fell_back_to_persist|pointer_invalid_fell_back_to_persist) ;; *) usage ;; esac

valid_session_id() {
  [[ "$1" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]
}

# --resume implies persistence and must be UUID-shaped.
if [ "$RESUME_REQUESTED" -eq 1 ]; then
  valid_session_id "$RESUME_ID" || { echo "invalid --resume session id: ${RESUME_ID:-<empty>}" >&2; exit 64; }
  PERSIST=1
  RESUME_SOURCE="${RESUME_SOURCE_ARG:-explicit}"
elif [ -n "$RESUME_SOURCE_ARG" ]; then
  RESUME_SOURCE="$RESUME_SOURCE_ARG"
elif [ "$RESUME_FROM_POINTER" -eq 1 ]; then
  PERSIST=1
fi

# Friendly-name -> model-ID allowlist. terra and luna are excluded by policy and must not be reintroduced.
# danger-full-access is unreachable by design.
case "$MODEL" in
  sol)   MODEL_ID="gpt-5.6-sol" ;;
  *) echo "model not in allowlist: $MODEL" >&2; exit 64 ;;
esac

case "$EFFORT" in xhigh) ;; *) echo "effort not in allowlist: $EFFORT" >&2; exit 64 ;; esac
case "$TIER" in
  fast) TIER="priority" ;;  # Config's display spelling; overrides require the API tier id.
  ""|default|priority|flex) ;;
  *) echo "tier not in allowlist: $TIER" >&2; exit 64 ;;
esac

[ -d "$WORKSPACE" ] || { echo "workspace not found: $WORKSPACE" >&2; exit 66; }
[ -f "$PROMPT_FILE" ] || { echo "prompt file not found: $PROMPT_FILE" >&2; exit 66; }

derive_workspace_slug() {
  local workspace_abs
  workspace_abs=$(realpath "$1" 2>/dev/null) || return 1
  [ -n "$workspace_abs" ] && [ "$workspace_abs" != "/" ] || return 1
  # Hash the full canonical path so separators and literal dashes cannot alias one another.
  printf '%s' "$workspace_abs" | sha256sum | cut -d' ' -f1
}

mkdir -p /tmp/codex-wrapper
if [ -n "$RUN_DIR_ARG" ]; then
  RUN_DIR="$RUN_DIR_ARG"
  [ -d "$RUN_DIR" ] || { echo "run dir not found: $RUN_DIR" >&2; exit 66; }
else
  RUN_DIR=$(mktemp -d /tmp/codex-wrapper/run-XXXXXXXX)
  cp "$PROMPT_FILE" "$RUN_DIR/prompt.md"
fi
SCHEMA="$HOME/.claude/agents/codex-result.schema.json"
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

git_list() { git -C "$WORKSPACE" "$@" 2>/dev/null; }
report() {  # report <status> <codex_exit> <result_valid>
  local changed_file staged_file untracked_file report_tmp fallback_tmp
  changed_file="$RUN_DIR/.report-changed.$$"
  staged_file="$RUN_DIR/.report-staged.$$"
  untracked_file="$RUN_DIR/.report-untracked.$$"
  report_tmp="$RUN_DIR/.report.json.$$"
  fallback_tmp="$RUN_DIR/.report-fallback.$$"
  # File-backed arguments avoid the kernel's argv limit on very large workspaces.
  git_list diff --name-only > "$changed_file" || :
  git_list diff --cached --name-only > "$staged_file" || :
  git_list ls-files --others --exclude-standard > "$untracked_file" || :
  if jq -n \
    --arg run_dir "$RUN_DIR" --arg mode "$MODE" --arg model "$MODEL_ID" \
    --arg sandbox "$SANDBOX" --arg workspace "$WORKSPACE" \
    --arg started "$STARTED_AT" --arg completed "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg launcher_status "$1" --argjson codex_exit "${2:-null}" --argjson result_valid "${3:-false}" \
    --arg baseline "${BASELINE:-}" --arg session_id "${CODEX_SESSION_ID:-}" \
    --arg session_pointer "${SESSION_POINTER:-}" --arg resume_source "${RESUME_SOURCE:-}" \
    --rawfile changed "$changed_file" --rawfile staged "$staged_file" --rawfile untracked "$untracked_file" \
    'def lines($value): $value | split("\n") | map(select(length > 0));
      # Bound both count and retained path bytes: count alone cannot cap reports
      # containing unusually long paths. The full file remains available for totals.
      def capped($value):
        lines($value) as $all
        | reduce $all[] as $item (
            {items:[], bytes:0, accepting:true};
            if .accepting and (.items | length) < 100 and
              (.bytes + ($item | utf8bytelength)) <= 8192
            then .items += [$item] | .bytes += ($item | utf8bytelength)
            else .accepting = false
            end
          )
        | .total_count = ($all | length)
        | .truncated = ((.items | length) < .total_count);
      def truncation($list): {truncated:true, total_count:$list.total_count};
      capped($changed) as $modified
      | capped($staged) as $staged_paths
      | capped($untracked) as $untracked_paths
      | ({}
          + (if $modified.truncated then {modified:truncation($modified)} else {} end)
          + (if $staged_paths.truncated then {staged:truncation($staged_paths)} else {} end)
          + (if $untracked_paths.truncated then {untracked:truncation($untracked_paths)} else {} end)
        ) as $truncations
      | ({launcher_status:$launcher_status, run_dir:$run_dir, mode:$mode, model:$model,
      sandbox:$sandbox, workspace:$workspace, baseline_commit:$baseline,
      codex_exit_code:$codex_exit, result_file_valid:$result_valid,
      codex_session_id:($session_id | if . == "" then null else . end),
      session_pointer:($session_pointer | if . == "" then null else . end),
      resume_source:($resume_source | if . == "" then null else . end),
      actual_changes:{modified:$modified.items, staged:$staged_paths.items, untracked:$untracked_paths.items},
      started_at:$started, completed_at:$completed,
      result_file:($run_dir+"/result.json"), stderr_file:($run_dir+"/stderr.log")}
      + if $truncations == {} then {} else {actual_changes_truncation:$truncations} end)' \
    > "$report_tmp" 2>/dev/null &&
    jq -se 'length == 1 and (.[0] | type == "object" and (.launcher_status | type == "string"))' "$report_tmp" >/dev/null 2>&1 &&
    mv -f "$report_tmp" "$RUN_DIR/report.json"; then
    rm -f "$changed_file" "$staged_file" "$untracked_file" "$fallback_tmp"
    cat "$RUN_DIR/report.json"
    return 0
  fi
  rm -f "$changed_file" "$staged_file" "$untracked_file" "$report_tmp"
  # Keep waiters from hanging even when jq or primary report construction fails.
  if printf '%s\n' '{"launcher_status":"report_generation_failed"}' > "$fallback_tmp" 2>/dev/null &&
    mv -f "$fallback_tmp" "$RUN_DIR/report.json" 2>/dev/null; then
    cat "$RUN_DIR/report.json"
  fi
  return 0
}

# Resolve once before detaching so the child cannot observe a different pointer value.
if [ -z "$RESUME_ID" ] && [ "$RESUME_FROM_POINTER" -eq 1 ]; then
  if WORKSPACE_SLUG=$(derive_workspace_slug "$WORKSPACE"); then
    POINTER_PATH="$HOME/.local/state/codex-wrapper/$WORKSPACE_SLUG.session"
    if [ ! -e "$POINTER_PATH" ]; then
      RESUME_SOURCE="pointer_missing_fell_back_to_persist"
    else
      POINTER_SIZE=""
      [ -f "$POINTER_PATH" ] && POINTER_SIZE=$(wc -c < "$POINTER_PATH" 2>/dev/null) || POINTER_SIZE=""
      POINTER_BYTES_VALID=0
      case "$POINTER_SIZE" in
        36) POINTER_BYTES_VALID=1 ;;
        37) [ "$(tail -c 1 "$POINTER_PATH" 2>/dev/null | od -An -t u1 | tr -d ' ')" = "10" ] && POINTER_BYTES_VALID=1 ;;
      esac
      if [ "$POINTER_BYTES_VALID" -eq 1 ]; then
        POINTER_ID=$(cat "$POINTER_PATH" 2>/dev/null)
      else
        POINTER_ID=""
      fi
      if [ "$POINTER_BYTES_VALID" -eq 1 ] && valid_session_id "$POINTER_ID"; then
        RESUME_ID="$POINTER_ID"
        RESUME_SOURCE="pointer"
      else
        RESUME_SOURCE="pointer_invalid_fell_back_to_persist"
      fi
    fi
  else
    RESUME_SOURCE="pointer_missing_fell_back_to_persist"
  fi
fi

BASELINE=$(git_list rev-parse HEAD)

# Implementation requires a clean tree: without it, worker-change attribution is guesswork.
if [ "$MODE" = "implementation" ]; then
  if [ -n "$(git_list status --porcelain)" ]; then
    report "blocked_dirty_tree" null false
    exit 3
  fi
fi

# ---- Detached mode: hand the full codex+report flow to a setsid child that
# survives the caller's process-group kill (the Bash tool's 10-minute cap),
# then return the run dir immediately. Poll with --wait. ----
if [ "$DETACH" -eq 1 ]; then
  PERSIST_OPT=""; [ "$PERSIST" -eq 1 ] && PERSIST_OPT="--persist"
  setsid "$0" --mode "$MODE" --model "$MODEL" --workspace "$WORKSPACE" \
    --prompt-file "$RUN_DIR/prompt.md" --effort "$EFFORT" ${TIER:+--tier "$TIER"} \
    ${PERSIST_OPT:+$PERSIST_OPT} ${RESUME_ID:+--resume "$RESUME_ID"} \
    --resume-source "$RESUME_SOURCE" --run-dir "$RUN_DIR" \
    >/dev/null 2>>"$RUN_DIR/detach.log" </dev/null &
  jq -n --arg run_dir "$RUN_DIR" --arg pid "$!" \
    '{launcher_status:"detached", run_dir:$run_dir, child_pid:($pid|tonumber)}'
  exit 0
fi

# Session-id channel: PRIMARY is this run's own "session id: <uuid>" banner line in
# stderr.log (codex-cli 0.144.5) — unambiguous per-run, unaffected by concurrent sessions.
extract_session_id() {
  local sid newest
  sid=$(grep -iE 'session id:' "$RUN_DIR/stderr.log" 2>/dev/null \
    | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  if [ -n "$sid" ]; then printf '%s\n' "$sid"; return; fi
  # Fallback (ambiguous under concurrency): newest rollout file in the shared sessions
  # tree written after our marker; a parallel run's file can win the race.
  newest=$(find "$HOME/.codex/sessions" -name 'rollout-*.jsonl' -newer "$RUN_DIR/.sid_marker" \
    -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
  [ -n "$newest" ] && basename "$newest" \
    | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1
}

write_session_pointer() {
  local workspace_slug pointer_dir pointer_path
  [ -n "$CODEX_SESSION_ID" ] || return 0
  workspace_slug=$(derive_workspace_slug "$WORKSPACE") || return 0
  pointer_dir="$HOME/.local/state/codex-wrapper"
  pointer_path="$pointer_dir/$workspace_slug.session"
  # Session continuity must survive /tmp cleanup, but pointer failures must not affect the run.
  if {
    mkdir -p "$pointer_dir" &&
      printf '%s\n' "$CODEX_SESSION_ID" > "$pointer_path"
  } 2>/dev/null; then
    SESSION_POINTER="$pointer_path"
  fi
  return 0
}
: > "$RUN_DIR/.sid_marker"

if [ -n "$RESUME_ID" ]; then
  # resume subcommand accepts neither -C nor --sandbox; cd into the workspace and
  # set the sandbox via config override to follow the mode map. Reuse the passed-in session id.
  ( cd "$WORKSPACE" && codex exec resume "$RESUME_ID" \
      -m "$MODEL_ID" \
      -c model_reasoning_effort="$EFFORT" \
      ${TIER:+-c service_tier="$TIER"} \
      -c sandbox_mode="$SANDBOX" \
      --output-schema "$SCHEMA" \
      --output-last-message "$RUN_DIR/result.json" \
      - < "$RUN_DIR/prompt.md" > "$RUN_DIR/stdout.log" 2> "$RUN_DIR/stderr.log" )
  CODEX_EXIT=$?
  CODEX_SESSION_ID="$RESUME_ID"
elif [ "$PERSIST" -eq 1 ]; then
  # Persisted (standing) run: identical to the ephemeral path but WITHOUT --ephemeral.
  codex exec \
    -C "$WORKSPACE" \
    -m "$MODEL_ID" \
    -c model_reasoning_effort="$EFFORT" \
    ${TIER:+-c service_tier="$TIER"} \
    --sandbox "$SANDBOX" \
    --output-schema "$SCHEMA" \
    --output-last-message "$RUN_DIR/result.json" \
    - < "$RUN_DIR/prompt.md" > "$RUN_DIR/stdout.log" 2> "$RUN_DIR/stderr.log"
  CODEX_EXIT=$?
  CODEX_SESSION_ID=$(extract_session_id)
else
  codex exec \
    --ephemeral \
    -C "$WORKSPACE" \
    -m "$MODEL_ID" \
    -c model_reasoning_effort="$EFFORT" \
    ${TIER:+-c service_tier="$TIER"} \
    --sandbox "$SANDBOX" \
    --output-schema "$SCHEMA" \
    --output-last-message "$RUN_DIR/result.json" \
    - < "$RUN_DIR/prompt.md" > "$RUN_DIR/stdout.log" 2> "$RUN_DIR/stderr.log"
  CODEX_EXIT=$?
  CODEX_SESSION_ID=""
fi

if [ "$PERSIST" -eq 1 ]; then
  write_session_pointer
fi

RESULT_VALID=false
[ -s "$RUN_DIR/result.json" ] && jq empty "$RUN_DIR/result.json" 2>/dev/null && RESULT_VALID=true

if [ "$CODEX_EXIT" -ne 0 ]; then STATUS="codex_failed"
elif [ "$RESULT_VALID" != "true" ]; then STATUS="invalid_result"
else STATUS="ok"; fi

report "$STATUS" "$CODEX_EXIT" "$RESULT_VALID"
[ "$STATUS" = "ok" ]
