#!/bin/bash
# Fixed OpenCode launcher. The opencode-wrapper agent may only invoke this script.
# Requires a real OpenCode ELF binary, not a network-resolving shim. The observed
# version is recorded, not pinned. Receipts support the 1.18.x .info.model shape
# and the 1.1.x .messages[0].info shape, and fail closed when neither is complete.
# Set OPENCODE_SEAT_BIN to an explicit binary when the opencode found on PATH is a shim.
set -uo pipefail

MODEL="opencode-go/glm-5.3"
VARIANT="high"
RUN_ROOT="/tmp/opencode-seat"
MAX_CANDIDATES=10000
MAX_FINGERPRINT_BYTES=524288000
INVOCATION_TIMEOUT_S=480
EXPORT_TIMEOUT_S=30

usage() {
  cat >&2 <<'EOF'
usage: [OPENCODE_SEAT_BIN=<real-opencode-binary>] run-opencode-seat.sh --mode implementation|review --workspace <dir> --prompt-file <path> [--scope-file <path>] (implementation requires --scope-file; review forbids it)
The observed OpenCode version is recorded, not pinned. Receipt extraction supports 1.18.x .info.model and 1.1.x .messages[0].info shapes and fails closed when neither supplies a non-empty provider and model id.
EOF
  exit 64
}

MODE="" WORKSPACE="" PROMPT_FILE="" SCOPE_FILE=""
MODE_COUNT=0 WORKSPACE_COUNT=0 PROMPT_COUNT=0 SCOPE_COUNT=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode) [ "$#" -ge 2 ] || usage; MODE=$2; MODE_COUNT=$((MODE_COUNT + 1)); shift 2 ;;
    --workspace) [ "$#" -ge 2 ] || usage; WORKSPACE=$2; WORKSPACE_COUNT=$((WORKSPACE_COUNT + 1)); shift 2 ;;
    --prompt-file) [ "$#" -ge 2 ] || usage; PROMPT_FILE=$2; PROMPT_COUNT=$((PROMPT_COUNT + 1)); shift 2 ;;
    --scope-file) [ "$#" -ge 2 ] || usage; SCOPE_FILE=$2; SCOPE_COUNT=$((SCOPE_COUNT + 1)); shift 2 ;;
    *) usage ;;
  esac
done

[ "$MODE_COUNT" -eq 1 ] && [ "$WORKSPACE_COUNT" -eq 1 ] && [ "$PROMPT_COUNT" -eq 1 ] || usage
case "$MODE" in
  implementation) [ "$SCOPE_COUNT" -eq 1 ] || usage ;;
  review) [ "$SCOPE_COUNT" -eq 0 ] || usage ;;
  *) usage ;;
esac

for dependency in jq flock timeout setsid sha256sum base64 realpath mktemp; do
  command -v "$dependency" >/dev/null 2>&1 || {
    echo "run-opencode-seat.sh requires $dependency" >&2
    exit 69
  }
done
[ -x /usr/bin/git ] && [ -x /usr/bin/env ] || {
  echo "run-opencode-seat.sh requires trusted git and env binaries" >&2
  exit 69
}

safe_git() {
  /usr/bin/env -i HOME="$HOME" PATH=/usr/bin:/bin GIT_OPTIONAL_LOCKS=0 \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
    /usr/bin/git -c core.fsmonitor=false -c core.pager=cat --no-pager "$@"
}

umask 077
if [ -L "$RUN_ROOT" ]; then
  echo "refusing symlinked run root: $RUN_ROOT" >&2
  exit 73
fi
mkdir -p "$RUN_ROOT" || { echo "cannot create run root: $RUN_ROOT" >&2; exit 73; }
[ "$(realpath -e -- "$RUN_ROOT" 2>/dev/null)" = "$RUN_ROOT" ] || {
  echo "refusing non-canonical run root: $RUN_ROOT" >&2
  exit 73
}
[ "$(stat -Lc '%u:%a' -- "$RUN_ROOT" 2>/dev/null)" = "$UID:700" ] || {
  echo "refusing run without a current-UID-owned mode-0700 run root: $RUN_ROOT" >&2
  exit 73
}
RUN_DIR=$(mktemp -d "$RUN_ROOT/run-XXXXXXXX") || { echo "cannot create OpenCode run directory" >&2; exit 73; }

validate_run_dir() {
  local canonical parent base
  [ -d "$1" ] && [ ! -L "$1" ] || return 1
  canonical=$(realpath -e -- "$1" 2>/dev/null) || return 1
  [ "$canonical" = "$1" ] || return 1
  parent=${canonical%/*}
  base=${canonical##*/}
  [ "$parent" = "$RUN_ROOT" ] && [[ "$base" =~ ^run-[A-Za-z0-9]{8}$ ]]
}
validate_run_dir "$RUN_DIR" || { echo "invalid OpenCode run directory: $RUN_DIR" >&2; exit 73; }

