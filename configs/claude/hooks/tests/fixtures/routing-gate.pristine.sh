#!/bin/bash
# Stop hook — the routing/review gate.
#
# NOT a nag. It asks one falsifiable question of the session transcript:
#   "Did this session write durable bytes after its latest external-worker dispatch?"
# If yes, it blocks the stop once and states exactly which paths are uncovered.
# If the session wrote nothing, or a later dispatch covers the writes, it stays silent.
#
# Rationale (CLAUDE.md → step 3, Completion): every durable write needs a non-author
# review. The chair has demonstrated it will skip that when each step looks small.
# This fires at the completion claim, which is where the ledger gate lives.
#
# FAILS OPEN by design. A gate that traps a session on a parse error is worse than
# a gate that occasionally misses — the user can always be told; a trapped session
# cannot proceed. Errors allow the stop and say nothing.
#
# The stop_hook_active guard prevents an infinite block loop: once the model has
# been told and is continuing, this must never block again in the same cycle.
#
# KNOWN LIMITATIONS — accepted deliberately 2026-07-21, not oversights:
#
# 1. Narrative text can read as an outcome (FALSE POSITIVE). dispatch_failed() recurses
#    into every value of a dispatch result, so a genuinely successful dispatch is treated
#    as failed when a narrative field — typically verification[].evidence — contains a
#    complete JSON document describing a failure. Mandatory TDD makes quoted RED evidence
#    common, though it only triggers when the field is EXACTLY a JSON document with no
#    surrounding prose: 1 occurrence across 8 real runs when measured. A fix that scoped
#    the recursion to outcome-bearing fields was attempted and REGRESSED launcher_status
#    detection entirely (every failure status started discharging) — strictly worse, since
#    over-blocking is the safe direction and under-blocking is not. Reverted. Anyone
#    retrying this must re-run the full launcher_status sweep as a hard gate.
#
# 2. Ordering uses invocation, not completion (FALSE NEGATIVE). Writes and dispatches are
#    both sequenced at tool_use time, but a write only counts once its tool_result reports
#    success. Verified direction — do not restate this from intuition, it is easy to get
#    backwards (the first version of this note did):
#      write invoked FIRST, then dispatch invoked, dispatch completes, write completes
#        -> DISCHARGES. This is the leak: the write keeps its earlier sequence number, so
#           the dispatch's later number appears to cover a write it never saw.
#      dispatch invoked FIRST, then write -> BLOCKS correctly; not the broken case.
#    Requires genuinely interleaved concurrent tool calls; rare in practice.
#
# 3. A review receipt discharges the latest uncovered write even if that review actually
#    reviewed something unrelated, or if a concurrent same-time-window session/process
#    produced the receipt. This is the same coarseness the existing Task/Agent transcript-
#    dispatch path already has: a dispatch after a write is trusted to have covered it.
#    The design deliberately over-blocks on any doubt rather than risk under-blocking.
#
# The first two limitations fail in OPPOSITE directions — do not summarise them as one posture:
#   #1 over-blocks (a clean session can be stopped and told to justify itself),
#   #2 under-blocks (a real uncovered write can slip through).
# Only #1 can inconvenience a well-behaved session, and it does so by asking for a carve-out
# statement, never by trapping it — stop_hook_active still guarantees a second stop proceeds.
# The gate is a tripwire, not a wall, and it is honest about which way each hole leans.

INPUT=$(cat 2>/dev/null)
command -v python3 >/dev/null 2>&1 || exit 0   # fail open
python3 - "$INPUT" <<'PY' 2>/dev/null || exit 0
from datetime import datetime, timedelta
import glob, json, os, re, stat, sys
try:
    hook = json.loads(sys.argv[1]) if sys.argv[1].strip() else {}
    if not isinstance(hook, dict):
        sys.exit(0)
except Exception:
    sys.exit(0)                                  # fail open
if hook.get("stop_hook_active"):
    sys.exit(0)
path = hook.get("transcript_path") or ""
if not isinstance(path, str) or not path or not os.path.exists(path):
    sys.exit(0)                                  # fail open
