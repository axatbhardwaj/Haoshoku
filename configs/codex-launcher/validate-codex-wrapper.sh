#!/bin/bash
# PreToolUse hook for the codex-wrapper agent. FAILS CLOSED.
# Bash: entire command must match the fixed launcher, read-only git, or
#       mkdir under /tmp/codex-wrapper — no shell metacharacters anywhere.
# Write/Edit/MultiEdit/NotebookEdit: only under /tmp/codex-wrapper/ (prompt files).
# JSON extraction: jq preferred, python3 fallback; neither present => block.

[ -x /usr/bin/base64 ] || { echo "Blocked: trusted base64 unavailable; failing closed." >&2; exit 2; }
INPUT_B64=$(/usr/bin/base64 -w0) || { echo "Blocked: hook input capture failed; failing closed." >&2; exit 2; }

input() {
  printf '%s' "$INPUT_B64" | /usr/bin/base64 -d
}

extract() {  # extract <jq-path> e.g. .tool_name
  if [ -x /usr/bin/jq ]; then
    input | /usr/bin/jq -r "$1 // empty" 2>/dev/null
  elif [ -x /usr/bin/python3 ]; then
    input | /usr/bin/python3 -I -c '
import json,sys
path=sys.argv[1].lstrip(".").split(".")
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
for k in path:
    d=d.get(k) if isinstance(d,dict) else None
    if d is None: sys.exit(0)
print(d)' "$1" 2>/dev/null
  fi
}

[ -x /usr/bin/jq ] || [ -x /usr/bin/python3 ] || {
  echo "Blocked: neither jq nor python3 available; codex-wrapper hook fails closed." >&2; exit 2; }

valid_input_schema() {
  if [ -x /usr/bin/jq ]; then
    input | /usr/bin/jq -s -e '
      length == 1 and (.[0] |
        (type == "object") and
        (.tool_name | type == "string" and test("^[A-Za-z][A-Za-z0-9_]*$")) and
        (if .tool_name == "Bash" then
           (.tool_input | type == "object") and
           (.tool_input.command | type == "string" and length > 0)
         elif .tool_name == "Write" or .tool_name == "Edit" or .tool_name == "MultiEdit" then
           (.tool_input | type == "object") and
           (.tool_input.file_path | type == "string" and length > 0)
         elif .tool_name == "NotebookEdit" then
           (.tool_input | type == "object") and
           (.tool_input.notebook_path | type == "string" and length > 0)
         else true end))
    ' >/dev/null 2>&1
  else
    input | /usr/bin/python3 -I -c '
import json,re,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(1)
valid=isinstance(d,dict) and isinstance(d.get("tool_name"),str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*",d["tool_name"]) is not None
if valid and d["tool_name"] == "Bash":
    i=d.get("tool_input")
    valid=isinstance(i,dict) and isinstance(i.get("command"),str) and len(i["command"]) > 0
elif valid and d["tool_name"] in ("Write","Edit","MultiEdit"):
    i=d.get("tool_input")
    valid=isinstance(i,dict) and isinstance(i.get("file_path"),str) and len(i["file_path"]) > 0
elif valid and d["tool_name"] == "NotebookEdit":
    i=d.get("tool_input")
    valid=isinstance(i,dict) and isinstance(i.get("notebook_path"),str) and len(i["notebook_path"]) > 0
sys.exit(0 if valid else 1)' 2>/dev/null
  fi
}

# Extraction deliberately happens only after the JSON types are proven. Coercing arrays,
# numbers, or objects to text can turn malformed hook input into an unguarded tool name.
valid_input_schema || { echo "Blocked: malformed hook input; failing closed." >&2; exit 2; }

TOOL=$(extract .tool_name)

allow() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"%s"}}\n' "$1"
  exit 0
}

