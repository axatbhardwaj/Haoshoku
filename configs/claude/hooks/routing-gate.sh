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
#    CH5 narrowing: receipts are now scoped per target; in-transcript dispatches remain
#    target-blind, so a successful junk dispatch can still discharge every earlier write.
#
# 4. The final-text comparison is a suspected-staleness signal, not proof. It is a
#    one-shot signal: after the visible block, stop_hook_active passes the next stop
#    unconditionally. Short or repeated suffixes can still miss a stale transcript.
#
# 5. A final torn transcript tail is treated as staleness evidence and re-polled.
#    Compaction-summary records are parsed normally; interior transcript corruption still fails open.
#
# D7 policy decision: ~/.claude/** is deliberately not exempt; the hook mirrors policy.
#
# The first two limitations fail in OPPOSITE directions — do not summarise them as one posture:
#   #1 over-blocks (a clean session can be stopped and told to justify itself),
#   #2 under-blocks (a real uncovered write can slip through).
# Only #1 can inconvenience a well-behaved session, and it does so by asking for a carve-out
# statement, never by trapping it — stop_hook_active still guarantees a second stop proceeds.
# The gate is a tripwire, not a wall, and it is honest about which way each hole leans.
#
# WONTFIX — accepted deliberately 2026-07-21:
#
# **Not fixed, deliberately (2026-07-21; S3B dropped by human decision after two plan-review
# rounds).** D1/D2 stand: the gate still cannot verify a stated carve-out or exemption, and the same
# uncovered write re-blocks once per turn until genuinely covered. Every design that honored
# statements or capped repeat blocks required the hook to trust a durable record that a block had
# already occurred — and the only storage within a Stop hook's reach is writable by the same model
# the gate watches. A strict-valid forged `{blocked, waived}` record would silence the tripwire
# before it ever fired (S0-v2 finding R2-B2). We keep the noise rather than ship a quietable gate.
# Also unfixed: in-transcript dispatches remain target-blind (a junk dispatch still discharges
# everything — D5 residual); stops with work in flight still hard-block (any deferral that can repeat
# is a standing bypass — R2-B3); receipts remain unauthenticated launcher files — per-target scoping
# and the future-skew bound narrow forgery, they do not close it.

INPUT=$(cat 2>/dev/null)
command -v python3 >/dev/null 2>&1 || exit 0   # fail open
python3 - "$INPUT" <<'PY' 2>/dev/null || exit 0
from datetime import datetime, timedelta
import glob, json, os, re, shlex, stat, sys, time
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
HOME_DIR = os.path.realpath(os.path.expanduser("~"))
TRACKED_ROOT_NAMES = ("personal", "defi", ".claude", ".codex")
# This deliberately reduces the gate's filesystem coverage to locations that can carry review debt.
# Coverage outside these roots is intentionally abandoned because nothing
# durable lives there.
TRACKED_ROOTS = tuple(
    os.path.realpath(os.path.join(HOME_DIR, name))
    for name in TRACKED_ROOT_NAMES
)
def path_is_tracked(value):
    if not isinstance(value, str) or not value:
        return False
    value = os.path.realpath(value)
    return any(value == root or value.startswith(root + os.sep) for root in TRACKED_ROOTS)
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
# - heredocs/here-strings are skipped because their > tokens are not reliably writes;
# - a relative-path write is not named (for example, `cp x y` after an earlier `cd ~/defi`);
#   tracking cwd per command is intentionally not attempted because it previously produced
#   phantom paths;
# - variables, globs, eval/wrappers, and runtime-computed targets are not resolved;
# - the explicit cp/mv/install/tee/dd/rm/sed -i grammar below is intentionally bounded;
#   other writer commands and runtime-computed operands remain invisible.
#
# Known dispatch-result blind spot:
# - only structured objects and complete JSON strings are inspected. Unrecognized
#   payloads still count as successful dispatches so uncertain data cannot turn
#   this deliberately fail-open hook into a trap.
AMBIGUOUS_BASH = re.compile(r"<<")
SHELL_ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
SHELL_TARGET_META = re.compile(r"""[$`*?~{}[\]<>()|&;'"\\\s]""")
def shell_target_is_resolvable(value):
    return (
        isinstance(value, str)
        and os.path.isabs(value)
        and not SHELL_TARGET_META.search(value)
    )