WRITE_TOOLS = {"Write", "Edit", "NotebookEdit", "MultiEdit"}
WORKER_AGENTS = {"codex-wrapper", "opencode-wrapper", "grok-wrapper"}
PATH_KEYS = {
    "destination", "destination_path", "file", "file_path", "filename",
    "notebook_path", "output", "output_file", "output_path", "path", "target",
    "target_path",
}
MCP_MUTATION = re.compile(
    r"(?:^|_)(?:write|create|update|edit|patch|delete|remove|move|copy|upload|"
    r"save|publish|post|send|append|insert|upsert|set|add|replace)(?:_|$)",
    re.IGNORECASE,
)
hook_cwd = hook.get("cwd")
if not (isinstance(hook_cwd, str) and os.path.isabs(hook_cwd)):
    hook_cwd = os.getcwd()
hook_cwd = os.path.realpath(hook_cwd)
def durable_path(value):
    if not isinstance(value, str) or not value or value in {"-", "&1", "&2"}:
        return None
    value = os.path.expanduser(value)
    if not os.path.isabs(value):
        value = os.path.join(hook_cwd, value)
    value = os.path.realpath(os.path.normpath(value))
    parts = value.split(os.sep)
    if value == "/dev/null" or value == "/tmp" or value.startswith("/tmp/"):
        return None
    if "scratchpad" in parts:
        return None
    return value
def path_values(value):
    found = []
    if isinstance(value, dict):
        for key, child in value.items():
            key = str(key).lower()
            if isinstance(child, str) and (key in PATH_KEYS or key.endswith("_path")):
                found.append(child)
            else:
                found.extend(path_values(child))
    elif isinstance(value, list):
        for child in value:
            found.extend(path_values(child))
    return found
# Bash writes are bonus evidence, never a shell-safety claim. Only literal output
# redirections are considered, and ambiguous syntax makes this detector return no
# targets so the hook keeps its fail-open posture.
#
# Known Bash-write blind spots:
# - heredocs/here-strings, [[ tests, arithmetic, function definitions, and command
#   substitutions are skipped because their > tokens are not reliably writes;
# - variables, globs, eval/wrappers, and runtime-computed targets are not resolved;
# - writer commands without redirection (tee, cp, install, mv, dd, sed -i, etc.)
#   are not detected. Detecting them would rebuild the parser this hook removed.
#
# Known dispatch-result blind spot:
# - only structured objects and complete JSON strings are inspected. Unrecognized
#   payloads still count as successful dispatches so uncertain data cannot turn
#   this deliberately fail-open hook into a trap.
AMBIGUOUS_BASH = re.compile(
    r"<<|\[\[|\(\(|\$\(|`|(?:^|[;|&\n])\s*(?:function\s+)?"
    r"[A-Za-z_][A-Za-z0-9_]*(?:\s*\(\s*\))?\s*\{"
)
def bash_write_targets(command):
    if not isinstance(command, str) or AMBIGUOUS_BASH.search(command):
        return []
    targets = []
    index = 0
    quote = None
    word_quote = None
    while index < len(command):
        char = command[index]
        if quote:
            if char == quote:
                quote = None
            elif char == "\\" and quote == '"':
                index += 1
            index += 1
            continue
        if char in {"'", '"'}:
            quote = char
            index += 1
            continue
        if char == "\\":
            index += 2
            continue
        if char == "#" and (index == 0 or command[index - 1].isspace()):
            newline = command.find("\n", index)
            index = len(command) if newline < 0 else newline + 1
            continue
        if char != ">":
            index += 1
            continue

        operator_start = index - 1 if index and command[index - 1] in {"&", "<"} else index
        index += 1
        while index < len(command) and command[index] in {">", "|", "&"}:
            index += 1
        operator = command[operator_start:index]
        while index < len(command) and command[index].isspace():
            index += 1
        word = []
        word_quote = None
        while index < len(command):
            char = command[index]
            if word_quote:
                if char == word_quote:
                    word_quote = None
                elif char == "\\" and word_quote == '"' and index + 1 < len(command):
                    index += 1
                    word.append(command[index])
                else:
                    word.append(char)
                index += 1
                continue
            if char in {"'", '"'}:
                word_quote = char
                index += 1
                continue
            if char == "\\" and index + 1 < len(command):
                index += 1
                word.append(command[index])
                index += 1
                continue
            if char.isspace() or char in "|&;<>":
                break
            word.append(char)
            index += 1
        target = "".join(word)
        if target and not target.startswith("(") and "$" not in target and "`" not in target:
            if not (operator.endswith(">&") and (target.isdigit() or target == "-")):
                target = durable_path(target)
                if target:
                    targets.append(target)
    if quote or word_quote:
        raise ValueError("unterminated shell quote")
    return targets
