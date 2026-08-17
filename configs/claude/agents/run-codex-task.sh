#!/bin/bash
# Fixed Codex launcher. The named Codex wrapper agents may ONLY execute this script.
# Owns: model allowlist, mode->sandbox mapping, unique run dirs, stdin prompt
# piping, exit-code capture, baseline-subtracted git snapshots, and a
# machine-readable report.
#
# Modes of invocation:
#   Foreground:  run-codex-task.sh --mode M --model X --workspace D --prompt-file F [--tier T]
#   Detached:    ... same args plus --detach   -> prints {launcher_status:"detached", run_dir}
#                and runs the codex+report flow in a setsid child that survives
#                the caller's 10-minute Bash-tool cap. launcher.pid is written as
#                two lines, pid=<decimal> then pgid=<decimal>; JSON also returns both.
#   Standing:    --persist drops --ephemeral so the session is recorded and resumable;
#                report.json carries codex_session_id. --resume <id> (UUID-shaped)
#                continues a recorded session (implies persist). --resume-from-pointer
#                reads the workspace's durable session pointer and falls back to a fresh
#                persisted run when it cannot. All work in any mode.
#   Wait/poll:   run-codex-task.sh --wait <run_dir> [--wait-seconds N]
#                blocks (<=N s, default 540) until report.json exists, then cats it
#                (exit 0 on launcher_status ok, 5 otherwise); prints
#                {"launcher_status":"died"} and exits 9 when a recorded group is dead,
#                or {"launcher_status":"still_running"} and exits 7 on poll timeout.
#   Abort:       run-codex-task.sh --abort <run_dir> terminates the recorded process
#                group and atomically publishes aborted (exit 8), or abort_failed
#                when identity/signal safety cannot be established (exit 10).
#                An existing report retains exit 0/5.
set -u

command -v jq >/dev/null 2>&1 || { echo "run-codex-task.sh requires jq (pacman -S jq / apt install jq)" >&2; exit 69; }

usage() { echo "usage: run-codex-task.sh --mode implementation|review|research --model sol|luna --workspace <dir> --prompt-file <path> [--brief-file <path> --brief-sha256 <64-hex>] [--attribution-path <repo-relative-path>] [--tier default|fast|priority|flex] [--persist] [--resume <session_id>] [--resume-from-pointer] [--detach] [--worktree-on-contention] | --wait <run_dir> [--wait-seconds <n>] | --abort <run_dir>  (--abort publishes aborted/exit 8 or abort_failed/exit 10; --wait reports died and exits 9; research requires sol and is read-only; efforts are model-fixed with no escalation: sol high in every mode, luna max; luna always runs the priority/fast tier; --attribution-path is Luna implementation only)" >&2; exit 64; }

# bare fallback: fail toward more thinking
MODE="" MODEL="" WORKSPACE="" PROMPT_FILE="" BRIEF_FILE="" BRIEF_SHA256="" BRIEF_EMBEDDED=0 ATTRIBUTION_PATH="" EFFORT="" EFFORT_ARG="" EFFORT_JUSTIFICATION="" EFFORT_SOURCE="" RESEARCH_DISPATCH=0 TIER="" DETACH=0 RUN_DIR_ARG="" WAIT_DIR="" WAIT_SECS=540 ABORT_DIR="" PERSIST=0 RESUME_ID="" RESUME_REQUESTED=0 RESUME_FROM_POINTER=0 RESUME_SOURCE_ARG="" RESUME_SOURCE="" CODEX_SESSION_ID="" SESSION_ID_SOURCE="none" SESSION_POINTER="" SESSION_POINTER_UPDATE="" SESSION_POINTER_HEALED=0 SESSION_POINTER_KEY="" WORKTREE_ON_CONTENTION=0 WORKTREE_PATH="" WORKTREE_ORIGIN="" BASELINE_SNAPSHOT_READY=0 BASELINE_GIT_ROOT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="${2:-}"; shift 2 || usage ;;
    --model) MODEL="${2:-}"; shift 2 || usage ;;
    --workspace) WORKSPACE="${2:-}"; shift 2 || usage ;;
    --prompt-file) PROMPT_FILE="${2:-}"; shift 2 || usage ;;
    --brief-file) BRIEF_FILE="${2:-}"; shift 2 || usage ;;
    --brief-sha256) BRIEF_SHA256="${2:-}"; shift 2 || usage ;;
    --attribution-path) ATTRIBUTION_PATH="${2:-}"; shift 2 || usage ;;
    --effort) EFFORT_ARG="${2:-}"; shift 2 || usage ;;
    --effort-justification) EFFORT_JUSTIFICATION="${2:-}"; shift 2 || usage ;;
    --tier) TIER="${2:-}"; shift 2 || usage ;;   # service_tier: the codex /fast equivalent ("priority")
    --persist) PERSIST=1; shift ;;
    --resume) RESUME_ID="${2:-}"; RESUME_REQUESTED=1; shift 2 || usage ;;
    --resume-from-pointer) RESUME_FROM_POINTER=1; shift ;;
    --resume-source) RESUME_SOURCE_ARG="${2:-}"; shift 2 || usage ;;   # internal: detached resolution result
    --detach) DETACH=1; shift ;;
    --worktree-on-contention) WORKTREE_ON_CONTENTION=1; shift ;;   # opt-in: run in an isolated worktree instead of exit 4
    --run-dir) RUN_DIR_ARG="${2:-}"; shift 2 || usage ;;   # internal: detached self-reinvocation
    --wait) WAIT_DIR="${2:-}"; shift 2 || usage ;;
    --wait-seconds) WAIT_SECS="${2:-}"; shift 2 || usage ;;
    --abort) ABORT_DIR="${2:-}"; shift 2 || usage ;;
    *) usage ;;
  esac
done

valid_measured_process_group_id() {
  local value="${1:-}"
  [[ "$value" =~ ^[1-9][0-9]{0,9}$ ]] && [ "$value" -le 2147483647 ]
}

valid_signal_process_group_id() {
  valid_measured_process_group_id "$1" && [ "$1" -gt 1 ]
}

read_launcher_identity() { # read_launcher_identity <launcher.pid>; sets LAUNCHER_PID/PGID
  local pid_line pgid_line extra
  LAUNCHER_PID="" LAUNCHER_PGID=""
  [ -f "$1" ] && [ ! -L "$1" ] || return 1
  {
    IFS= read -r pid_line || return 1
    IFS= read -r pgid_line || return 1
    ! IFS= read -r extra || return 1
  } < "$1"
  [[ "$pid_line" =~ ^pid=([1-9][0-9]{0,9})$ ]] || return 1
  LAUNCHER_PID="${BASH_REMATCH[1]}"
  [[ "$pgid_line" =~ ^pgid=([1-9][0-9]{0,9})$ ]] || return 1
  LAUNCHER_PGID="${BASH_REMATCH[1]}"
  [ "$LAUNCHER_PID" -gt 1 ] && [ "$LAUNCHER_PID" -le 2147483647 ] || return 1
  valid_signal_process_group_id "$LAUNCHER_PGID"
}

process_group_is_live() {
  ps -eo pgid=,stat= 2>/dev/null |
    awk -v pgid="$1" '$1 == pgid && $2 !~ /^Z/ { found=1; exit } END { exit found ? 0 : 1 }'
}

publish_report_once() { # publish_report_once <prepared-temp-file> <report.json>
  ln "$1" "$2" 2>/dev/null
}

validate_run_dir() { # validate_run_dir <path>; sets VALIDATED_RUN_DIR
  local canonical parent base
  VALIDATED_RUN_DIR=""
  [ -d "$1" ] && [ ! -L "$1" ] || return 1
  canonical=$(realpath -e -- "$1" 2>/dev/null) || return 1
  [ "$canonical" = "$1" ] || return 1
  parent=${canonical%/*}
  base=${canonical##*/}
  [ "$parent" = "/tmp/codex-wrapper" ] || return 1
  [[ "$base" =~ ^run-[A-Za-z0-9]{8}$ ]] || return 1
  VALIDATED_RUN_DIR="$canonical"
}

print_report_and_exit() { # print_report_and_exit <report.json>
  cat "$1"
  if [ -s "$1" ] &&
    jq -se 'length == 1 and (.[0] | type == "object" and (.launcher_status | type == "string"))' "$1" >/dev/null 2>&1 &&
    [ "$(jq -sr '.[0].launcher_status' "$1")" = "ok" ]; then
    exit 0
  fi
  exit 5
}