within_temp_root() {  # within_temp_root <root> <candidate> <allow-root>
  local root=$1 candidate=$2 allow_root=$3 canonical_root canonical_path
  canonical_root=$(/usr/bin/realpath -m -- "$root" 2>/dev/null) || return 1
  canonical_path=$(/usr/bin/realpath -m -- "$candidate" 2>/dev/null) || return 1

  # The root itself must not be a symlink: otherwise a perfectly normalized child
  # could still name durable state outside the wrapper's intended temp directory.
  [ "$canonical_root" = "$root" ] || return 1
  case "$canonical_path" in
    "$root") [ "$allow_root" = 1 ] ;;
    "$root"/*) return 0 ;;
    *) return 1 ;;
  esac
}

safe_write_target() {  # safe_write_target <root> <candidate>
  local root=$1 candidate=$2 link_count
  within_temp_root "$root" "$candidate" 0 || return 1

  if [ -e "$candidate" ] || [ -L "$candidate" ]; then
    # A directory is never a prompt file. Requiring a regular single-link target also
    # prevents an in-root pathname from aliasing durable data elsewhere via a hard link.
    [ ! -d "$candidate" ] && [ -f "$candidate" ] || return 1
    link_count=$(/usr/bin/stat -Lc %h -- "$candidate" 2>/dev/null) || return 1
    [ "$link_count" = 1 ] || return 1
  fi
}

safe_revision() {
  case "$1" in
    ""|-*) return 1 ;;
  esac
  [[ "$1" =~ ^[A-Za-z0-9._/@^~:+][A-Za-z0-9._/@^~:+-]*$ ]]
}

safe_git_command() {
  local IFS=' ' token subcommand
  local -a words

  # Parsing a small grammar per subcommand is intentional. A generic "safe-looking"
  # argument admits write switches such as --output and process hooks such as --ext-diff.
  [[ "$CMD" =~ ^git(\ [A-Za-z0-9._/~=^@:+-]+)+$ ]] || return 1
  read -r -a words <<< "$CMD"
  [ "${words[0]}" = git ] && [ "${#words[@]}" -ge 2 ] || return 1
  subcommand=${words[1]}

  case "$subcommand" in
    status)
      for token in "${words[@]:2}"; do
        case "$token" in
          --porcelain|--porcelain=v1|--porcelain=v2|--short|--branch|--show-stash|--ahead-behind|--no-ahead-behind|--untracked-files=no|--untracked-files=normal|--untracked-files=all|--ignored=no|--ignored=matching|--ignored=traditional) ;;
          *) return 1 ;;
        esac
      done
      ;;
    diff)
      for token in "${words[@]:2}"; do
        case "$token" in
          --name-only|--name-status|--stat|--numstat|--shortstat|--summary|--check|--cached|--staged|--no-ext-diff|--no-textconv) ;;
          *) safe_revision "$token" || return 1 ;;
        esac
      done
      ;;
    rev-parse)
      for token in "${words[@]:2}"; do
        case "$token" in
          --verify|--quiet|-q|--short|--abbrev-ref|--symbolic-full-name|--show-toplevel|--show-prefix|--show-cdup|--git-dir|--is-inside-work-tree|--is-bare-repository) ;;
          --short=*) [[ "$token" =~ ^--short=[0-9]+$ ]] || return 1 ;;
          *) safe_revision "$token" || return 1 ;;
        esac
      done
      ;;
    log)
      for token in "${words[@]:2}"; do
        case "$token" in
          --oneline|--decorate|--no-decorate|--stat|--name-only|--no-ext-diff|--no-textconv) ;;
          --max-count=*) [[ "$token" =~ ^--max-count=[0-9]+$ ]] || return 1 ;;
          -*) [[ "$token" =~ ^-[0-9]+$ ]] || return 1 ;;
          *) safe_revision "$token" || return 1 ;;
        esac
      done
      ;;
    show)
      for token in "${words[@]:2}"; do
        case "$token" in
          --oneline|--decorate|--no-decorate|--stat|--name-only|--name-status|--no-ext-diff|--no-textconv) ;;
          *) safe_revision "$token" || return 1 ;;
        esac
      done
      ;;
    ls-files)
      for token in "${words[@]:2}"; do
        case "$token" in
          --cached|--deleted|--modified|--others|--ignored|--stage|--unmerged|--killed|--directory|--no-empty-directory|--exclude-standard|--deduplicate|--error-unmatch|-z) ;;
          *) return 1 ;;
        esac
      done
      ;;
    *) return 1 ;;
  esac
}

safe_pager() {
  case "$1" in
    "") return 0 ;;
    cat) [ "$(command -v cat 2>/dev/null)" = /usr/bin/cat ] ;;
    /usr/bin/cat|/bin/cat) [ -x "$1" ] ;;
    *) return 1 ;;
  esac
}

safe_git_runtime() {
  local config_status name

  # A safe argument grammar is insufficient if ambient state can replace Git, launch a
  # helper/pager, or redirect Git's own trace, index, object, or repository file access.
  [ "$(command -v git 2>/dev/null)" = /usr/bin/git ] && [ -x /usr/bin/git ] || return 1
  [ -z "${GIT_EXTERNAL_DIFF:-}" ] || return 1
  safe_pager "${GIT_PAGER:-}" && safe_pager "${PAGER:-}" || return 1

  for name in ${!GIT_TRACE@}; do
    return 1
  done
  for name in ${!LESS@}; do
    return 1
  done
  for name in GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_DIR GIT_WORK_TREE GIT_EXEC_PATH; do
    [[ -v $name ]] && return 1
  done

  # Exit 1 is Git's documented no-match result. A match or any query failure is unsafe:
  # these keys can execute helpers even when the requested subcommand itself is read-only.
  /usr/bin/git config --get-regexp '^(core\.fsmonitor|core\.pager|pager\..*|diff\.external|diff\..*\.(command|textconv)|filter\..*\.(clean|smudge|process))$' >/dev/null 2>&1
  config_status=$?
  [ "$config_status" -eq 1 ]
}

if [ "$TOOL" = "Write" ] || [ "$TOOL" = "Edit" ] || [ "$TOOL" = "MultiEdit" ] || [ "$TOOL" = "NotebookEdit" ]; then
  if [ "$TOOL" = "NotebookEdit" ]; then
    FP=$(extract .tool_input.notebook_path)
  else
    FP=$(extract .tool_input.file_path)
  fi
  safe_write_target /tmp/codex-wrapper "$FP" && allow "prompt file under /tmp/codex-wrapper"
  echo "Blocked: codex-wrapper may write only under /tmp/codex-wrapper/. Got: $FP" >&2
  exit 2
fi

[ "$TOOL" = "Bash" ] || exit 0
CMD=$(extract .tool_input.command)
[ -n "$CMD" ] || { echo "Blocked: empty Bash command; failing closed." >&2; exit 2; }

# Reject any multi-line command up front: a first line that passes one allowlist branch
# must not be able to smuggle a second shell command on a later line.
case "$CMD" in
  *$'\n'*|*$'\r'*) echo "Blocked: multi-line Bash commands are not allowed by codex-wrapper policy. Got: $CMD" >&2; exit 2 ;;
esac

# Every branch consumes the whole string. The shared arg charset excludes ; & | < >
# $ ` ( ) " ' \ and whitespace tricks before any approved command can execute.
ARG='[A-Za-z0-9._/~=^@:+-]+'
# Valueless flags are listed BEFORE the valued group so --resume-from-pointer is matched
# whole, not shadowed by the --resume alternative. --resume-source is deliberately absent:
# it is internal to the launcher's own detached self-reinvocation, never wrapper-issued.
LAUNCHER_ARGS_RE="^( --resume-from-pointer| --detach| --persist| --(mode|model|workspace|prompt-file|effort|tier|wait|wait-seconds|resume) ${ARG})+$"

trusted_home_for_uid() {
  local name password entry_uid gid gecos entry_home shell
  while IFS=: read -r name password entry_uid gid gecos entry_home shell; do
    if [ "$entry_uid" = "$UID" ]; then
      case "$entry_home" in
        /*) printf '%s' "$entry_home"; return 0 ;;
        *) return 1 ;;
      esac
    fi
  done < /etc/passwd
  return 1
}

safe_launcher_command() {
  local trusted_home launcher args
  trusted_home=$(trusted_home_for_uid) || return 1
  [ "${HOME:-}" = "$trusted_home" ] || return 1
  case "$CMD" in
    *" "*) launcher=${CMD%% *}; args=${CMD#"$launcher"} ;;
    *) return 1 ;;
  esac
  case "$launcher" in
    '~/.claude/agents/run-codex-task.sh'|"$trusted_home/.claude/agents/run-codex-task.sh") ;;
    *) return 1 ;;
  esac
  [[ "$args" =~ $LAUNCHER_ARGS_RE ]]
}

safe_launcher_command && allow "approved codex launcher"
safe_git_command && safe_git_runtime && allow "read-only git inspection"

case "$CMD" in
  "mkdir -p "*)
    TARGET=${CMD#mkdir -p }
    [ "$(command -v mkdir 2>/dev/null)" = /usr/bin/mkdir ] && [ -x /usr/bin/mkdir ] && [[ "$TARGET" =~ ^${ARG}$ ]] && within_temp_root /tmp/codex-wrapper "$TARGET" 1 && allow "wrapper temp dir"
    ;;
esac

echo "Blocked by codex-wrapper policy. Allowed: the run-codex-task.sh launcher, read-only git (rev-parse/status/diff/log/show/ls-files), mkdir under /tmp/codex-wrapper — single commands, no shell metacharacters. Got: $CMD" >&2
exit 2