# A dispatch only discharges the gate if it actually reviewed something. Any terminal
# state short of success means no review happened, so the writes stay uncovered.
# The launcher_status/exit-code arm matters most in practice: blocked_dirty_tree is a
# run that never reached the model at all, and it was previously counted as coverage.
NON_SUCCESS_STATUS = {"failed", "blocked", "partial", "cancelled", "canceled", "timeout", "error"}
# Only "ok" means a dispatch COMPLETED. "detached" and "still_running" mean it merely
# started — no review has returned, so those must not discharge the gate either, or an
# in-flight review would cover writes it has not yet looked at. Enumerated from the two
# launchers: ok | detached | still_running | blocked_dirty_tree | codex_failed |
# invalid_result | invalid_report | review_violated_readonly.
OK_LAUNCHER_STATUS = {"ok"}
REPORT_GLOBS = (
    "/tmp/codex-wrapper/run-*/report.json",
    "/tmp/opencode-wrapper/run-*/report.json",
)
MAX_REPORT_BYTES = 1024 * 1024

def dispatch_failed(value):
    if isinstance(value, dict):
        status = value.get("status")
        if isinstance(status, str) and status.strip().lower() in NON_SUCCESS_STATUS:
            return True
        launcher_status = value.get("launcher_status")
        if isinstance(launcher_status, str) and launcher_status.strip().lower() not in OK_LAUNCHER_STATUS:
            return True
        for key in ("codex_exit_code", "opencode_exit_code", "exit_code"):
            code = value.get(key)
            # Exit codes arrive as ints from the launcher but as numeric strings when a
            # payload has been round-tripped through text. Non-numeric junk is NOT failure —
            # unparseable stays fail-open, per this hook's standing posture.
            if isinstance(code, bool):
                continue
            if isinstance(code, int) and code != 0:
                return True
            if isinstance(code, str):
                try:
                    if int(code.strip()) != 0:
                        return True
                except ValueError:
                    pass
        blockers = value.get("blockers")
        if isinstance(blockers, list) and blockers:
            return True
        return any(dispatch_failed(child) for child in value.values())
    if isinstance(value, list):
        return any(dispatch_failed(child) for child in value)
    if isinstance(value, str):
        try:
            return dispatch_failed(json.loads(value))
        except Exception:
            return False
    return False
def utc_epoch(value):
    if not isinstance(value, str):
        return None
    try:
        value = value[:-1] + "+00:00" if value.endswith("Z") else value
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
            return None
        return parsed.timestamp()
    except Exception:
        return None
def review_receipt_covers(write_timestamp, session_timestamp):
    write_epoch = utc_epoch(write_timestamp)
    session_epoch = utc_epoch(session_timestamp)
    if write_epoch is None or session_epoch is None:
        return False
    flags = os.O_RDONLY | os.O_NONBLOCK | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    for pattern in REPORT_GLOBS:
        try:
            candidates = glob.iglob(pattern)
            for candidate in candidates:
                try:
                    fd = os.open(candidate, flags)
                    try:
                        info = os.fstat(fd)
                        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_REPORT_BYTES:
                            continue
                        chunks = []
                        remaining = MAX_REPORT_BYTES + 1
                        while remaining:
                            chunk = os.read(fd, min(65536, remaining))
                            if not chunk:
                                break
                            chunks.append(chunk)
                            remaining -= len(chunk)
                    finally:
                        os.close(fd)
                    raw = b"".join(chunks)
                    if len(raw) > MAX_REPORT_BYTES:
                        continue
                    report = json.loads(raw)
                    if not isinstance(report, dict):
                        continue
                    if report.get("mode") != "review" or report.get("launcher_status") != "ok":
                        continue
                    completed_epoch = utc_epoch(report.get("completed_at"))
                    if (completed_epoch is not None and completed_epoch > write_epoch
                            and completed_epoch >= session_epoch):
                        return True
                except Exception:
                    continue
        except Exception:
            continue
    return False