def shell_value_is_quoted(segment, value):
    return f"'{value}'" in segment or f'"{value}"' in segment
def shell_segments(command):
    segments = []
    segment = []
    quote = None
    index = 0
    while index < len(command):
        char = command[index]
        if quote:
            segment.append(char)
            if char == quote:
                quote = None
            elif char == "\\" and quote == '"' and index + 1 < len(command):
                index += 1
                segment.append(command[index])
            index += 1
            continue
        if char in {"'", '"'}:
            quote = char
            segment.append(char)
            index += 1
            continue
        if char == "\\" and index + 1 < len(command):
            segment.extend((char, command[index + 1]))
            index += 2
            continue
        if char in ";|&\n":
            value = "".join(segment).strip()
            if value:
                segments.append(value)
            segment = []
            if index + 1 < len(command) and command[index + 1] == char and char in "|&":
                index += 1
            index += 1
            continue
        segment.append(char)
        index += 1
    if quote:
        raise ValueError("unterminated shell quote")
    value = "".join(segment).strip()
    if value:
        segments.append(value)
    return segments
def option_operands(arguments, argument_flags, target_flags=frozenset()):
    operands = []
    target_directory = None
    parsing_flags = True
    index = 0
    while index < len(arguments):
        argument = arguments[index]
        if parsing_flags and argument == "--":
            parsing_flags = False
            index += 1
            continue
        if parsing_flags and argument in argument_flags:
            index += 1
            if index >= len(arguments):
                return None
            if argument in target_flags:
                target_directory = arguments[index]
            index += 1
            continue
        if parsing_flags and argument.startswith("--"):
            name, separator, value = argument.partition("=")
            if name in argument_flags:
                if not separator:
                    index += 1
                    if index >= len(arguments):
                        return None
                    value = arguments[index]
                if name in target_flags:
                    target_directory = value
                index += 1
                continue
            if not separator:
                return None
            index += 1
            continue
        if parsing_flags and argument.startswith("-") and argument != "-":
            index += 1
            continue
        operands.append(argument)
        index += 1
    return operands, target_directory
def verb_segment_targets(segment):
    lexer = shlex.shlex(segment, posix=True, punctuation_chars="<>")
    lexer.whitespace_split = True
    lexer.commenters = "#"
    words = list(lexer)
    for index, word in enumerate(words):
        if word and set(word) <= {"<", ">"}:
            cutoff = index - 1 if index and words[index - 1].isdigit() else index
            words = words[:cutoff]
            break
    if not words or SHELL_ASSIGNMENT.match(words[0]):
        return []
    verb, arguments = words[0], words[1:]
    if verb == "dd":
        return [value[3:] for value in arguments if value.startswith("of=") and value[3:]]
    if verb in {"cp", "mv"}:
        parsed = option_operands(
            arguments,
            {"-t", "-S", "--target-directory", "--suffix"},
            {"-t", "--target-directory"},
        )
        if parsed is None:
            return []
        operands, target_directory = parsed
        if target_directory is not None:
            return [target_directory] if operands else []
        return [operands[-1]] if len(operands) >= 2 else []
    if verb == "install":
        parsed = option_operands(
            arguments,
            {
                "-t", "-m", "-o", "-g", "-S", "--target-directory", "--mode",
                "--owner", "--group", "--suffix",
            },
            {"-t", "--target-directory"},
        )
        if parsed is None:
            return []
        operands, target_directory = parsed
        if target_directory is not None:
            return [target_directory] if operands else []
        return [operands[-1]] if len(operands) >= 2 else []
    if verb == "tee":
        parsed = option_operands(arguments, set())
        if parsed is None:
            return []
        operands, _ = parsed
        for argument in arguments:
            if argument.startswith("-") and not argument.startswith("--") and argument != "-":
                if any(flag not in "aip" for flag in argument[1:]):
                    return []
        return operands
    if verb == "rm":
        parsed = option_operands(arguments, set())
        return [] if parsed is None else parsed[0]
    if verb == "sed":
        in_place = False
        scripted = False
        operands = []
        parsing_flags = True
        index = 0
        while index < len(arguments):
            argument = arguments[index]
            if parsing_flags and argument == "--":
                parsing_flags = False
                index += 1
                continue
            if parsing_flags and (argument == "-i" or argument.startswith("-i")
                                  or argument == "--in-place" or argument.startswith("--in-place=")):
                in_place = True
                index += 1
                continue
            if parsing_flags and argument in {"-e", "-f", "--expression", "--file"}:
                scripted = True
                index += 1
                if index >= len(arguments):
                    return []
                index += 1
                continue
            if parsing_flags and (argument.startswith("--expression=") or argument.startswith("--file=")):
                scripted = True
                index += 1
                continue
            if parsing_flags and argument.startswith("--"):
                if "=" not in argument:
                    return []
                index += 1
                continue
            if parsing_flags and argument.startswith("-") and argument != "-":
                index += 1
                continue
            operands.append(argument)
            index += 1
        if not in_place:
            return []
        if scripted:
            return operands
        return operands[1:] if len(operands) >= 2 else []
    return []