START_EPOCH=$(date +%s)
WORKER_DIR="$RUN_DIR/worker"
mkdir -m 700 "$WORKER_DIR" || { echo "cannot create OpenCode worker directory" >&2; exit 73; }
EVENTS_PATH="$RUN_DIR/events.jsonl"
STDERR_PATH="$RUN_DIR/stderr.log"
EXPORT_RAW_PATH="$RUN_DIR/export.raw"
EXPORT_JSON_PATH="$RUN_DIR/export.json"
WORKER_RESULT_PATH="$RUN_DIR/worker-result.json"
CHANGED_PATHS_Z="$RUN_DIR/changed-paths.z"
OUT_OF_SCOPE_PATHS_Z="$RUN_DIR/out-of-scope-paths.z"
: > "$EVENTS_PATH"
: > "$STDERR_PATH"
: > "$EXPORT_RAW_PATH"
: > "$EXPORT_JSON_PATH"
: > "$WORKER_RESULT_PATH"
: > "$CHANGED_PATHS_Z"
: > "$OUT_OF_SCOPE_PATHS_Z"

RECEIPT_PROVIDER="" RECEIPT_MODEL="" RECEIPT_VARIANT=""
OPENCODE_VERSION="" SESSION_ID="" EXPORT_SUMMARY='{}'
ATTRIBUTION_COMPLETE=1 RESULT_VALID=0 WORKER_RESULT_JSON=null
OPENCODE_EXIT=0 ACTIVE_PGID=""

json_array_from_nul_file() {
  jq -Rs 'split("\u0000") | map(select(length > 0))' "$1"
}

publish_report_once() {
  local status=$1 reported_exit=$2 result_valid=$3 report_tmp duration changed_json out_of_scope_json
  report_tmp="$RUN_DIR/.report.json.$$"
  duration=$(($(date +%s) - START_EPOCH))
  changed_json=$(json_array_from_nul_file "$CHANGED_PATHS_Z" 2>/dev/null || printf '[]')
  out_of_scope_json=$(json_array_from_nul_file "$OUT_OF_SCOPE_PATHS_Z" 2>/dev/null || printf '[]')
  if [ -s "$WORKER_RESULT_PATH" ] && jq -e 'type == "object"' "$WORKER_RESULT_PATH" >/dev/null 2>&1; then
    WORKER_RESULT_JSON=$(jq -c . "$WORKER_RESULT_PATH")
  else
    WORKER_RESULT_JSON=null
  fi
  jq -n \
    --arg launcher_status "$status" --arg mode "$MODE" --arg requested_model "$MODEL" \
    --arg provider "$RECEIPT_PROVIDER" --arg model_id "$RECEIPT_MODEL" --arg variant "$RECEIPT_VARIANT" \
    --arg opencode_version "$OPENCODE_VERSION" --arg session_id "$SESSION_ID" \
    --argjson export_summary "$EXPORT_SUMMARY" --argjson exit_code "$reported_exit" --argjson duration_s "$duration" \
    --argjson changed_paths "$changed_json" --argjson out_of_scope_paths "$out_of_scope_json" \
    --argjson attribution_complete "$ATTRIBUTION_COMPLETE" --argjson result_valid "$result_valid" \
    --argjson worker_result "$WORKER_RESULT_JSON" --arg events_path "$EVENTS_PATH" --arg run_dir "$RUN_DIR" \
    '{launcher_status:$launcher_status,mode:$mode,requested_model:$requested_model,
      receipt:{providerID:$provider,modelID:$model_id,variant:$variant},
      opencode_version:$opencode_version,session_id:$session_id,export_summary:$export_summary,
      exit_code:$exit_code,duration_s:$duration_s,changed_paths:$changed_paths,
      out_of_scope_paths:$out_of_scope_paths,attribution_complete:($attribution_complete == 1),
      result_valid:($result_valid == 1),worker_result:$worker_result,
      events_path:$events_path,run_dir:$run_dir}' > "$report_tmp" 2>/dev/null || return 1
  ln "$report_tmp" "$RUN_DIR/report.json" 2>/dev/null || {
    rm -f "$report_tmp"
    return 1
  }
  rm -f "$report_tmp"
}

finish() {
  local status=$1 reported_exit=$2 shell_exit=$3 result_valid=${4:-0}
  if ! publish_report_once "$status" "$reported_exit" "$result_valid"; then
    echo "cannot atomically publish terminal report: $RUN_DIR/report.json" >&2
    exit 73
  fi
  cat "$RUN_DIR/report.json"
  exit "$shell_exit"
}

canonical_regular_file() {
  local canonical links
  [ -f "$1" ] && [ ! -L "$1" ] || return 1
  canonical=$(realpath -e -- "$1" 2>/dev/null) || return 1
  links=$(stat -Lc %h -- "$1" 2>/dev/null) || return 1
  [ "$links" = 1 ] && printf '%s\n' "$canonical"
}

is_elf_executable() {
  local magic
  [ -f "$1" ] && [ -x "$1" ] || return 1
  IFS= read -r -n 4 magic < "$1" || return 1
  [ "$magic" = $'\x7fELF' ]
}