def classify_tool(name, inp):
    if name in WRITE_TOOLS:
        targets = [p for p in map(durable_path, path_values(inp)) if p]
        return ("write", targets) if targets else None
    if name == "Bash":
        targets = bash_write_targets(inp.get("command") or "")
        return ("write", targets) if targets else None
    if name in {"Task", "Agent"}:
        return ("dispatch", []) if inp.get("subagent_type") in WORKER_AGENTS else None
    if name.startswith("mcp__"):
        operation = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name.rsplit("__", 1)[-1])
        if not MCP_MUTATION.search(operation.replace("-", "_")):
            return None
        raw_paths = path_values(inp)
        targets = [p for p in map(durable_path, raw_paths) if p]
        if raw_paths and not targets:
            return None
        return ("write", targets or [f"<{name}>"])
    return None
pending = {}
written = []
dispatches = []
sequence = 0
session_started_at = None
try:
    with open(path, "r", encoding="utf-8") as transcript:
        for line in transcript:
            if not line.strip():
                continue
            record = json.loads(line)
            # Session start = the FIRST record that actually carries a timestamp. The literal
            # first transcript record often has none (session-meta/summary), which previously
            # left session_started_at None and made review_receipt_covers reject every receipt
            # (fail-safe over-block, but the feature never fired). Keep the earliest real one.
            if session_started_at is None and isinstance(record, dict):
                ts = record.get("timestamp")
                if isinstance(ts, str) and ts:
                    session_started_at = ts
            if not isinstance(record, dict):
                continue
            message = record.get("message")
            content = message.get("content") if isinstance(message, dict) else None
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "tool_use":
                    tool_id, name, inp = block.get("id"), block.get("name"), block.get("input", {})
                    if not isinstance(tool_id, str) or not isinstance(name, str):
                        continue
                    if not isinstance(inp, dict) or tool_id in pending:
                        sys.exit(0)
                    event = classify_tool(name, inp)
                    if event:
                        sequence += 1
                        pending[tool_id] = (sequence, event[0], event[1], record.get("timestamp"))
                elif block.get("type") == "tool_result":
                    tool_id = block.get("tool_use_id")
                    if not isinstance(tool_id, str) or tool_id not in pending:
                        continue
                    is_error = block.get("is_error", False)
                    if not isinstance(is_error, bool):
                        sys.exit(0)
                    event_sequence, kind, targets, event_timestamp = pending.pop(tool_id)
                    if is_error:
                        continue
                    if kind == "dispatch":
                        if not dispatch_failed(block.get("content")):
                            dispatches.append(event_sequence)
                    else:
                        written.extend((event_sequence, target, event_timestamp) for target in targets)
except Exception:
    sys.exit(0)                                  # fail open
last_dispatch = max(dispatches, default=-1)
uncovered_writes = [event for event in written if event[0] > last_dispatch]
uncovered = sorted(set(target for _, target, _ in uncovered_writes))
if not uncovered:
    sys.exit(0)
latest_write = max(uncovered_writes, key=lambda event: event[0])
if review_receipt_covers(latest_write[2], session_started_at):
    sys.exit(0)
shown = uncovered[:8]
listing = "\n".join("  - " + target for target in shown)
if len(uncovered) > len(shown):
    listing += f"\n  ... and {len(uncovered) - len(shown)} more"
reason = (
    "ROUTING GATE — this session wrote durable bytes after its latest external-worker dispatch.\n\n"
    f"{len(uncovered)} uncovered target(s); no later dispatch to codex-wrapper / opencode-wrapper:\n"
    f"{listing}\n\n"
    "Every durable write needs non-author cross-review; these writes have no later worker dispatch.\n\n"
    "Before finishing, do ONE of:\n"
    "  1. Dispatch a batched review through codex-wrapper (mode review, --resume-from-pointer).\n"
    "  2. State the applicable named carve-out and log the review as debt.\n"
    "  3. If the target was genuinely exempt, state why explicitly."
)
print(json.dumps({"decision": "block", "reason": reason}))
PY