def bash_verb_targets(command):
    targets = []
    for segment in shell_segments(command):
        for value in verb_segment_targets(segment):
            if shell_value_is_quoted(segment, value) or not shell_target_is_resolvable(value):
                continue
            target = durable_path(value)
            if target and target not in targets:
                targets.append(target)
    return targets
def bash_write_targets(command):
    if not isinstance(command, str) or AMBIGUOUS_BASH.search(command):
        return []
    try:
        verb_targets = bash_verb_targets(command)
    except Exception:
        verb_targets = []
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
        word_has_shell_syntax = False
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
                word_has_shell_syntax = True
                index += 1
                continue
            if char == "\\" and index + 1 < len(command):
                word_has_shell_syntax = True
                index += 1
                word.append(command[index])
                index += 1
                continue
            if char.isspace() or char in "|&;<>":
                break
            word.append(char)
            index += 1
        target = "".join(word)
        if target and not target.startswith("("):
            if not (operator.endswith(">&") and (target.isdigit() or target == "-")):
                if not word_has_shell_syntax and shell_target_is_resolvable(target):
                    target = durable_path(target)
                    if target:
                        targets.append(target)
    if quote or word_quote:
        raise ValueError("unterminated shell quote")
    targets += [target for target in verb_targets if target not in targets]
    targets = [target for target in targets if path_is_tracked(target)]
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
report_glob_roots = os.environ.get("ROUTING_GATE_REPORT_GLOB_ROOTS")
if report_glob_roots is None:
    REPORT_GLOBS = (
        "/tmp/codex-wrapper/run-*/report.json",
        "/tmp/opencode-wrapper/run-*/report.json",
    )
else:
    REPORT_GLOBS = tuple(
        os.path.join(root, "run-*", "report.json")
        for root in report_glob_roots.split(os.pathsep) if root
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
def eligible_review_receipts(session_timestamp):
    session_epoch = utc_epoch(session_timestamp)
    if session_epoch is None:
        return []
    now = time.time()
    receipts = []
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
                    if (completed_epoch is not None and completed_epoch >= session_epoch
                            and completed_epoch <= now + 300):
                        receipts.append((completed_epoch, report.get("workspace")))
                except Exception:
                    continue
        except Exception:
            continue
    return receipts
def receipt_workspace_covers(workspace, target):
    if (not isinstance(workspace, str) or not workspace or not os.path.isabs(workspace)
            or not isinstance(target, str) or target.startswith("<mcp__")):
        return False
    workspace = os.path.realpath(os.path.normpath(workspace))
    if workspace == "/":
        return False
    return target == workspace or target.startswith(workspace + os.sep)
def classify_tool(name, inp):
    if name in WRITE_TOOLS:
        targets = [
            p for p in map(durable_path, path_values(inp))
            if p and path_is_tracked(p)
        ]
        return ("write", targets) if targets else None
    if name == "Bash":
        targets = bash_write_targets(inp.get("command") or "")
        return ("shell_write", targets) if targets else None
    if name.startswith("mcp__"):
        operation = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name.rsplit("__", 1)[-1])
        if not MCP_MUTATION.search(operation.replace("-", "_")):
            return None
        raw_paths = path_values(inp)
        targets = [
            p for p in map(durable_path, raw_paths)
            if p and path_is_tracked(p)
        ]
        if raw_paths and not targets:
            return None
        return ("write", targets or [f"<{name}>"])
    return None