# ---- Abort mode: terminate only a recorded, safe process group and publish once. ----
if [ -n "$ABORT_DIR" ]; then
  [ -z "$WAIT_DIR" ] || usage
  validate_run_dir "$ABORT_DIR" || { echo "refusing invalid --abort run dir: $ABORT_DIR" >&2; exit 64; }
  ABORT_DIR="$VALIDATED_RUN_DIR"

  if [ -e "$ABORT_DIR/report.json" ] || [ -L "$ABORT_DIR/report.json" ]; then
    print_report_and_exit "$ABORT_DIR/report.json"
  fi

  ABORT_STATUS="aborted"
  ABORT_EXIT=8
  ABORT_FAILURE_REASON=""
  LAUNCHER_IDENTITY_PATH="$ABORT_DIR/launcher.pid"
  if [ -e "$LAUNCHER_IDENTITY_PATH" ] || [ -L "$LAUNCHER_IDENTITY_PATH" ]; then
    if read_launcher_identity "$LAUNCHER_IDENTITY_PATH"; then
      OWN_PGID=$(ps -o pgid= -p "$$" 2>/dev/null | tr -d '[:space:]')
      if ! valid_measured_process_group_id "$OWN_PGID"; then
        ABORT_FAILURE_REASON="own process group could not be measured safely"
      elif [ "$LAUNCHER_PGID" = "$OWN_PGID" ]; then
        ABORT_FAILURE_REASON="launcher process group is unsafe to signal"
      elif process_group_is_live "$LAUNCHER_PGID"; then
        kill -TERM -- "-$LAUNCHER_PGID" 2>/dev/null || true
        for _ in $(seq 1 30); do
          process_group_is_live "$LAUNCHER_PGID" || break
          sleep 0.1
        done
        if process_group_is_live "$LAUNCHER_PGID"; then
          kill -KILL -- "-$LAUNCHER_PGID" 2>/dev/null || true
          for _ in $(seq 1 30); do
            process_group_is_live "$LAUNCHER_PGID" || break
            sleep 0.1
          done
          if process_group_is_live "$LAUNCHER_PGID"; then
            ABORT_FAILURE_REASON="launcher process group remained live after TERM/KILL"
          fi
        fi
      fi
    elif [ -L "$LAUNCHER_IDENTITY_PATH" ]; then
      ABORT_FAILURE_REASON="launcher.pid is a symlink"
    elif [ ! -f "$LAUNCHER_IDENTITY_PATH" ]; then
      ABORT_FAILURE_REASON="launcher.pid is not a regular file"
    else
      ABORT_FAILURE_REASON="malformed launcher identity file"
    fi
  fi

  if [ -n "$ABORT_FAILURE_REASON" ]; then
    ABORT_STATUS="abort_failed"
    ABORT_EXIT=10
  fi

  if [ -e "$ABORT_DIR/report.json" ] || [ -L "$ABORT_DIR/report.json" ]; then
    print_report_and_exit "$ABORT_DIR/report.json"
  fi

  ABORT_REPORT_TMP="$ABORT_DIR/.report.abort.$$"
  if jq -n --arg status "$ABORT_STATUS" --arg run_dir "$ABORT_DIR" --arg reason "$ABORT_FAILURE_REASON" \
    '{launcher_status:$status, run_dir:$run_dir} + if $reason == "" then {} else {reason:$reason} end' \
    > "$ABORT_REPORT_TMP" 2>/dev/null &&
    publish_report_once "$ABORT_REPORT_TMP" "$ABORT_DIR/report.json"; then
    rm -f "$ABORT_REPORT_TMP"
    cat "$ABORT_DIR/report.json"
    if [ "$ABORT_STATUS" = "abort_failed" ]; then
      echo "abort failed: $ABORT_FAILURE_REASON; child could not be identified or stopped and must be found manually with: ps aux | grep run-codex-task" >&2
    fi
    exit "$ABORT_EXIT"
  fi
  rm -f "$ABORT_REPORT_TMP"
  if [ -e "$ABORT_DIR/report.json" ] || [ -L "$ABORT_DIR/report.json" ]; then
    print_report_and_exit "$ABORT_DIR/report.json"
  fi
  echo "cannot publish abort report: $ABORT_DIR/report.json" >&2
  exit 73
fi

# ---- Wait/poll mode: no codex involved, safe to call repeatedly. ----
if [ -n "$WAIT_DIR" ]; then
  validate_run_dir "$WAIT_DIR" || { echo "refusing invalid --wait run dir: $WAIT_DIR" >&2; exit 64; }
  WAIT_DIR="$VALIDATED_RUN_DIR"
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
    if [ -e "$WAIT_DIR/launcher.pid" ] && read_launcher_identity "$WAIT_DIR/launcher.pid" &&
      ! process_group_is_live "$LAUNCHER_PGID"; then
      jq -n --arg run_dir "$WAIT_DIR" '{launcher_status:"died", run_dir:$run_dir}'
      exit 9
    fi
    [ "$ELAPSED" -ge "$WAIT_SECS" ] && break
    sleep 5; ELAPSED=$((ELAPSED + 5))
  done
  jq -n --arg run_dir "$WAIT_DIR" '{launcher_status:"still_running", run_dir:$run_dir}'
  exit 7
fi

[ -n "$MODE" ] && [ -n "$MODEL" ] && [ -n "$WORKSPACE" ] && [ -n "$PROMPT_FILE" ] || usage

# Mode -> sandbox is decided HERE, in code. Effort is model-fixed, not
# mode-derived: sol is pinned at high, luna at max (resolved below).
case "$MODE" in
  implementation) SANDBOX="workspace-write" ;;
  review)         SANDBOX="read-only" ;;
  research)       SANDBOX="read-only"; RESEARCH_DISPATCH=1 ;;
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

# --worktree-on-contention only means anything where a lock is taken, so review mode
# would silently ignore it. Durable session state is keyed by repository identity, while
# a contention worktree has a different Git toplevel and therefore a different key.
# Normalize every persistence source first, then refuse every persistence/worktree pairing
# rather than no-op or resume/publish in the wrong namespace.
if [ "$WORKTREE_ON_CONTENTION" -eq 1 ]; then
  [ "$MODE" = "implementation" ] || { echo "--worktree-on-contention requires --mode implementation (review takes no lock)" >&2; exit 64; }
  [ "$PERSIST" -eq 0 ] || { echo "--worktree-on-contention cannot be combined with session persistence" >&2; exit 64; }
fi

# The wrapper identity and this allowlist jointly enforce fixed model routing.
# danger-full-access remains unreachable by design.
case "$MODEL" in
  sol)   MODEL_ID="gpt-5.6-sol" ;;
  sol-medium) MODEL_ID="gpt-5.6-sol" ;;
  luna)  MODEL_ID="gpt-5.6-luna" ;;
  *) echo "model not in allowlist: $MODEL" >&2; exit 64 ;;
esac

if [ "$MODE" = "research" ] && [ "$MODEL" != "sol" ]; then
  echo "research mode requires --model sol" >&2
  exit 64
fi

# Efforts are model-fixed with no escalation path: sol runs high in every mode
# (implementation, review, and research alike), luna runs max. A redundant
# --effort naming the fixed value is accepted; any other value, and any
# justification, is rejected.
case "$MODEL" in
  sol)   EFFORT="high"; EFFORT_SOURCE="model_default" ;;
  sol-medium) EFFORT="medium"; EFFORT_SOURCE="model_default" ;;
  luna)  EFFORT="max";  EFFORT_SOURCE="model_default" ;;
esac
if [ -n "$EFFORT_ARG" ]; then
  [ "$EFFORT_ARG" = "$EFFORT" ] || { echo "effort not allowed: $MODEL is fixed at $EFFORT in every mode" >&2; exit 64; }
  [ -z "$EFFORT_JUSTIFICATION" ] || { echo "$MODEL $EFFORT is fixed and takes no effort justification" >&2; exit 64; }
else
  [ -z "$EFFORT_JUSTIFICATION" ] || { echo "--effort-justification without --effort" >&2; exit 64; }
fi
case "$TIER" in
  fast) TIER="priority" ;;  # Config's display spelling; overrides require the API tier id.
  ""|default|priority|flex) ;;
  *) echo "tier not in allowlist: $TIER" >&2; exit 64 ;;
esac
# Luna always runs the priority ("fast") tier. A redundant fast/priority is
# accepted; any other explicit tier is rejected.
if [ "$MODEL" = "luna" ]; then
  case "$TIER" in
    ""|priority) TIER="priority" ;;
    *) echo "tier not allowed: luna is fixed at priority (fast)" >&2; exit 64 ;;
  esac