reject_opencode_shim() {
  local rejected_path=$1 detail=${2:-}
  echo "OpenCode seat rejected $rejected_path: the resolved opencode is a network-resolving shim or otherwise not a runnable ELF binary${detail:+ ($detail)} and cannot run inside the sandbox. Set OPENCODE_SEAT_BIN to a real OpenCode binary." >&2
  finish "blocked_opencode_shim_detected" 69 69 0
}

if [ "${CODEX_WRAPPER_GATEWAY:-}" = "" ]; then
  echo "Refusing: no OpenCode wrapper route marker. Dispatch via opencode-wrapper." >&2
  finish "blocked_no_gateway_marker" 6 6 0
fi
if [ "$CODEX_WRAPPER_GATEWAY" != "opencode-wrapper" ]; then
  echo "Refusing: invalid OpenCode wrapper route marker: $CODEX_WRAPPER_GATEWAY" >&2
  finish "blocked_invalid_gateway_marker" 6 6 0
fi

WORKSPACE=$(realpath -e -- "$WORKSPACE" 2>/dev/null) || finish "blocked_invalid_workspace" 64 64 0
[ -d "$WORKSPACE" ] && [ ! -L "$WORKSPACE" ] || finish "blocked_invalid_workspace" 64 64 0
GIT_ROOT=$(safe_git -C "$WORKSPACE" rev-parse --show-toplevel 2>/dev/null) || {
  echo "workspace must be inside a git repository: $WORKSPACE" >&2
  finish "blocked_non_git_workspace" 64 64 0
}
GIT_ROOT=$(realpath -e -- "$GIT_ROOT" 2>/dev/null) || finish "blocked_invalid_workspace" 64 64 0
GIT_MARKER="$GIT_ROOT/.git"
[ -e "$GIT_MARKER" ] && [ ! -L "$GIT_MARKER" ] || finish "blocked_invalid_git_metadata" 64 64 0
GIT_DIR=$(safe_git -C "$GIT_ROOT" rev-parse --absolute-git-dir 2>/dev/null) || finish "blocked_invalid_git_metadata" 64 64 0
GIT_COMMON_DIR=$(safe_git -C "$GIT_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || finish "blocked_invalid_git_metadata" 64 64 0
GIT_DIR=$(realpath -e -- "$GIT_DIR" 2>/dev/null) || finish "blocked_invalid_git_metadata" 64 64 0
GIT_COMMON_DIR=$(realpath -e -- "$GIT_COMMON_DIR" 2>/dev/null) || finish "blocked_invalid_git_metadata" 64 64 0

PROMPT_FILE=$(canonical_regular_file "$PROMPT_FILE") || {
  echo "prompt file must be a regular non-symlink single-link file" >&2
  finish "blocked_invalid_prompt_file" 64 64 0
}
if [ "$MODE" = implementation ]; then
  SCOPE_FILE=$(canonical_regular_file "$SCOPE_FILE") || {
    echo "scope file must be a regular non-symlink single-link file" >&2
    finish "blocked_invalid_scope_file" 64 64 0
  }
fi
cp -- "$PROMPT_FILE" "$RUN_DIR/prompt.md" || finish "internal_prompt_copy_failed" 73 73 0
[ "$MODE" = review ] || cp -- "$SCOPE_FILE" "$RUN_DIR/scope.txt" || finish "internal_scope_copy_failed" 73 73 0

OPENCODE_FROM_OVERRIDE=0
if [ -n "${OPENCODE_SEAT_BIN:-}" ]; then
  OPENCODE_FROM_OVERRIDE=1
  OPENCODE_OVERRIDE=$OPENCODE_SEAT_BIN
  OPENCODE_BIN=$(realpath -e -- "$OPENCODE_OVERRIDE" 2>/dev/null) || {
    echo "Invalid OPENCODE_SEAT_BIN: $OPENCODE_OVERRIDE must resolve to a regular executable ELF binary." >&2
    finish "blocked_opencode_seat_bin_invalid" 69 69 0
  }
  if ! is_elf_executable "$OPENCODE_BIN"; then
    echo "Invalid OPENCODE_SEAT_BIN: $OPENCODE_OVERRIDE resolved to $OPENCODE_BIN, which is not a regular executable ELF binary." >&2
    finish "blocked_opencode_seat_bin_invalid" 69 69 0
  fi
else
  OPENCODE_COMMAND=$(command -v opencode 2>/dev/null) || {
    echo "opencode is required; set OPENCODE_SEAT_BIN to a real OpenCode binary if the PATH entry is unavailable" >&2
    finish "blocked_missing_opencode" 69 69 0
  }
  OPENCODE_BIN=$(realpath -e -- "$OPENCODE_COMMAND" 2>/dev/null) || reject_opencode_shim "$OPENCODE_COMMAND"
  is_elf_executable "$OPENCODE_BIN" || reject_opencode_shim "$OPENCODE_BIN"
fi
BWRAP_BIN=$(command -v bwrap 2>/dev/null) || {
  echo "bubblewrap is required (install the bubblewrap package); refusing to run unsandboxed" >&2
  finish "blocked_missing_bubblewrap" 69 69 0
}

RESOLVER_TARGET=$(realpath -e -- /etc/resolv.conf 2>/dev/null) || finish "blocked_invalid_resolver" 69 69 0
RESOLVER_MOUNTS=()
if [[ "$RESOLVER_TARGET" == /run/* ]]; then
  resolver_parent=${RESOLVER_TARGET%/*}
  resolver_cursor=/run
  IFS=/ read -r -a resolver_parts <<< "${resolver_parent#/run/}"
  for resolver_part in "${resolver_parts[@]}"; do
    [ -n "$resolver_part" ] || continue
    resolver_cursor+="/$resolver_part"
    RESOLVER_MOUNTS+=(--dir "$resolver_cursor")
  done
  RESOLVER_MOUNTS+=(--file 8 "$RESOLVER_TARGET")
fi

valid_measured_process_group_id() {
  [[ "${1:-}" =~ ^[1-9][0-9]{0,9}$ ]] && [ "$1" -le 2147483647 ]
}

read_launcher_identity() {
  local pid_line pgid_line extra
  LAUNCHER_PID="" LAUNCHER_PGID=""
  [ -f "$1" ] && [ ! -L "$1" ] || return 1
  { IFS= read -r pid_line && IFS= read -r pgid_line && ! IFS= read -r extra; } < "$1" || return 1
  [[ "$pid_line" =~ ^pid=([1-9][0-9]{0,9})$ ]] || return 1
  LAUNCHER_PID=${BASH_REMATCH[1]}
  [[ "$pgid_line" =~ ^pgid=([1-9][0-9]{0,9})$ ]] || return 1
  LAUNCHER_PGID=${BASH_REMATCH[1]}
  [ "$LAUNCHER_PID" -gt 1 ] && valid_measured_process_group_id "$LAUNCHER_PGID" && [ "$LAUNCHER_PGID" -gt 1 ]
}

process_group_is_live() {
  ps -eo pgid=,stat= 2>/dev/null |
    awk -v pgid="$1" '$1 == pgid && $2 !~ /^Z/ { found=1; exit } END { exit found ? 0 : 1 }'
}

terminate_process_group() {
  local pgid=$1
  valid_measured_process_group_id "$pgid" && [ "$pgid" -gt 1 ] || return 1
  process_group_is_live "$pgid" || return 0
  kill -TERM -- "-$pgid" 2>/dev/null || true
  for _ in $(seq 1 30); do process_group_is_live "$pgid" || return 0; sleep 0.1; done
  kill -KILL -- "-$pgid" 2>/dev/null || true
  for _ in $(seq 1 30); do process_group_is_live "$pgid" || return 0; sleep 0.1; done
  ! process_group_is_live "$pgid"
}

cleanup_active_group() {
  local pgid=${ACTIVE_PGID:-}
  ACTIVE_PGID=""
  [ -n "$pgid" ] || return 0
  terminate_process_group "$pgid"
}

handle_signal() {
  local signal_exit=$1
  trap - HUP INT TERM
  cleanup_active_group || finish "opencode_interrupt_termination_failed" "$signal_exit" 74 0
  finish "opencode_interrupted" "$signal_exit" "$signal_exit" 0
}

trap 'cleanup_active_group || echo "failed to terminate active OpenCode process group" >&2' EXIT
trap 'handle_signal 129' HUP
trap 'handle_signal 130' INT
trap 'handle_signal 143' TERM

run_managed_process() {
  local stdout_path=$1 stderr_path=$2 timeout_s=$3
  shift 3
  if [ "${#RESOLVER_MOUNTS[@]}" -gt 0 ]; then
    exec 8</etc/resolv.conf || finish "blocked_invalid_resolver" 69 69 0
  fi
  rm -f -- "$RUN_DIR/launcher.pid"
  setsid bash -c '
    run_dir=$1
    shift
    child_pid=$$
    child_pgid=$(ps -o pgid= -p "$child_pid" 2>/dev/null | tr -d "[:space:]")
    case "$child_pgid" in ""|*[!0-9]*|0|1) exit 73 ;; esac
    [ "$child_pgid" = "$child_pid" ] || exit 73
    identity_tmp="$run_dir/.launcher.pid.$child_pid"
    printf "pid=%s\npgid=%s\n" "$child_pid" "$child_pgid" > "$identity_tmp" || exit 73
    mv -f "$identity_tmp" "$run_dir/launcher.pid" || exit 73
    exec "$@"
  ' bash "$RUN_DIR" timeout --signal=TERM --kill-after=10s "${timeout_s}s" "$@" \
    > "$stdout_path" 2>> "$stderr_path" &
  SPAWNED_PID=$!
  IDENTITY_READY=0
  for _ in $(seq 1 100); do
    if read_launcher_identity "$RUN_DIR/launcher.pid" && [ "$LAUNCHER_PID" = "$SPAWNED_PID" ]; then
      IDENTITY_READY=1
      break
    fi
    kill -0 "$SPAWNED_PID" 2>/dev/null || break
    sleep 0.01
  done
  if [ "$IDENTITY_READY" -ne 1 ]; then
    kill -TERM "$SPAWNED_PID" 2>/dev/null || true
    wait "$SPAWNED_PID" 2>/dev/null || true
    finish "internal_process_identity_failed" 73 73 0
  fi
  ACTIVE_PGID=$LAUNCHER_PGID
  wait "$SPAWNED_PID"
  MANAGED_EXIT=$?
  if process_group_is_live "$ACTIVE_PGID"; then
    cleanup_active_group || finish "opencode_process_termination_failed" "$MANAGED_EXIT" 74 0
  else
    ACTIVE_PGID=""
  fi
}

SANDBOX_ISOLATION=(
  --proc /proc --tmpfs /run --tmpfs /tmp
  "${RESOLVER_MOUNTS[@]}"
  --unsetenv DBUS_SESSION_BUS_ADDRESS --unsetenv DISPLAY --unsetenv WAYLAND_DISPLAY
  --unsetenv SSH_AUTH_SOCK --unsetenv XAUTHORITY --unsetenv CODEX_WRAPPER_GATEWAY
)

run_managed_process "$RUN_DIR/version.out" "$STDERR_PATH" 15 \
  "$BWRAP_BIN" --die-with-parent --unshare-pid --ro-bind / / "${SANDBOX_ISOLATION[@]}" --dev /dev \
  --ro-bind "$OPENCODE_BIN" "$OPENCODE_BIN" --chdir / "$OPENCODE_BIN" --version
VERSION_STATUS=$MANAGED_EXIT
VERSION_OUTPUT=$(cat "$RUN_DIR/version.out" 2>/dev/null)
if [ "$VERSION_STATUS" -eq 124 ] || [ "$VERSION_STATUS" -eq 137 ]; then
  echo "OpenCode version check timed out; the observed version could not be recorded" >&2
  finish "blocked_opencode_version_timeout" 65 65 0
fi
if [ "$VERSION_STATUS" -ne 0 ]; then
  if [ "$VERSION_STATUS" -eq 127 ] && [ "$OPENCODE_FROM_OVERRIDE" -eq 0 ]; then
    reject_opencode_shim "$OPENCODE_BIN" "version check exited 127"
  fi
  echo "OpenCode version check failed (exit $VERSION_STATUS); the observed version could not be recorded" >&2
  finish "blocked_opencode_version_check_failed" 65 65 0
fi
OPENCODE_VERSION=$(printf '%s' "$VERSION_OUTPUT" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

for state_dir in "$HOME/.local/share/opencode" "$HOME/.config/opencode"; do
  [ -d "$state_dir" ] && [ ! -L "$state_dir" ] || {
    echo "required OpenCode state directory is missing or unsafe: $state_dir" >&2
    finish "blocked_invalid_opencode_state" 69 69 0
  }
done

LOCK_DIR="$RUN_ROOT/locks"
mkdir -m 700 -p "$LOCK_DIR" || finish "lock_setup_failed" 73 73 0
[ -d "$LOCK_DIR" ] && [ ! -L "$LOCK_DIR" ] &&
  [ "$(realpath -e -- "$LOCK_DIR" 2>/dev/null)" = "$LOCK_DIR" ] &&
  [ "$(stat -Lc '%u:%a' -- "$LOCK_DIR" 2>/dev/null)" = "$UID:700" ] ||
  finish "lock_setup_failed" 73 73 0
WORKSPACE_LOCK=$(printf '%s' "$GIT_ROOT" | sha256sum | cut -d' ' -f1)
exec 9>"$LOCK_DIR/$WORKSPACE_LOCK.lock" || finish "lock_setup_failed" 73 73 0
if ! flock -n 9; then
  finish "blocked_concurrent_dispatch" 4 4 0
fi

capture_candidates() {
  local prefix=$1
  safe_git -C "$GIT_ROOT" diff --no-ext-diff --no-textconv --name-only -z > "$prefix.modified" || return 1
  safe_git -C "$GIT_ROOT" diff --no-ext-diff --no-textconv --cached --name-only -z > "$prefix.staged" || return 1
  safe_git -C "$GIT_ROOT" ls-files --others --exclude-standard -z > "$prefix.untracked" || return 1
  safe_git -C "$GIT_ROOT" ls-files --others --ignored --exclude-standard -z > "$prefix.ignored" || return 1
  cat "$prefix.modified" "$prefix.staged" "$prefix.untracked" "$prefix.ignored" | sort -zu > "$prefix.candidates"
}

path_fingerprint() {
  local path=$1 full="$GIT_ROOT/$1" mode digest index_digest
  if [ -L "$full" ]; then
    mode=$(stat -c %f -- "$full" 2>/dev/null || printf unknown)
    digest=$(readlink -z -- "$full" 2>/dev/null | sha256sum | cut -d' ' -f1)
    printf 'symlink:%s:%s' "$mode" "$digest"
  elif [ -f "$full" ]; then
    mode=$(stat -c %f -- "$full" 2>/dev/null || printf unknown)
    digest=$(sha256sum -- "$full" 2>/dev/null | cut -d' ' -f1)
    printf 'file:%s:%s' "$mode" "$digest"
  elif [ -d "$full" ]; then
    mode=$(stat -c %f -- "$full" 2>/dev/null || printf unknown)
    printf 'directory:%s' "$mode"
  elif [ -e "$full" ]; then
    mode=$(stat -c '%f:%s:%y' -- "$full" 2>/dev/null || printf unknown)
    printf 'special:%s' "$mode"
  else
    printf absent
  fi
  index_digest=$(safe_git -C "$GIT_ROOT" ls-files --stage -z -- "$path" 2>/dev/null | sha256sum | cut -d' ' -f1)
  printf ':index:%s\n' "$index_digest"
}

snapshot_fingerprints() {
  local candidates=$1 output=$2 path path_b64 fingerprint size count=0 bytes=0
  : > "$output"
  while IFS= read -r -d '' path; do
    count=$((count + 1))
    if [ "$count" -gt "$MAX_CANDIDATES" ]; then
      ATTRIBUTION_COMPLETE=0
      break
    fi
    size=0
    [ ! -f "$GIT_ROOT/$path" ] || [ -L "$GIT_ROOT/$path" ] || size=$(stat -c %s -- "$GIT_ROOT/$path" 2>/dev/null || printf 0)
    if [ $((bytes + size)) -gt "$MAX_FINGERPRINT_BYTES" ]; then
      ATTRIBUTION_COMPLETE=0
      break
    fi
    bytes=$((bytes + size))
    path_b64=$(printf '%s' "$path" | base64 -w0)
    fingerprint=$(path_fingerprint "$path")
    printf '%s\t%s\n' "$path_b64" "$fingerprint" >> "$output"
  done < "$candidates"
}

glob_matches_path() {
  local pattern=$1 path=$2 regex='^' char next class i=0 j length
  case "$pattern" in /*|..|../*|*/../*|*/..) return 1 ;; esac
  length=${#pattern}
  while [ "$i" -lt "$length" ]; do
    char=${pattern:i:1}
    case "$char" in
      '*')
        next=${pattern:i+1:1}
        if [ "$next" = '*' ]; then
          if [ "${pattern:i+2:1}" = / ]; then regex+='(.*/)?'; i=$((i + 3)); else regex+='.*'; i=$((i + 2)); fi
        else
          regex+='[^/]*'; i=$((i + 1))
        fi
        ;;
      '?') regex+='[^/]'; i=$((i + 1)) ;;
      '[')
        j=$((i + 1))
        while [ "$j" -lt "$length" ] && [ "${pattern:j:1}" != ']' ]; do j=$((j + 1)); done
        [ "$j" -lt "$length" ] || return 1
        class=${pattern:i+1:j-i-1}
        [ -n "$class" ] && [[ "$class" != */* ]] && [[ "$class" != *\\* ]] || return 1
        case "$class" in '!'*) class="^${class:1}" ;; '^'*) class="\\${class}" ;; esac
        regex+="[$class]"
        i=$((j + 1))
        ;;
      '.'|'^'|'$'|'+'|'('|')'|'{'|'}'|'|'|'\\') regex+="\\$char"; i=$((i + 1)) ;;
      *) regex+="$char"; i=$((i + 1)) ;;
    esac
  done
  regex+='$'
  [[ "$path" =~ $regex ]]
}

safe_git -C "$GIT_ROOT" status --porcelain=v2 -z --untracked-files=all --ignored=matching > "$RUN_DIR/baseline-status.z" || {
  ATTRIBUTION_COMPLETE=0
  finish "blocked_attribution_baseline" 70 70 0
}
capture_candidates "$RUN_DIR/baseline" || {
  ATTRIBUTION_COMPLETE=0
  finish "blocked_attribution_baseline" 70 70 0
}
snapshot_fingerprints "$RUN_DIR/baseline.candidates" "$RUN_DIR/baseline-fingerprints.tsv"

PROMPT_CONTENT=$(cat "$RUN_DIR/prompt.md") || finish "internal_prompt_read_failed" 73 73 0
if [ "$MODE" = review ]; then
  WORKSPACE_BIND=(--ro-bind "$WORKSPACE" "$WORKSPACE")
else
  WORKSPACE_BIND=(--bind "$WORKSPACE" "$WORKSPACE")
fi
run_managed_process "$EVENTS_PATH" "$STDERR_PATH" "$INVOCATION_TIMEOUT_S" \
  "$BWRAP_BIN" --die-with-parent --unshare-pid --ro-bind / / "${SANDBOX_ISOLATION[@]}" --dev /dev \
  "${WORKSPACE_BIND[@]}" \
  --ro-bind "$OPENCODE_BIN" "$OPENCODE_BIN" \
  --ro-bind "$GIT_MARKER" "$GIT_MARKER" --ro-bind "$GIT_DIR" "$GIT_DIR" --ro-bind "$GIT_COMMON_DIR" "$GIT_COMMON_DIR" \
  --ro-bind "$RUN_DIR" "$RUN_DIR" \
  --bind "$WORKER_DIR" "$WORKER_DIR" \
  --bind "$HOME/.local/share/opencode" "$HOME/.local/share/opencode" \
  --bind "$HOME/.config/opencode" "$HOME/.config/opencode" \
  --chdir "$WORKSPACE" \
  "$OPENCODE_BIN" run --format json --model "$MODEL" --variant "$VARIANT" --auto --dir "$WORKSPACE" "$PROMPT_CONTENT"

OPENCODE_EXIT=$MANAGED_EXIT

safe_git -C "$GIT_ROOT" status --porcelain=v2 -z --untracked-files=all --ignored=matching > "$RUN_DIR/final-status.z" || ATTRIBUTION_COMPLETE=0
capture_candidates "$RUN_DIR/final" || ATTRIBUTION_COMPLETE=0
if [ -f "$RUN_DIR/final.candidates" ]; then
  { cat "$RUN_DIR/baseline.candidates" "$RUN_DIR/final.candidates"; } | sort -zu > "$RUN_DIR/all-candidates.z"
  FINAL_COUNT=0 FINAL_BYTES=0
  while IFS= read -r -d '' path; do
    FINAL_COUNT=$((FINAL_COUNT + 1))
    if [ "$FINAL_COUNT" -gt "$MAX_CANDIDATES" ]; then ATTRIBUTION_COMPLETE=0; break; fi
    size=0
    [ ! -f "$GIT_ROOT/$path" ] || [ -L "$GIT_ROOT/$path" ] || size=$(stat -c %s -- "$GIT_ROOT/$path" 2>/dev/null || printf 0)
    if [ $((FINAL_BYTES + size)) -gt "$MAX_FINGERPRINT_BYTES" ]; then ATTRIBUTION_COMPLETE=0; break; fi
    FINAL_BYTES=$((FINAL_BYTES + size))
    path_b64=$(printf '%s' "$path" | base64 -w0)
    before=$(awk -F '\t' -v key="$path_b64" '$1 == key { print $2; found=1; exit } END { if (!found) exit 1 }' "$RUN_DIR/baseline-fingerprints.tsv" 2>/dev/null || printf absent-from-baseline)
    after=$(path_fingerprint "$path")
    [ "$before" = "$after" ] || printf '%s\0' "$path" >> "$CHANGED_PATHS_Z"
  done < "$RUN_DIR/all-candidates.z"
fi

if [ "$MODE" = implementation ]; then
  while IFS= read -r -d '' path; do
    matched=0
    while IFS= read -r pattern || [ -n "$pattern" ]; do
      pattern=${pattern%$'\r'}
      case "$pattern" in ""|'#'*) continue ;; esac
      if glob_matches_path "$pattern" "$path"; then matched=1; break; fi
    done < "$RUN_DIR/scope.txt"
    [ "$matched" -eq 1 ] || printf '%s\0' "$path" >> "$OUT_OF_SCOPE_PATHS_Z"
  done < "$CHANGED_PATHS_Z"
fi

if [ "$OPENCODE_EXIT" -ne 0 ]; then
  if [ "$OPENCODE_EXIT" -eq 124 ] || [ "$OPENCODE_EXIT" -eq 137 ]; then
    finish "opencode_timeout" "$OPENCODE_EXIT" 68 0
  fi
  finish "opencode_failed" "$OPENCODE_EXIT" 72 0
fi

SESSION_ID=$(jq -r 'select(.sessionID? | type == "string") | .sessionID' "$EVENTS_PATH" 2>/dev/null | head -n 1)
if ! [[ "$SESSION_ID" =~ ^ses_[A-Za-z0-9_-]+$ ]]; then
  finish "blocked_missing_session_receipt" "$OPENCODE_EXIT" 70 0
fi
run_managed_process "$EXPORT_RAW_PATH" "$STDERR_PATH" "$EXPORT_TIMEOUT_S" \
  "$BWRAP_BIN" --die-with-parent --unshare-pid --ro-bind / / "${SANDBOX_ISOLATION[@]}" --dev /dev \
  --ro-bind "$WORKSPACE" "$WORKSPACE" \
  --ro-bind "$OPENCODE_BIN" "$OPENCODE_BIN" \
  --ro-bind "$GIT_MARKER" "$GIT_MARKER" --ro-bind "$GIT_DIR" "$GIT_DIR" --ro-bind "$GIT_COMMON_DIR" "$GIT_COMMON_DIR" \
  --bind "$HOME/.local/share/opencode" "$HOME/.local/share/opencode" \
  --bind "$HOME/.config/opencode" "$HOME/.config/opencode" \
  --chdir "$WORKSPACE" "$OPENCODE_BIN" export "$SESSION_ID"
EXPORT_STATUS=$MANAGED_EXIT
[ "$EXPORT_STATUS" -eq 0 ] || finish "blocked_receipt_export_failed" "$OPENCODE_EXIT" 70 0
if ! jq -e . "$EXPORT_RAW_PATH" > "$EXPORT_JSON_PATH" 2>/dev/null; then
  IFS= read -r EXPORT_FIRST_LINE < "$EXPORT_RAW_PATH" || EXPORT_FIRST_LINE=""
  case "$EXPORT_FIRST_LINE" in
    \{*) finish "blocked_receipt_unparseable" "$OPENCODE_EXIT" 70 0 ;;
  esac
  sed -n '/^{/,$p' "$EXPORT_RAW_PATH" > "$EXPORT_JSON_PATH"
  if ! jq -e . "$EXPORT_JSON_PATH" > "$RUN_DIR/export.parsed" 2>/dev/null; then
    finish "blocked_receipt_unparseable" "$OPENCODE_EXIT" 70 0
  fi
  mv -f "$RUN_DIR/export.parsed" "$EXPORT_JSON_PATH" || finish "internal_receipt_parse_failed" 73 73 0
fi
jq -e 'type == "object" and (.info | type == "object")' "$EXPORT_JSON_PATH" >/dev/null 2>&1 ||
  finish "blocked_invalid_receipt" "$OPENCODE_EXIT" 70 0
if ! RECEIPT_JSON=$(jq -c '
  def nonempty_string: type == "string" and length > 0;
  def complete: (.providerID | nonempty_string) and (.modelID | nonempty_string);
  [
    {providerID: .info.model.providerID, modelID: .info.model.id, variant: (.info.model.variant // "")},
    {providerID: .messages[0].info.model.providerID, modelID: .messages[0].info.modelID, variant: (.messages[0].info.variant // "")}
  ]
  | map(select(complete))
  | .[0] // empty
' "$EXPORT_JSON_PATH"); then
  finish "blocked_invalid_receipt" "$OPENCODE_EXIT" 70 0
fi
[ -n "$RECEIPT_JSON" ] || finish "blocked_invalid_receipt" "$OPENCODE_EXIT" 70 0
RECEIPT_PROVIDER=$(jq -r '.providerID' <<< "$RECEIPT_JSON")
RECEIPT_MODEL=$(jq -r '.modelID' <<< "$RECEIPT_JSON")
RECEIPT_VARIANT=$(jq -r '.variant' <<< "$RECEIPT_JSON")
EXPORT_SUMMARY=$(jq -c 'if (.info.summary | type) == "object" then .info.summary else {} end' "$EXPORT_JSON_PATH")
if [ "$RECEIPT_PROVIDER" != opencode-go ] || [ "$RECEIPT_MODEL" != glm-5.3 ] ||
  { [ -n "$RECEIPT_VARIANT" ] && [ "$RECEIPT_VARIANT" != "$VARIANT" ]; }; then
  finish "blocked_receipt_mismatch" "$OPENCODE_EXIT" 70 0
fi

jq -s '
  [ .[] | (.part.text? // .text? // empty) | select(type == "string") ] as $texts
  | [($texts | reverse[]), ($texts | join("\n"))]
  | map(. as $text
      | [$text,
         (try ($text | capture("(?s)```(?:json)?\\s*(?<body>\\{.*\\})\\s*```").body) catch empty),
         (try ($text | capture("(?s)(?<body>\\{.*\\})").body) catch empty)]
      | .[] | try fromjson catch empty)
  | map(select(type == "object"))
  | .[0] // empty
' "$EVENTS_PATH" > "$WORKER_RESULT_PATH" 2>/dev/null || :

if jq -e '
  type == "object" and
  (keys | sort) == ["changed_paths","status","summary","verification"] and
  (.status == "completed" or .status == "partial" or .status == "blocked" or .status == "failed") and
  (.summary | type == "string") and
  (.changed_paths | type == "array" and all(.[]; type == "string")) and
  (.verification | type == "array" and all(.[];
    type == "object" and
    (keys | sort) == ["command","evidence","exit_code"] and
    (.command | type == "string") and
    (.exit_code | type == "number" and floor == .) and
    (.evidence | type == "string")))
' "$WORKER_RESULT_PATH" >/dev/null 2>&1; then
  RESULT_VALID=1
fi

[ "$RESULT_VALID" -eq 1 ] || finish "blocked_invalid_worker_result" "$OPENCODE_EXIT" 71 0
if [ "$ATTRIBUTION_COMPLETE" -ne 1 ]; then finish "partial_attribution" "$OPENCODE_EXIT" 5 1; fi
if [ -s "$OUT_OF_SCOPE_PATHS_Z" ]; then finish "blocked_out_of_scope" "$OPENCODE_EXIT" 5 1; fi
if [ "$MODE" = review ] && [ -s "$CHANGED_PATHS_Z" ]; then finish "blocked_review_workspace_mutation" "$OPENCODE_EXIT" 5 1; fi
WORKER_STATUS=$(jq -r '.status' "$WORKER_RESULT_PATH")
[ "$WORKER_STATUS" = completed ] || finish "worker_$WORKER_STATUS" "$OPENCODE_EXIT" 5 1
finish "ok" "$OPENCODE_EXIT" 0 1