def normalized_text(value):
    return re.sub(r"\s+", " ", value).strip()
def parse_transcript():
    pending = {}
    written = []
    sequence = 0
    session_started_at = None
    last_assistant_text = ""
    suspected_stale = False
    try:
        with open(path, "r", encoding="utf-8") as transcript:
            for line in transcript:
                if not line.strip():
                    continue
                try:
                    record = json.loads(line)
                except Exception:
                    if any(remaining.strip() for remaining in transcript):
                        sys.exit(0)
                    suspected_stale = True
                    break
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
                if message.get("role") == "assistant":
                    text_blocks = [
                        block.get("text") for block in content
                        if (isinstance(block, dict) and block.get("type") == "text"
                            and isinstance(block.get("text"), str))
                    ]
                    if text_blocks:
                        last_assistant_text = "".join(text_blocks)
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
                        written.extend((event_sequence, target, event_timestamp) for target in targets)
    except Exception:
        sys.exit(0)                                  # fail open
    expected = hook.get("last_assistant_message")
    if isinstance(expected, str) and expected:
        expected_suffix = normalized_text(expected)[-200:]
        if expected_suffix not in normalized_text(last_assistant_text):
            suspected_stale = True
    return written, session_started_at, suspected_stale
def transcript_uncovered(written):
    return list(written)
try:
    poll_ms = int(os.environ.get("ROUTING_GATE_POLL_MS", "500"))
    if poll_ms < 0:
        raise ValueError
except (TypeError, ValueError):
    poll_ms = 500
written, session_started_at, suspected_stale = parse_transcript()
observed_uncovered = list(transcript_uncovered(written))
if suspected_stale:
    for _ in range(5):
        time.sleep(poll_ms / 1000)
        written, session_started_at, suspected_stale = parse_transcript()
        for event in transcript_uncovered(written):
            if event not in observed_uncovered:
                observed_uncovered.append(event)
        if not suspected_stale:
            break
uncovered_writes = list(written)
latest_by_target = {}
for event_sequence, target, event_timestamp in uncovered_writes:
    if target not in latest_by_target or event_sequence > latest_by_target[target][0]:
        latest_by_target[target] = (event_sequence, event_timestamp)
final_written = written
current_uncovered = uncovered_writes
for event_sequence, target, event_timestamp in observed_uncovered:
    if (event_sequence, target, event_timestamp) in current_uncovered:
        continue
    if target not in latest_by_target:
        latest_by_target[target] = (event_sequence, event_timestamp)
        continue
    current_sequence, current_timestamp = latest_by_target[target]
    current_epoch = utc_epoch(current_timestamp)
    observed_epoch = utc_epoch(event_timestamp)
    if current_epoch is None or observed_epoch is None:
        conservative_timestamp = None
    else:
        conservative_timestamp = event_timestamp if observed_epoch > current_epoch else current_timestamp
    latest_by_target[target] = (max(event_sequence, current_sequence), conservative_timestamp)
receipts = eligible_review_receipts(session_started_at) if latest_by_target else []
uncovered = []
for target, (_, write_timestamp) in latest_by_target.items():
    write_epoch = utc_epoch(write_timestamp)
    if (write_epoch is None or not any(
            completed_epoch > write_epoch and receipt_workspace_covers(workspace, target)
            for completed_epoch, workspace in receipts)):
        uncovered.append(target)
uncovered.sort()
stale_reason = (
    "ROUTING GATE — cannot verify this turn: transcript appears stale "
    "(final assistant text not flushed after re-poll). Writes made this turn may be unreviewed. "
    "Ensure coverage or state the carve-out for the ledger before stopping again."
)
if not uncovered:
    if suspected_stale:
        print(json.dumps({"decision": "block", "reason": stale_reason}))
    sys.exit(0)