fi

if [ -n "$BRIEF_FILE" ] && [ -z "$BRIEF_SHA256" ]; then
  echo "--brief-file requires --brief-sha256" >&2
  exit 64
elif [ -n "$BRIEF_SHA256" ] && [ -z "$BRIEF_FILE" ]; then
  echo "--brief-sha256 requires --brief-file" >&2
  exit 64
fi
if [ -n "$BRIEF_SHA256" ]; then
  [[ "$BRIEF_SHA256" =~ ^[0-9a-f]{64}$ ]] || { echo "invalid --brief-sha256: $BRIEF_SHA256" >&2; exit 64; }
  [ -f "$BRIEF_FILE" ] || { echo "brief file not found: $BRIEF_FILE" >&2; exit 66; }
fi

[ -d "$WORKSPACE" ] || { echo "workspace not found: $WORKSPACE" >&2; exit 66; }
[ -f "$PROMPT_FILE" ] || { echo "prompt file not found: $PROMPT_FILE" >&2; exit 66; }

attribution_workspace_contract_is_safe() {
  local workspace_root tracked_files
  [ "$ATTRIBUTION_PATH" = "review.html" ] || return 1
  case "$ATTRIBUTION_GIT_ROOT" in /tmp/pr-review-render.????????) ;; *) return 1 ;; esac
  workspace_root=$(realpath "$WORKSPACE" 2>/dev/null) || return 1
  [ "$workspace_root" = "$ATTRIBUTION_GIT_ROOT" ] || return 1
  [ -f "$ATTRIBUTION_GIT_ROOT/.pr-review-workspace" ] &&
    [ ! -L "$ATTRIBUTION_GIT_ROOT/.pr-review-workspace" ] || return 1
  [ "$(cat "$ATTRIBUTION_GIT_ROOT/.pr-review-workspace" 2>/dev/null)" = "pr-review-render-workspace-v1" ] || return 1
  [ -f "$ATTRIBUTION_GIT_ROOT/.gitignore" ] &&
    [ ! -L "$ATTRIBUTION_GIT_ROOT/.gitignore" ] || return 1
  printf '/review.html\n' | cmp -s - "$ATTRIBUTION_GIT_ROOT/.gitignore" || return 1
  tracked_files=$(git -C "$ATTRIBUTION_GIT_ROOT" ls-files 2>/dev/null) || return 1
  [ "$tracked_files" = $'.gitignore\n.pr-review-workspace' ] || return 1
  git -C "$ATTRIBUTION_GIT_ROOT" diff --quiet HEAD -- .gitignore .pr-review-workspace || return 1
  if [ -f "$ATTRIBUTION_GIT_DIR/info/exclude" ] &&
    grep -Eq '^[[:space:]]*[^#[:space:]]' "$ATTRIBUTION_GIT_DIR/info/exclude"; then
    return 1
  fi
}

if [ -n "$ATTRIBUTION_PATH" ]; then
  [ "$MODE" = "implementation" ] && [ "$MODEL" = "luna" ] || { echo "--attribution-path requires Luna implementation mode" >&2; exit 64; }
  [ "$WORKTREE_ON_CONTENTION" -eq 0 ] || { echo "--attribution-path cannot be combined with --worktree-on-contention" >&2; exit 64; }
  case "$ATTRIBUTION_PATH" in ""|/*|../*|*/../*|*/..|.|..|*//* ) echo "invalid --attribution-path: $ATTRIBUTION_PATH" >&2; exit 64 ;; esac
  [[ "$ATTRIBUTION_PATH" =~ ^[A-Za-z0-9._/@^~:+-]+(/[A-Za-z0-9._@^~:+-]+)*$ ]] || { echo "invalid --attribution-path: $ATTRIBUTION_PATH" >&2; exit 64; }
  ATTRIBUTION_GIT_ROOT=$(git -C "$WORKSPACE" rev-parse --show-toplevel 2>/dev/null) || { echo "--attribution-path requires a Git workspace" >&2; exit 64; }
  ATTRIBUTION_GIT_ROOT=$(realpath "$ATTRIBUTION_GIT_ROOT" 2>/dev/null) || { echo "cannot resolve attribution Git root" >&2; exit 66; }
  ATTRIBUTION_FULL_PATH=$(realpath -m -- "$ATTRIBUTION_GIT_ROOT/$ATTRIBUTION_PATH" 2>/dev/null) || { echo "cannot resolve --attribution-path" >&2; exit 66; }
  case "$ATTRIBUTION_FULL_PATH" in "$ATTRIBUTION_GIT_ROOT"/*) ;; *) echo "--attribution-path escapes Git workspace" >&2; exit 64 ;; esac
  ATTRIBUTION_GIT_DIR=$(git -C "$ATTRIBUTION_GIT_ROOT" rev-parse --absolute-git-dir 2>/dev/null) || { echo "cannot resolve Git administrative directory" >&2; exit 66; }
  ATTRIBUTION_GIT_DIR=$(realpath "$ATTRIBUTION_GIT_DIR" 2>/dev/null) || { echo "cannot resolve Git administrative directory" >&2; exit 66; }
  ATTRIBUTION_GIT_COMMON_DIR=$(git -C "$ATTRIBUTION_GIT_ROOT" rev-parse --git-common-dir 2>/dev/null) || { echo "cannot resolve Git common directory" >&2; exit 66; }
  case "$ATTRIBUTION_GIT_COMMON_DIR" in /*) ;; *) ATTRIBUTION_GIT_COMMON_DIR="$ATTRIBUTION_GIT_ROOT/$ATTRIBUTION_GIT_COMMON_DIR" ;; esac
  ATTRIBUTION_GIT_COMMON_DIR=$(realpath "$ATTRIBUTION_GIT_COMMON_DIR" 2>/dev/null) || { echo "cannot resolve Git common directory" >&2; exit 66; }
  case "$ATTRIBUTION_FULL_PATH" in "$ATTRIBUTION_GIT_ROOT/.git"|"$ATTRIBUTION_GIT_ROOT/.git"/*) echo "--attribution-path cannot name the worktree .git entry" >&2; exit 64 ;; esac
  case "$ATTRIBUTION_FULL_PATH" in "$ATTRIBUTION_GIT_DIR"|"$ATTRIBUTION_GIT_DIR"/*) echo "--attribution-path cannot name a Git administrative directory" >&2; exit 64 ;; esac
  case "$ATTRIBUTION_FULL_PATH" in "$ATTRIBUTION_GIT_COMMON_DIR"|"$ATTRIBUTION_GIT_COMMON_DIR"/*) echo "--attribution-path cannot name the Git common directory" >&2; exit 64 ;; esac
  git -c core.excludesFile=/dev/null -C "$ATTRIBUTION_GIT_ROOT" check-ignore -q --no-index -- "$ATTRIBUTION_PATH" || { echo "--attribution-path must name an ignored path" >&2; exit 64; }
  [ ! -e "$ATTRIBUTION_FULL_PATH" ] && [ ! -L "$ATTRIBUTION_FULL_PATH" ] || { echo "--attribution-path must not exist before launch" >&2; exit 64; }
  attribution_workspace_contract_is_safe || { echo "--attribution-path requires an isolated PR review render workspace" >&2; exit 64; }
  [ -z "$(git -c core.excludesFile=/dev/null -C "$ATTRIBUTION_GIT_ROOT" status --porcelain=v1 --untracked-files=all 2>/dev/null)" ] || {
    echo "--attribution-path requires a clean isolated PR review render workspace" >&2
    exit 64
  }
fi

derive_workspace_slug() {
  local workspace_abs
  if workspace_abs=$(git -C "$1" rev-parse --show-toplevel 2>/dev/null); then
    workspace_abs=$(realpath "$workspace_abs" 2>/dev/null) || return 1
  else
    workspace_abs=$(realpath "$1" 2>/dev/null) || return 1
  fi
  [ -n "$workspace_abs" ] && [ "$workspace_abs" != "/" ] || return 1
  # Hash the full canonical repository/workspace path so separators cannot alias one another.
  printf '%s' "$workspace_abs" | sha256sum | cut -d' ' -f1
}

mkdir -p /tmp/codex-wrapper
if [ -n "$RUN_DIR_ARG" ]; then
  RUN_DIR="$RUN_DIR_ARG"
  [ -d "$RUN_DIR" ] || { echo "run dir not found: $RUN_DIR" >&2; exit 66; }
  BRIEF_FILE="" BRIEF_SHA256="" BRIEF_EMBEDDED=0
else
  RUN_DIR=$(mktemp -d /tmp/codex-wrapper/run-XXXXXXXX)
  cp "$PROMPT_FILE" "$RUN_DIR/prompt.md" || {
    echo "cannot read prompt file: $PROMPT_FILE" >&2
    exit 66
  }
  if [ -n "$BRIEF_FILE" ]; then
    cp "$BRIEF_FILE" "$RUN_DIR/brief.md" || {
      echo "cannot read brief file: $BRIEF_FILE" >&2
      exit 66
    }
    BRIEF_ACTUAL_SHA256=$(sha256sum "$RUN_DIR/brief.md" 2>/dev/null | cut -d' ' -f1)
    [ -n "$BRIEF_ACTUAL_SHA256" ] || {
      echo "cannot read copied brief file: $RUN_DIR/brief.md" >&2
      exit 66
    }
    # This parent-side refusal is synchronous: no detached child exists yet and the
    # caller receives exit 65 directly, so there is no waiter that needs report.json.
    [ "$BRIEF_ACTUAL_SHA256" = "$BRIEF_SHA256" ] || {
      echo "brief digest mismatch: declared $BRIEF_SHA256; computed $BRIEF_ACTUAL_SHA256" >&2
      exit 65
    }
    jq -n --arg brief_file "$BRIEF_FILE" --arg brief_sha256 "$BRIEF_SHA256" \
      '{brief_file:$brief_file, brief_sha256:$brief_sha256}' > "$RUN_DIR/brief.receipt.json" || {
      echo "cannot write brief receipt" >&2
      exit 73
    }
    printf '\n<<<BRIEF-VERBATIM sha256=%s>>>\n' "$BRIEF_SHA256" >> "$RUN_DIR/prompt.md"
    # The region between the delimiters is the brief verbatim, with a single newline
    # added only when the brief did not end in one.
    cat "$RUN_DIR/brief.md" >> "$RUN_DIR/prompt.md"
    LAST_BYTE=$(tail -c1 "$RUN_DIR/brief.md" | od -An -tu1 | tr -d '[:space:]')
    [ -s "$RUN_DIR/brief.md" ] && [ "$LAST_BYTE" != "10" ] && printf '\n' >> "$RUN_DIR/prompt.md"
    printf '<<<END-BRIEF-VERBATIM sha256=%s>>>\n' "$BRIEF_SHA256" >> "$RUN_DIR/prompt.md"
  fi
fi
SCHEMA="$HOME/.claude/agents/codex-result.schema.json"
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [ "$PERSIST" -eq 1 ]; then
  ORDERING_STAMP=$(date -u +%Y%m%dT%H%M%S.%N)
  ORDERING_PREFIX=${ORDERING_STAMP%.*}
  ORDERING_NANOS=${ORDERING_STAMP##*.}
  if [[ "$ORDERING_NANOS" =~ ^[0-9]{1,9}$ ]]; then
    printf -v ORDERING_NANOS '%09d' "$((10#$ORDERING_NANOS))"
  else
    ORDERING_NANOS="000000000"
  fi
  SESSION_POINTER_KEY="$ORDERING_PREFIX.${ORDERING_NANOS}Z-$(basename "$RUN_DIR")"
fi

git_list() {
  if [ -n "$ATTRIBUTION_PATH" ]; then
    git -c core.excludesFile=/dev/null -C "$WORKSPACE" "$@" 2>/dev/null
  else
    git -C "$WORKSPACE" "$@" 2>/dev/null
  fi
}

capture_dirty_lists() {  # capture_dirty_lists <prefix>; writes NUL-delimited path sets
  local prefix="$1"
  git_list diff --name-only -z > "$prefix-modified.z" || :
  git_list diff --cached --name-only -z > "$prefix-staged.z" || :
  git_list ls-files --full-name --others --exclude-standard -z > "$prefix-untracked.z" || :
  if [ -n "$ATTRIBUTION_PATH" ]; then
    local attribution_root="${BASELINE_GIT_ROOT:-$ATTRIBUTION_GIT_ROOT}"
    if [ -e "$attribution_root/$ATTRIBUTION_PATH" ] || [ -L "$attribution_root/$ATTRIBUTION_PATH" ]; then
      printf '%s\0' "$ATTRIBUTION_PATH" >> "$prefix-untracked.z"
      sort -zu -o "$prefix-untracked.z" "$prefix-untracked.z"
    fi
  fi
}

attribution_result_is_safe() {
  local resolved links
  [ -z "$ATTRIBUTION_PATH" ] && return 0
  attribution_workspace_contract_is_safe || return 1
  [ -f "$ATTRIBUTION_FULL_PATH" ] && [ ! -L "$ATTRIBUTION_FULL_PATH" ] || return 1
  resolved=$(realpath -e -- "$ATTRIBUTION_GIT_ROOT/$ATTRIBUTION_PATH" 2>/dev/null) || return 1
  [ "$resolved" = "$ATTRIBUTION_FULL_PATH" ] || return 1
  links=$(stat -c '%h' -- "$ATTRIBUTION_FULL_PATH" 2>/dev/null) || return 1
  [ "$links" = "1" ]
}

directory_tree_fingerprint() {  # ignore-aware content/type/mode hash with explicit bounds
  local root="$1" entry digest metadata size file_count=0 byte_count=0
  local bound_marker bound_file
  bound_file=$(mktemp "$RUN_DIR/.fingerprint-bound.XXXXXXXX") || return 1
  digest=$(
    (
      cd "$root" || exit 1
      while IFS= read -r -d '' entry; do
        file_count=$((file_count + 1))
        if [ "$file_count" -gt 10000 ]; then
          printf 'files\n' > "$bound_file"
          break
        fi
        if [ -f "$entry" ] && [ ! -L "$entry" ]; then
          size=$(stat -c '%s' -- "$entry" 2>/dev/null || printf '0')
          if [ $((byte_count + size)) -gt 524288000 ]; then
            printf 'bytes\n' > "$bound_file"
            break
          fi
          byte_count=$((byte_count + size))
        fi

        printf '%s\0' "$entry"
        if [ -L "$entry" ]; then
          metadata=$(stat -c '%f' -- "$entry" 2>/dev/null || printf 'unknown-mode')
          digest=$(readlink -z -- "$entry" 2>/dev/null | sha256sum | cut -d' ' -f1)
          printf 'symlink:%s:%s\0' "$metadata" "$digest"
        elif [ -f "$entry" ]; then
          if digest=$(sha256sum -- "$entry" 2>/dev/null); then
            digest=${digest%% *}
            metadata=$(stat -c '%f' -- "$entry" 2>/dev/null || printf 'unknown-mode')
            printf 'file:%s:%s\0' "$metadata" "$digest"
          else
            metadata=$(stat -c '%f:%s:%y:%z' -- "$entry" 2>/dev/null || printf 'stat-unavailable')
            printf 'unreadable:%s\0' "$metadata"
          fi
        elif [ -d "$entry" ]; then
          metadata=$(stat -c '%f' -- "$entry" 2>/dev/null || printf 'unknown-mode')
          printf 'directory:%s\0' "$metadata"
        elif [ -e "$entry" ]; then
          metadata=$(stat -c '%f:%s:%y:%z' -- "$entry" 2>/dev/null || printf 'stat-unavailable')
          printf 'special:%s\0' "$metadata"
        else
          printf 'absent\0'
        fi
      done < <(git ls-files --cached --others --exclude-standard -z | sort -z)
    ) | sha256sum | cut -d' ' -f1
  )
  if [ -s "$bound_file" ]; then
    bound_marker=$(cat "$bound_file")
    printf 'exceeded_fingerprint_bound:%s:%s\n' "$bound_marker" "$digest"
  else
    printf 'bounded:%s\n' "$digest"
  fi
  rm -f "$bound_file"
}

is_gitlink() {
  [ "$(git -C "$BASELINE_GIT_ROOT" ls-files --stage -- "$1" 2>/dev/null | awk 'NR == 1 { print $1; exit }')" = "160000" ]
}

path_fingerprint() {  # content/type/mode fingerprint; symlink targets are not followed
  local path="$1" full digest metadata
  full="$BASELINE_GIT_ROOT/$path"
  if [ -L "$full" ]; then
    digest=$(readlink -z -- "$full" 2>/dev/null | sha256sum | cut -d' ' -f1)
    printf 'symlink:%s\n' "$digest"
  elif [ -f "$full" ]; then
    if digest=$(sha256sum -- "$full" 2>/dev/null); then
      digest=${digest%% *}
      metadata=$(stat -c '%f' -- "$full" 2>/dev/null || printf 'unknown-mode')
      printf 'file:%s:%s\n' "$metadata" "$digest"
    else
      metadata=$(stat -c '%f:%s:%y:%z' -- "$full" 2>/dev/null || printf 'stat-unavailable')
      printf 'unreadable:%s\n' "$metadata"
    fi
  elif [ -d "$full" ] && is_gitlink "$path"; then
    digest=$(directory_tree_fingerprint "$full")
    printf 'gitlink:%s\n' "$digest"
  elif [ -d "$full" ]; then
    metadata=$(stat -c '%f:%s:%y:%z' -- "$full" 2>/dev/null || printf 'stat-unavailable')
    printf 'directory:%s\n' "$metadata"
  elif [ -e "$full" ]; then
    metadata=$(stat -c '%f:%s:%y:%z' -- "$full" 2>/dev/null || printf 'stat-unavailable')
    printf 'special:%s\n' "$metadata"
  else
    printf 'absent\n'
  fi
}

index_fingerprint() {
  git -C "$BASELINE_GIT_ROOT" ls-files --stage -z -- "$1" 2>/dev/null | sha256sum | cut -d' ' -f1
}

capture_baseline_state() {
  local path path_b64 worktree_fingerprint staged_fingerprint
  if ! BASELINE_GIT_ROOT=$(git_list rev-parse --show-toplevel); then
    BASELINE_GIT_ROOT="$WORKSPACE"
  fi
  BASELINE_MODIFIED_Z="$RUN_DIR/.baseline-modified.z"
  BASELINE_STAGED_Z="$RUN_DIR/.baseline-staged.z"
  BASELINE_UNTRACKED_Z="$RUN_DIR/.baseline-untracked.z"
  BASELINE_FINGERPRINTS="$RUN_DIR/.baseline-fingerprints.tsv"
  capture_dirty_lists "$RUN_DIR/.baseline"
  : > "$BASELINE_FINGERPRINTS"
  {
    cat "$BASELINE_MODIFIED_Z" "$BASELINE_STAGED_Z" "$BASELINE_UNTRACKED_Z"
  } | sort -zu > "$RUN_DIR/.baseline-paths.z"
  while IFS= read -r -d '' path; do
    path_b64=$(printf '%s' "$path" | base64 -w0)
    worktree_fingerprint=$(path_fingerprint "$path")
    staged_fingerprint=$(index_fingerprint "$path")
    printf '%s\t%s\t%s\n' "$path_b64" "$worktree_fingerprint" "$staged_fingerprint" >> "$BASELINE_FINGERPRINTS"
  done < "$RUN_DIR/.baseline-paths.z"
  BASELINE_SNAPSHOT_READY=1
}

baseline_fingerprints_for() {
  local path_b64
  path_b64=$(printf '%s' "$1" | base64 -w0)
  awk -F '\t' -v key="$path_b64" '
    $1 == key { print $2 "\t" $3; found=1; exit }
    END { if (!found) exit 1 }
  ' "$BASELINE_FINGERPRINTS"
}

path_changed_from_baseline() {  # path_changed_from_baseline <path> worktree|index
  local path="$1" dimension="$2" before before_worktree before_index after
  before=$(baseline_fingerprints_for "$path") || return 0
  IFS=$'\t' read -r before_worktree before_index <<< "$before"
  if [ "$dimension" = "index" ]; then
    after=$(index_fingerprint "$path")
    [ "$before_index" != "$after" ]
  elif [[ "$before_worktree" == gitlink:exceeded_fingerprint_bound:* ]]; then
    printf '%s\n' "$path" >> "$FINGERPRINT_BOUND_EXCEEDED_FILE"
    return 0
  else
    after=$(path_fingerprint "$path")
    [ "$before_worktree" != "$after" ]
  fi
}

attribute_paths() {  # baseline-set current-set worktree|index newline-output
  local baseline_set="$1" current_set="$2" dimension="$3" output="$4"
  local candidates attributed path
  candidates="$RUN_DIR/.report-candidates.$$.z"
  attributed="$RUN_DIR/.report-attributed.$$.z"
  { cat "$baseline_set" "$current_set"; } | sort -zu > "$candidates"
  : > "$attributed"
  while IFS= read -r -d '' path; do
    if path_changed_from_baseline "$path" "$dimension"; then
      printf '%s\0' "$path" >> "$attributed"
    fi
  done < "$candidates"
  tr '\0' '\n' < "$attributed" > "$output"
  rm -f "$candidates" "$attributed"
}

report() {  # report <status> <codex_exit> <result_valid>
  local changed_file staged_file untracked_file baseline_changed_file baseline_staged_file baseline_untracked_file bound_exceeded_file current_prefix report_tmp fallback_tmp
  changed_file="$RUN_DIR/.report-changed.$$"
  staged_file="$RUN_DIR/.report-staged.$$"
  untracked_file="$RUN_DIR/.report-untracked.$$"
  baseline_changed_file="$RUN_DIR/.report-baseline-changed.$$"
  baseline_staged_file="$RUN_DIR/.report-baseline-staged.$$"
  baseline_untracked_file="$RUN_DIR/.report-baseline-untracked.$$"
  bound_exceeded_file="$RUN_DIR/.report-bound-exceeded.$$"
  FINGERPRINT_BOUND_EXCEEDED_FILE="$bound_exceeded_file"
  current_prefix="$RUN_DIR/.report-current.$$"
  report_tmp="$RUN_DIR/.report.json.$$"
  fallback_tmp="$RUN_DIR/.report-fallback.$$"
  : > "$bound_exceeded_file"
  # File-backed arguments avoid the kernel's argv limit on very large workspaces.
  capture_dirty_lists "$current_prefix"
  if [ "$BASELINE_SNAPSHOT_READY" -eq 1 ]; then
    attribute_paths "$BASELINE_MODIFIED_Z" "$current_prefix-modified.z" worktree "$changed_file"
    attribute_paths "$BASELINE_STAGED_Z" "$current_prefix-staged.z" index "$staged_file"
    attribute_paths "$BASELINE_UNTRACKED_Z" "$current_prefix-untracked.z" worktree "$untracked_file"
    tr '\0' '\n' < "$BASELINE_MODIFIED_Z" > "$baseline_changed_file"
    tr '\0' '\n' < "$BASELINE_STAGED_Z" > "$baseline_staged_file"
    tr '\0' '\n' < "$BASELINE_UNTRACKED_Z" > "$baseline_untracked_file"
  else
    : > "$changed_file"
    : > "$staged_file"
    : > "$untracked_file"
    : > "$baseline_changed_file"
    : > "$baseline_staged_file"
    : > "$baseline_untracked_file"
  fi
  if jq -n \
    --arg run_dir "$RUN_DIR" --arg mode "$MODE" --arg model "$MODEL_ID" \
    --arg sandbox "$SANDBOX" --arg effort "$EFFORT" --arg effort_source "${EFFORT_SOURCE:-}" --arg effort_justification "${EFFORT_JUSTIFICATION:-}" --arg tier "${TIER:-}" --argjson research_dispatch "$RESEARCH_DISPATCH" --arg gateway_marker "${CODEX_WRAPPER_GATEWAY:-}" \
    --arg workspace "$WORKSPACE" --arg attribution_path "$ATTRIBUTION_PATH" --arg brief_file "$BRIEF_FILE" --arg brief_sha256 "$BRIEF_SHA256" --argjson brief_embedded "$BRIEF_EMBEDDED" \
    --arg started "$STARTED_AT" --arg completed "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg launcher_status "$1" --argjson codex_exit "${2:-null}" --argjson result_valid "${3:-false}" \
    --arg baseline "${BASELINE:-}" --arg session_id "${CODEX_SESSION_ID:-}" --arg session_id_source "${SESSION_ID_SOURCE:-none}" \
    --arg session_pointer "${SESSION_POINTER:-}" --arg session_pointer_update "${SESSION_POINTER_UPDATE:-}" \
    --argjson session_pointer_healed "${SESSION_POINTER_HEALED:-0}" --arg session_pointer_key "${SESSION_POINTER_KEY:-}" \
    --arg resume_source "${RESUME_SOURCE:-}" --arg worktree "${WORKTREE_PATH:-}" --arg worktree_origin "${WORKTREE_ORIGIN:-}" \
    --argjson baseline_snapshot_ready "$BASELINE_SNAPSHOT_READY" \
    --rawfile changed "$changed_file" --rawfile staged "$staged_file" --rawfile untracked "$untracked_file" \
    --rawfile baseline_changed "$baseline_changed_file" --rawfile baseline_staged "$baseline_staged_file" --rawfile baseline_untracked "$baseline_untracked_file" \
    --rawfile bound_exceeded "$bound_exceeded_file" \
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
      | capped($baseline_changed) as $baseline_modified
      | capped($baseline_staged) as $baseline_staged_paths
      | capped($baseline_untracked) as $baseline_untracked_paths
      | capped($bound_exceeded) as $bound_exceeded_paths
      | ({}
          + (if $modified.truncated then {modified:truncation($modified)} else {} end)
          + (if $staged_paths.truncated then {staged:truncation($staged_paths)} else {} end)
          + (if $untracked_paths.truncated then {untracked:truncation($untracked_paths)} else {} end)
        ) as $truncations
      | ({}
          + (if $baseline_modified.truncated then {modified:truncation($baseline_modified)} else {} end)
          + (if $baseline_staged_paths.truncated then {staged:truncation($baseline_staged_paths)} else {} end)
          + (if $baseline_untracked_paths.truncated then {untracked:truncation($baseline_untracked_paths)} else {} end)
        ) as $baseline_truncations
      | ({launcher_status:$launcher_status, run_dir:$run_dir, mode:$mode, model:$model,
      sandbox:$sandbox,
      effort:$effort,
      effort_source:($effort_source | if . == "" then null else . end),
      effort_justification:($effort_justification | if . == "" then null else . end),
      tier:($tier | if . == "" then "default" else . end),
      research_dispatch:($research_dispatch == 1),
      gateway_marker:($gateway_marker | if . == "" then null else . end),
      workspace:$workspace,
      attribution_path:($attribution_path | if . == "" then null else . end),
      brief_file:($brief_file | if . == "" then null else . end),
      brief_sha256:($brief_sha256 | if . == "" then null else . end),
      brief_embedded:($brief_embedded == 1),
      baseline_commit:$baseline,
      codex_exit_code:$codex_exit, result_file_valid:$result_valid,
      codex_session_id:($session_id | if . == "" then null else . end),
      session_id_source:$session_id_source,
      session_pointer:($session_pointer | if . == "" then null else . end),
      session_pointer_update:($session_pointer_update | if . == "" then null else . end),
      session_pointer_key:($session_pointer_key | if . == "" then null else . end),
      resume_source:($resume_source | if . == "" then null else . end),
      worktree:($worktree | if . == "" then null else . end),
      worktree_origin:($worktree_origin | if . == "" then null else . end),
      actual_changes:(if $baseline_snapshot_ready == 1 then
        {modified:$modified.items, staged:$staged_paths.items, untracked:$untracked_paths.items}
        else null end),
      pre_existing_dirty_state:(if $baseline_snapshot_ready == 1 then
        {modified:$baseline_modified.items, staged:$baseline_staged_paths.items, untracked:$baseline_untracked_paths.items}
        else null end),
      started_at:$started, completed_at:$completed,
      result_file:($run_dir+"/result.json"), stderr_file:($run_dir+"/stderr.log")}
      + (if $session_pointer_healed == 1 then {session_pointer_healed:true} else {} end)
      + (if $truncations == {} then {} else {actual_changes_truncation:$truncations} end)
      + (if ($bound_exceeded_paths.items | length) == 0 then {} else
          {actual_changes_uncertainty:{exceeded_fingerprint_bound:$bound_exceeded_paths.items}} end)
      + (if $bound_exceeded_paths.truncated then
          {actual_changes_uncertainty_truncation:{exceeded_fingerprint_bound:truncation($bound_exceeded_paths)}} else {} end)
      + (if $baseline_snapshot_ready == 0 or $baseline_truncations == {} then {} else {pre_existing_dirty_state_truncation:$baseline_truncations} end))' \
    > "$report_tmp" 2>/dev/null &&
    jq -se 'length == 1 and (.[0] | type == "object" and (.launcher_status | type == "string"))' "$report_tmp" >/dev/null 2>&1; then
    if publish_report_once "$report_tmp" "$RUN_DIR/report.json" ||
      [ -e "$RUN_DIR/report.json" ] || [ -L "$RUN_DIR/report.json" ]; then
      rm -f "$changed_file" "$staged_file" "$untracked_file" "$baseline_changed_file" "$baseline_staged_file" "$baseline_untracked_file" "$bound_exceeded_file" \
        "$current_prefix-modified.z" "$current_prefix-staged.z" "$current_prefix-untracked.z" "$report_tmp" "$fallback_tmp"
      cat "$RUN_DIR/report.json"
      return 0
    fi
  fi
  rm -f "$changed_file" "$staged_file" "$untracked_file" "$baseline_changed_file" "$baseline_staged_file" "$baseline_untracked_file" "$bound_exceeded_file" \
    "$current_prefix-modified.z" "$current_prefix-staged.z" "$current_prefix-untracked.z" "$report_tmp"
  # Keep waiters from hanging even when jq or primary report construction fails.
  if printf '%s\n' '{"launcher_status":"report_generation_failed"}' > "$fallback_tmp" 2>/dev/null &&
    { publish_report_once "$fallback_tmp" "$RUN_DIR/report.json" ||
      [ -e "$RUN_DIR/report.json" ] || [ -L "$RUN_DIR/report.json" ]; }; then
    cat "$RUN_DIR/report.json"
  fi
  rm -f "$fallback_tmp"
  return 0
}

brief_region_delivered() {
  local region="$RUN_DIR/.brief-region.$$"
  local stripped="$RUN_DIR/.brief-region-stripped.$$"
  local actual last_byte
  if ! LC_ALL=C awk \
    -v opening="<<<BRIEF-VERBATIM sha256=$BRIEF_SHA256>>>" \
    -v closing="<<<END-BRIEF-VERBATIM sha256=$BRIEF_SHA256>>>" '
      !inside && !opened && $0 == opening { opened=1; inside=1; next }
      inside && $0 == closing { closed=1; exit }
      inside { print }
      END { if (!opened || !closed) exit 1 }
    ' "$RUN_DIR/prompt.md" > "$region"; then
    rm -f "$region" "$stripped"
    return 1
  fi

  actual=$(sha256sum "$region" 2>/dev/null | cut -d' ' -f1)
  if [ "$actual" != "$BRIEF_SHA256" ]; then
    last_byte=$(tail -c1 "$region" | od -An -tu1 | tr -d '[:space:]')
    if [ -s "$region" ] && [ "$last_byte" = "10" ] &&
      head -c -1 "$region" > "$stripped"; then
      actual=$(sha256sum "$stripped" 2>/dev/null | cut -d' ' -f1)
    fi
  fi
  rm -f "$region" "$stripped"
  [ "$actual" = "$BRIEF_SHA256" ]
}

# A --run-dir invocation is the detached child. Validate its durable handoff only
# after report() exists so every refusal publishes a terminal artifact for waiters.
if [ -n "$RUN_DIR_ARG" ] &&
  { [ -e "$RUN_DIR/brief.receipt.json" ] || [ -L "$RUN_DIR/brief.receipt.json" ]; }; then
  BRIEF_RECEIPT_JSON=$(jq -ce '
    select(
      type == "object" and
      keys == ["brief_file", "brief_sha256"] and
      (.brief_file | type == "string" and length > 0) and
      (.brief_sha256 | type == "string" and test("^[0-9a-f]{64}$"))
    )
  ' "$RUN_DIR/brief.receipt.json" 2>/dev/null) || {
    echo "invalid brief receipt: $RUN_DIR/brief.receipt.json" >&2
    report "blocked_invalid_brief_receipt" null false
    exit 65
  }
  BRIEF_FILE=$(printf '%s' "$BRIEF_RECEIPT_JSON" | jq -r '.brief_file')
  BRIEF_SHA256=$(printf '%s' "$BRIEF_RECEIPT_JSON" | jq -r '.brief_sha256')
  BRIEF_ACTUAL_SHA256=$(sha256sum "$RUN_DIR/brief.md" 2>/dev/null | cut -d' ' -f1)
  [ "$BRIEF_ACTUAL_SHA256" = "$BRIEF_SHA256" ] || {
    echo "brief digest mismatch: declared $BRIEF_SHA256; computed $BRIEF_ACTUAL_SHA256" >&2
    report "blocked_brief_digest_mismatch" null false
    exit 65
  }
fi

if [ -n "$BRIEF_SHA256" ]; then
  if brief_region_delivered; then
    BRIEF_EMBEDDED=1
  else
    echo "brief not delivered in prompt: $RUN_DIR/prompt.md" >&2
    report "blocked_brief_not_delivered" null false
    exit 65
  fi
fi

# ---- Fixed-route guard. The named wrapper's PreToolUse hook injects its route
# marker on every launcher command it authorises. Missing, invalid, and model-mismatched
# markers fail before the launcher can lock or run against the workspace.
#
# Placed AFTER report() is defined and after RUN_DIR exists, so a refusal leaves a
# report.json naming the reason. A refusal that vanished without an artifact would be
# the exact failure this mechanism exists to remove.
#
# --wait/poll mode returns far above this point and is deliberately ungated: it spawns
# no Codex and is how a run is inspected after the fact.
#
# This is anti-drift, NOT a security boundary. The marker is readable by anyone who
# reads the hook. What it buys is that bypassing the gateway becomes a deliberate,
# greppable act instead of a silent shortcut.
case "${CODEX_WRAPPER_GATEWAY:-}" in
  "")
    report "blocked_no_gateway_marker" null false
    echo "Refusing: no wrapper route marker. Dispatch via a named wrapper." >&2
    exit 6
    ;;
  sol-high-wrapper) GATEWAY_MODEL="sol" ;;
  sol-medium-wrapper) GATEWAY_MODEL="sol-medium" ;;
  luna-max-wrapper) GATEWAY_MODEL="luna" ;;
  *)
    report "blocked_invalid_gateway_marker" null false
    echo "Refusing: invalid wrapper route marker: $CODEX_WRAPPER_GATEWAY" >&2
    exit 6
    ;;
esac
if [ "$MODEL" != "$GATEWAY_MODEL" ]; then
  report "blocked_gateway_model_mismatch" null false
  echo "Refusing: gateway $CODEX_WRAPPER_GATEWAY cannot launch model $MODEL" >&2
  exit 6
fi

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

# ---- Detached mode: hand the full codex+report flow to a setsid child that
# survives the caller's process-group kill (the Bash tool's 10-minute cap),
# then return the run dir immediately. Poll with --wait. ----
if [ "$DETACH" -eq 1 ]; then
  PERSIST_OPT=""; [ "$PERSIST" -eq 1 ] && PERSIST_OPT="--persist"
  # The lock is taken in the child, not here, so the child needs this flag too.
  WORKTREE_OPT=""; [ "$WORKTREE_ON_CONTENTION" -eq 1 ] && WORKTREE_OPT="--worktree-on-contention"
  # The child re-derives the model-fixed effort from --model; nothing to forward.
  PARENT_PGID=$(ps -o pgid= -p "$$" 2>/dev/null | tr -d '[:space:]')
  if ! valid_measured_process_group_id "$PARENT_PGID"; then
    echo "cannot determine launcher parent process group" >&2
    exit 73
  fi
  setsid "$0" --mode "$MODE" --model "$MODEL" --workspace "$WORKSPACE" \
    --prompt-file "$RUN_DIR/prompt.md" \
    ${ATTRIBUTION_PATH:+--attribution-path "$ATTRIBUTION_PATH"} \
    ${TIER:+--tier "$TIER"} \
    ${PERSIST_OPT:+$PERSIST_OPT} ${RESUME_ID:+--resume "$RESUME_ID"} \
    ${WORKTREE_OPT:+$WORKTREE_OPT} \
    --resume-source "$RESUME_SOURCE" --run-dir "$RUN_DIR" \
    >/dev/null 2>>"$RUN_DIR/detach.log" </dev/null &
  CHILD_PID=$!
  CHILD_PGID=""
  for _ in $(seq 1 100); do
    CANDIDATE_PGID=$(ps -o pgid= -p "$CHILD_PID" 2>/dev/null | tr -d '[:space:]')
    if valid_signal_process_group_id "$CANDIDATE_PGID" && [ "$CANDIDATE_PGID" != "$PARENT_PGID" ]; then
      CHILD_PGID="$CANDIDATE_PGID"
      break
    fi
    kill -0 "$CHILD_PID" 2>/dev/null || break
    sleep 0.01
  done
  if [ -z "$CHILD_PGID" ]; then
    echo "cannot determine detached child process group: $CHILD_PID" >&2
    kill -TERM "$CHILD_PID" 2>/dev/null || true
    exit 73
  fi
  LAUNCHER_PID_TMP="$RUN_DIR/.launcher.pid.$$"
  if ! printf 'pid=%s\npgid=%s\n' "$CHILD_PID" "$CHILD_PGID" > "$LAUNCHER_PID_TMP" ||
    ! mv -f "$LAUNCHER_PID_TMP" "$RUN_DIR/launcher.pid"; then
    rm -f "$LAUNCHER_PID_TMP"
    kill -TERM -- "-$CHILD_PGID" 2>/dev/null || true
    echo "cannot write launcher identity: $RUN_DIR/launcher.pid" >&2
    exit 73
  fi
  jq -n --arg run_dir "$RUN_DIR" --arg pid "$CHILD_PID" --arg pgid "$CHILD_PGID" \
    '{launcher_status:"detached", run_dir:$run_dir, child_pid:($pid|tonumber), child_pgid:($pgid|tonumber)}'
  exit 0
fi

# Serialize implementation writers per repository. This runs in the process that
# actually invokes Codex: the foreground parent or the detached child.
if [ "$MODE" = "implementation" ]; then
  WORKSPACE_LOCK_SLUG=$(derive_workspace_slug "$WORKSPACE") || {
    report "lock_setup_failed" null false
    exit 66
  }
  WORKSPACE_LOCK_DIR="/tmp/codex-wrapper/locks"
  mkdir -p "$WORKSPACE_LOCK_DIR" || {
    report "lock_setup_failed" null false
    exit 73
  }
  exec 9>"$WORKSPACE_LOCK_DIR/$WORKSPACE_LOCK_SLUG.lock" || {
    report "lock_setup_failed" null false
    exit 73
  }
  if ! flock -n 9; then
    if [ "$WORKTREE_ON_CONTENTION" -ne 1 ]; then
      report "blocked_concurrent_dispatch" null false
      exit 4
    fi
    # Opt-in isolation. Another writer holds this repository, so run in a worktree of
    # HEAD rather than losing the dispatch. A linked worktree is its own Git toplevel and
    # therefore hashes to a different lock slug, so it contends with nothing. BASELINE
    # was already resolved from HEAD further up, so it stays correct across the switch.
    WORKTREE_BASE="/tmp/codex-wrapper/worktrees"
    worktree_candidate="$WORKTREE_BASE/$(basename "$RUN_DIR")"
    # No HEAD to branch from (unborn/empty repo, or not a repo) is not an anomaly worth
    # its own status — isolation simply is not available, so report the ordinary refusal.
    if ! git_list rev-parse --verify HEAD >/dev/null 2>&1; then
      report "blocked_concurrent_dispatch" null false
      exit 4
    fi
    # Run dirs are unique, so a pre-existing path here means something is wrong. Never
    # reuse or delete it — it may hold another run's only copy of its work.
    if [ -e "$worktree_candidate" ] || ! mkdir -p "$WORKTREE_BASE"; then
      report "worktree_setup_failed" null false
      exit 75
    fi
    if ! git -C "$WORKSPACE" worktree add --detach "$worktree_candidate" HEAD >>"$RUN_DIR/worktree.log" 2>&1; then
      rm -rf "$worktree_candidate" 2>/dev/null
      git -C "$WORKSPACE" worktree prune >/dev/null 2>&1 || :   # drop the half-registration
      report "worktree_setup_failed" null false
      exit 75
    fi
    WORKTREE_PATH="$worktree_candidate"
    WORKTREE_ORIGIN="$WORKSPACE"
    WORKSPACE="$WORKTREE_PATH"   # git_list, report() and the codex -C all follow this
    WORKSPACE_LOCK_SLUG=$(derive_workspace_slug "$WORKSPACE") || {
      report "lock_setup_failed" null false
      exit 66
    }
    exec 9>"$WORKSPACE_LOCK_DIR/$WORKSPACE_LOCK_SLUG.lock" || {
      report "lock_setup_failed" null false
      exit 73
    }
    # A fresh path cannot legitimately be contended; if it is, stop rather than loop.
    if ! flock -n 9; then
      report "worktree_setup_failed" null false
      exit 75
    fi
    printf '%s\n' \
      "NOTICE: lock contention — this dispatch ran in an isolated worktree, not $WORKTREE_ORIGIN." \
      "  worktree: $WORKTREE_PATH" \
      "  Its work is left UNCOMMITTED and this directory is the ONLY copy; the launcher" \
      "  does not remove it. Merge it back, then RE-RUN THE FULL TEST GATE on the merged" \
      "  tree. Two isolated dispatches never see each other's work, so a conflict-free" \
      "  merge can still produce a broken tree — per-worktree green is not sufficient." >&2
  fi
fi

# Capture after implementation locking/worktree selection and immediately before Codex.
# Dirty workspaces are allowed; report() fingerprints baseline paths and subtracts any
# whose worktree/index state is unchanged at the end of the dispatch.
capture_baseline_state

# Session-id channel: this run's own "session id: <uuid>" banner line in stderr.log
# (codex-cli 0.144.5) is unambiguous per-run and unaffected by concurrent sessions.
extract_session_id() {
  local sid
  sid=$(grep -iE 'session id:' "$RUN_DIR/stderr.log" 2>/dev/null \
    | grep -oE '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' | head -1)
  [ -n "$sid" ] && printf '%s\n' "$sid"
}

write_session_pointer() {
  local workspace_slug pointer_dir pointer_path meta_path lock_path pointer_lock_fd
  local meta_state="missing" meta_line="" meta_uuid="" meta_key="" meta_re
  local pointer_contents="" pointer_size="" pointer_last_byte="" temp_path=""
  local LC_ALL=C

  # The implementation-mode repository flock does not cover persisted review runs or
  # mixed review/implementation persistence. This dedicated lock and ordering key make
  # those legal lock-free overlaps deterministic without changing implementation locking.

  workspace_slug=$(derive_workspace_slug "$WORKSPACE") || {
    [ -n "$CODEX_SESSION_ID" ] && SESSION_POINTER_UPDATE="write_failed"
    return 0
  }
  pointer_dir="$HOME/.local/state/codex-wrapper"
  pointer_path="$pointer_dir/$workspace_slug.session"
  meta_path="$pointer_path.meta"
  lock_path="$pointer_path.lock"

  # Without a banner, retain the previous pointer: the next pointer resume coherently
  # resumes the prior same-repository session. Make that stale retention visible in this
  # run's first report instead of forcing a later reader to infer it.
  if [ -z "$CODEX_SESSION_ID" ]; then
    [ -e "$pointer_path" ] && SESSION_POINTER_UPDATE="stale_retained"
    return 0
  fi

  # Session continuity must survive /tmp cleanup, but pointer failures must not affect the run.
  if ! mkdir -p "$pointer_dir" 2>/dev/null; then
    SESSION_POINTER_UPDATE="write_failed"
    return 0
  fi
  if ! exec {pointer_lock_fd}>"$lock_path" 2>/dev/null; then
    SESSION_POINTER_UPDATE="write_failed"
    return 0
  fi
  if ! flock -w 5 "$pointer_lock_fd"; then
    SESSION_POINTER_UPDATE="lock_timeout"
    exec {pointer_lock_fd}>&-
    return 0
  fi

  meta_re='^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}) ([0-9]{8}T[0-9]{6}\.[0-9]{9}Z-run-[A-Za-z0-9]{8})$'
  if ! [[ "$CODEX_SESSION_ID $SESSION_POINTER_KEY" =~ $meta_re ]]; then
    SESSION_POINTER_UPDATE="write_failed"
    exec {pointer_lock_fd}>&-
    return 0
  fi
  if [ -e "$meta_path" ]; then
    meta_state="unparseable"
    if [ -f "$meta_path" ] && [ "$(wc -l < "$meta_path" 2>/dev/null)" = "1" ] &&
      [ "$(tail -c 1 "$meta_path" 2>/dev/null | od -An -t u1 | tr -d ' ')" = "10" ] &&
      IFS= read -r meta_line < "$meta_path" && [[ "$meta_line" =~ $meta_re ]]; then
      meta_uuid="${BASH_REMATCH[1]}"
      meta_key="${BASH_REMATCH[2]}"
      meta_state="parsed"
    fi
  fi

  if [ "$meta_state" = "unparseable" ]; then
    # Ordering information is lost, so freeze rather than guess. Manual recovery:
    # rm -- "$HOME/.local/state/codex-wrapper/$workspace_slug.session.meta"
    # The next persisted run then advances through the missing-meta migration branch.
    SESSION_POINTER_UPDATE="corrupt_meta"
    exec {pointer_lock_fd}>&-
    return 0
  fi

  # Reconcile before comparing. A parseable meta is authoritative because publication is
  # meta-first; an interruption can leave meta ahead, but cannot leave pointer ahead.
  if [ "$meta_state" = "parsed" ]; then
    if [ -f "$pointer_path" ]; then
      pointer_contents=$(cat "$pointer_path" 2>/dev/null)
      pointer_size=$(wc -c < "$pointer_path" 2>/dev/null)
      pointer_last_byte=$(tail -c 1 "$pointer_path" 2>/dev/null | od -An -t u1 | tr -d ' ')
    fi
    if [ "$pointer_contents" != "$meta_uuid" ] || [ "$pointer_size" != "37" ] || [ "$pointer_last_byte" != "10" ]; then
      temp_path=$(mktemp "$pointer_dir/.$workspace_slug.session.heal.XXXXXXXX" 2>/dev/null) || temp_path=""
      if [ -z "$temp_path" ] || ! printf '%s\n' "$meta_uuid" > "$temp_path" 2>/dev/null || ! mv -f "$temp_path" "$pointer_path" 2>/dev/null; then
        [ -n "$temp_path" ] && rm -f "$temp_path" 2>/dev/null
        SESSION_POINTER_UPDATE="write_failed"
        exec {pointer_lock_fd}>&-
        return 0
      fi
      SESSION_POINTER="$pointer_path"
      SESSION_POINTER_HEALED=1
    fi
  fi

  # Explicit C collation makes the fixed-width timestamp key's lexical order chronological.
  if [ "$meta_state" = "parsed" ] && [[ "$SESSION_POINTER_KEY" < "$meta_key" ]]; then
    SESSION_POINTER_UPDATE="superseded"
    exec {pointer_lock_fd}>&-
    return 0
  fi

  # Publish meta first and pointer second, each by same-directory rename. Every interruption
  # therefore leaves either the old pair or a meta-ahead state healed above; pointer-ahead
  # cannot arise from this procedure. Unparseable external corruption freezes above rather
  # than inverting an order that can no longer be proved.
  temp_path=$(mktemp "$pointer_dir/.$workspace_slug.session.meta.XXXXXXXX" 2>/dev/null) || temp_path=""
  if [ -z "$temp_path" ] || ! printf '%s %s\n' "$CODEX_SESSION_ID" "$SESSION_POINTER_KEY" > "$temp_path" 2>/dev/null ||
    ! mv -f "$temp_path" "$meta_path" 2>/dev/null; then
    [ -n "$temp_path" ] && rm -f "$temp_path" 2>/dev/null
    SESSION_POINTER_UPDATE="write_failed"
    exec {pointer_lock_fd}>&-
    return 0
  fi

  temp_path=$(mktemp "$pointer_dir/.$workspace_slug.session.XXXXXXXX" 2>/dev/null) || temp_path=""
  if [ -z "$temp_path" ] || ! printf '%s\n' "$CODEX_SESSION_ID" > "$temp_path" 2>/dev/null ||
    ! mv -f "$temp_path" "$pointer_path" 2>/dev/null; then
    [ -n "$temp_path" ] && rm -f "$temp_path" 2>/dev/null
    SESSION_POINTER_UPDATE="write_failed"
    exec {pointer_lock_fd}>&-
    return 0
  fi
  SESSION_POINTER="$pointer_path"
  SESSION_POINTER_UPDATE="advanced"
  exec {pointer_lock_fd}>&-
  return 0
}

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
  SESSION_ID_SOURCE="resume"
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
  [ -n "$CODEX_SESSION_ID" ] && SESSION_ID_SOURCE="banner"
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
elif ! attribution_result_is_safe; then STATUS="invalid_attribution_result"
else STATUS="ok"; fi

report "$STATUS" "$CODEX_EXIT" "$RESULT_VALID"
[ "$STATUS" = "ok" ]