suppress = False
try:
    session_id = hook.get("session_id")
    if (not isinstance(session_id, str) or not session_id
            or "/" in session_id or ".." in session_id):
        raise ValueError("invalid session id for routing-gate acknowledgement")
    state_key = {
        "transcript_path": os.path.realpath(path),
        "uncovered_writes": [
            [target, latest_by_target[target][0], latest_by_target[target][1]]
            for target in uncovered
        ],
    }
    runtime_dir = os.environ.get("XDG_RUNTIME_DIR") or "/tmp"
    if not os.path.isabs(runtime_dir):
        raise ValueError("routing-gate runtime directory must be absolute")
    directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    runtime_fd = os.open(runtime_dir, directory_flags)
    try:
        try:
            os.mkdir("claude-routing-gate", mode=0o700, dir_fd=runtime_fd)
        except FileExistsError:
            pass
        state_dir_fd = os.open(
            "claude-routing-gate",
            directory_flags,
            dir_fd=runtime_fd,
        )
    finally:
        os.close(runtime_fd)
    matched = False
    try:
        state_dir_stat = os.fstat(state_dir_fd)
        if (not stat.S_ISDIR(state_dir_stat.st_mode)
                or stat.S_IMODE(state_dir_stat.st_mode) != 0o700):
            raise PermissionError("routing-gate state directory is not mode 0700")
        state_name = f"{session_id}.ack"
        try:
            state_fd = os.open(
                state_name,
                os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW,
                dir_fd=state_dir_fd,
            )
        except FileNotFoundError:
            stored_state = None
        else:
            if not stat.S_ISREG(os.fstat(state_fd).st_mode):
                os.close(state_fd)
                raise ValueError("routing-gate acknowledgement is not a regular file")
            with os.fdopen(state_fd, "r", encoding="utf-8") as state_file:
                stored_state = json.load(state_file)
            if (not isinstance(stored_state, dict)
                    or set(stored_state) != {"version", "state_key"}
                    or stored_state.get("version") != 1):
                raise ValueError("malformed routing-gate acknowledgement")
        matched = (
            stored_state is not None
            and stored_state["state_key"] == state_key
        )
        state_payload = (
            json.dumps(
                {"version": 1, "state_key": state_key},
                sort_keys=True,
                separators=(",", ":"),
            )
            + "\n"
        ).encode("utf-8")
        temporary_name = (
            f".{state_name}.{os.getpid()}.{os.urandom(8).hex()}.tmp"
        )
        temporary_fd = os.open(
            temporary_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
            dir_fd=state_dir_fd,
        )
        try:
            os.fchmod(temporary_fd, 0o600)
            if not matched:
                if os.write(temporary_fd, state_payload) != len(state_payload):
                    raise OSError("short routing-gate acknowledgement write")
                os.fsync(temporary_fd)
        finally:
            os.close(temporary_fd)
        if matched:
            os.unlink(temporary_name, dir_fd=state_dir_fd)
        else:
            os.replace(
                temporary_name,
                state_name,
                src_dir_fd=state_dir_fd,
                dst_dir_fd=state_dir_fd,
            )
    finally:
        os.close(state_dir_fd)
    suppress = matched
except Exception:
    pass
if suppress and not suspected_stale:
    sys.exit(0)
shown = uncovered[:8]
listing = "\n".join(
    "  - " + target
    + (
        ""
        if target.startswith("<mcp__") or os.path.exists(target)
        else "  (not found on disk — deleted, or a relative path resolved against an uncertain directory)"
    )
    for target in shown
)
if len(uncovered) > len(shown):
    listing += f"\n  ... and {len(uncovered) - len(shown)} more"
reason = (
    "ROUTING GATE — durable writes with no covering review.\n\n"
    f"{len(uncovered)} uncovered target(s) (detected: Write/Edit/NotebookEdit/MultiEdit, MCP "
    "mutations, shell redirections, cp/mv/install/tee/dd/rm/sed -i; heredocs and other shell "
    "writes are NOT tracked — the true count may be higher):\n"
    f"{listing}\n\n"
    "Coverage requires a later codex-wrapper / opencode-wrapper / grok-wrapper dispatch or a "
    "review receipt whose workspace contains the target.\n\n"
    "To proceed: dispatch a batched review covering these paths (mode review, "
    "--resume-from-pointer). If a named carve-out or exemption genuinely applies, state it for "
    "the completion ledger and stop again — the gate cannot verify statements; the statement is "
    "your record, not the gate's."
)
print(json.dumps({"decision": "block", "reason": reason}))
PY
