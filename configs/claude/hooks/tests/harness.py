"""Stdlib-only fixture and source helpers for routing-gate characterization.

Every subprocess test sets ``ROUTING_GATE_REPORT_GLOB_ROOTS`` to a private
temporary directory.  No helper in this module can create a receipt below the
production ``/tmp/codex-wrapper`` or ``/tmp/opencode-wrapper`` roots.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
HOOK = ROOT / "routing-gate.sh"
# The pristine hook is the behavioural oracle for the differential property tests.
# It is vendored as a fixture rather than read from git history so the suite runs
# wherever it is deployed — including ~/.claude/hooks/, which is not a repository.
# Identical to Haoshoku commit f0125cb configs/claude/hooks/routing-gate.sh.
#
# The digest is ENFORCED at copy time, not merely documented: a truncated, empty,
# or substituted fixture would otherwise be accepted silently, and every
# differential monotonicity test would then compare the fixed hook against
# whatever that file happened to contain while still reporting green.
PRISTINE_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "routing-gate.pristine.sh"
PRISTINE_SHA256 = "67eae3339c562933dcc235c1a62082de3c69c3abcfa324a7dae5324e39507c4e"
REAL_RECEIPT_ROOTS = (
    Path("/tmp/codex-wrapper"),
    Path("/tmp/opencode-wrapper"),
)
DEFAULT_SESSION_TS = "2026-01-01T00:00:00Z"
DEFAULT_WRITE_TS = "2026-01-01T00:00:10Z"
DEFAULT_RESULT_TS = "2026-01-01T00:00:11Z"


@dataclass(frozen=True)
class HookResult:
    returncode: int
    stdout: str
    stderr: str

    @property
    def output_json(self) -> dict[str, Any] | None:
        return json.loads(self.stdout) if self.stdout else None

    @property
    def blocked(self) -> bool:
        output = self.output_json
        return bool(output and output.get("decision") == "block")


def message_record(
    content: list[dict[str, Any]],
    *,
    timestamp: str | None = DEFAULT_WRITE_TS,
    role: str = "assistant",
    sidechain: bool = False,
) -> dict[str, Any]:
    record: dict[str, Any] = {
        "type": role,
        "isSidechain": sidechain,
        "message": {"role": role, "content": content},
    }
    if timestamp is not None:
        record["timestamp"] = timestamp
    return record


def tool_use_record(
    tool_id: str,
    name: str,
    tool_input: dict[str, Any],
    *,
    timestamp: str | None = DEFAULT_WRITE_TS,
    sidechain: bool = False,
) -> dict[str, Any]:
    return message_record(
        [{"type": "tool_use", "id": tool_id, "name": name, "input": tool_input}],
        timestamp=timestamp,
        role="assistant",
        sidechain=sidechain,
    )


def tool_result_record(
    tool_id: str,
    *,
    content: Any = "ok",
    is_error: Any = False,
    timestamp: str | None = DEFAULT_RESULT_TS,
) -> dict[str, Any]:
    return message_record(
        [
            {
                "type": "tool_result",
                "tool_use_id": tool_id,
                "is_error": is_error,
                "content": content,
            }
        ],
        timestamp=timestamp,
        role="user",
    )


def write_exchange(
    target: str = "/home/test/file.txt",
    *,
    tool_id: str = "write-1",
    name: str = "Write",
    timestamp: str | None = DEFAULT_WRITE_TS,
) -> list[dict[str, Any]]:
    key = "notebook_path" if name == "NotebookEdit" else "file_path"
    return [
        tool_use_record(tool_id, name, {key: target, "content": "fixture"}, timestamp=timestamp),
        tool_result_record(tool_id),
    ]


def bash_exchange(
    command: str,
    *,
    tool_id: str = "bash-1",
    timestamp: str | None = DEFAULT_WRITE_TS,
) -> list[dict[str, Any]]:
    return [
        tool_use_record(tool_id, "Bash", {"command": command}, timestamp=timestamp),
        tool_result_record(tool_id),
    ]


def dispatch_exchange(
    subagent_type: str,
    *,
    tool_name: str = "Task",
    tool_id: str = "dispatch-1",
    content: Any = None,
    timestamp: str | None = DEFAULT_WRITE_TS,
) -> list[dict[str, Any]]:
    return [
        tool_use_record(
            tool_id,
            tool_name,
            {"subagent_type": subagent_type, "prompt": "review"},
            timestamp=timestamp,
        ),
        tool_result_record(tool_id, content=content),
    ]


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.resolve(strict=False).relative_to(root.resolve(strict=False))
        return True
    except ValueError:
        return False


def assert_safe_fixture_path(path: Path) -> None:
    if any(_is_within(path, root) for root in REAL_RECEIPT_ROOTS):
        raise AssertionError(f"refusing production receipt fixture path: {path}")


class GateFixture:
    """One isolated transcript and receipt tree."""

    def __init__(self) -> None:
        self._temporary = tempfile.TemporaryDirectory(prefix="routing-gate-tests-")
        self.root = Path(self._temporary.name)
        self.receipt_root = self.root / "receipts"
        assert_safe_fixture_path(self.receipt_root)
        self.receipt_root.mkdir()
        self.transcript = self.root / "transcript.jsonl"

    def close(self) -> None:
        self._temporary.cleanup()

    def __enter__(self) -> "GateFixture":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def write_transcript(self, records: Iterable[Any]) -> Path:
        self.transcript.write_text(
            "".join(json.dumps(record) + "\n" for record in records),
            encoding="utf-8",
        )
        return self.transcript

    def write_raw_transcript(self, raw: str) -> Path:
        self.transcript.write_text(raw, encoding="utf-8")
        return self.transcript

    def hook_input(self, **overrides: Any) -> dict[str, Any]:
        result: dict[str, Any] = {
            "session_id": "characterization-session",
            "transcript_path": str(self.transcript),
            "cwd": "/home/test",
            "stop_hook_active": False,
            "last_assistant_message": "",
            "background_tasks": [],
        }
        result.update(overrides)
        return result

    def receipt_path(self, run_name: str = "run-fixture") -> Path:
        path = self.receipt_root / run_name / "report.json"
        assert_safe_fixture_path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def write_receipt(
        self,
        report: Any,
        *,
        run_name: str = "run-fixture",
        raw: bool = False,
    ) -> Path:
        path = self.receipt_path(run_name)
        path.write_text(report if raw else json.dumps(report), encoding="utf-8")
        return path

    def run(
        self,
        *,
        records: Iterable[Any] | None = None,
        raw_transcript: str | None = None,
        hook_input: Any | None = None,
        raw_stdin: str | None = None,
        hook_path: Path = HOOK,
        use_receipt_seam: bool = True,
        env_overrides: dict[str, str] | None = None,
    ) -> HookResult:
        if records is not None:
            self.write_transcript(records)
        elif raw_transcript is not None:
            self.write_raw_transcript(raw_transcript)
        elif not self.transcript.exists():
            self.write_transcript([])

        if raw_stdin is None:
            raw_stdin = json.dumps(self.hook_input() if hook_input is None else hook_input)
        env = os.environ.copy()
        if use_receipt_seam:
            env["ROUTING_GATE_REPORT_GLOB_ROOTS"] = str(self.receipt_root)
        else:
            env.pop("ROUTING_GATE_REPORT_GLOB_ROOTS", None)
            env.pop("ROUTING_GATE_POLL_MS", None)
        if env_overrides:
            env.update(env_overrides)
        completed = subprocess.run(
            [str(hook_path)],
            input=raw_stdin,
            text=True,
            capture_output=True,
            env=env,
            check=False,
        )
        return HookResult(completed.returncode, completed.stdout, completed.stderr)


def assert_allow(test: Any, result: HookResult) -> None:
    test.assertEqual(result.returncode, 0)
    test.assertEqual(result.stderr, "")
    test.assertEqual(result.stdout, "")


def assert_block(test: Any, result: HookResult, targets: Iterable[str] | None = None) -> None:
    test.assertEqual(result.returncode, 0)
    test.assertEqual(result.stderr, "")
    test.assertTrue(result.blocked, result.stdout)
    if targets is not None:
        reason = result.output_json["reason"]
        for target in targets:
            test.assertIn(f"  - {target}", reason)


def hook_python_source(hook_path: Path = HOOK) -> str:
    source = hook_path.read_text(encoding="utf-8")
    match = re.search(r"^python3 - \"\$INPUT\" <<'PY'.*?\n(.*)^PY\n?\Z", source, re.MULTILINE | re.DOTALL)
    if not match:
        raise ValueError(f"cannot locate embedded Python in {hook_path}")
    return match.group(1)


def function_span(function_name: str, hook_path: Path = HOOK) -> str:
    """Return exact function text, AST-delimited from ``def`` through ``end_lineno``."""
    source = hook_python_source(hook_path)
    tree = ast.parse(source)
    node = next(
        item
        for item in tree.body
        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and item.name == function_name
    )
    lines = source.splitlines(keepends=True)
    return "".join(lines[node.lineno - 1 : node.end_lineno])


def redirection_scanner_span(hook_path: Path = HOOK) -> str:
    """Return only the existing scanner body inside ``bash_write_targets``.

    The start sentinel is the indented ``targets = []`` initialization and the
    end sentinel is the inclusive unterminated-quote ``raise``.  Future verb
    extraction can be placed before or after this span without invalidating the
    pin; changing any current redirection-scanner byte invalidates it.
    """
    function = function_span("bash_write_targets", hook_path)
    start_marker = "    targets = []\n"
    end_marker = '        raise ValueError("unterminated shell quote")\n'
    start = function.index(start_marker)
    end = function.index(end_marker, start) + len(end_marker)
    return function[start:end]


def load_bash_write_targets(hook_path: Path = HOOK, *, cwd: str = "/home/fuzz"):
    """Load the literal hook function in-process without executing hook top-level code."""
    source = hook_python_source(hook_path)
    tree = ast.parse(source)
    helper_names = {
        "durable_path",
        "shell_target_is_resolvable",
        "shell_value_is_quoted",
        "shell_segments",
        "option_operands",
        "verb_segment_targets",
        "bash_verb_targets",
        "bash_write_targets",
    }
    assignment_names = {"AMBIGUOUS_BASH", "SHELL_ASSIGNMENT", "SHELL_TARGET_META"}
    selected: list[ast.stmt] = []
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id in assignment_names
            for target in node.targets
        ):
            selected.append(node)
        elif isinstance(node, ast.FunctionDef) and node.name in helper_names:
            selected.append(node)
    selected_names: set[str] = set()
    for node in selected:
        if isinstance(node, ast.Assign):
            selected_names.update(
                target.id for target in node.targets if isinstance(target, ast.Name)
            )
        elif isinstance(node, ast.FunctionDef):
            selected_names.add(node.name)
    required = {
        "AMBIGUOUS_BASH",
        "SHELL_TARGET_META",
        "durable_path",
        "shell_target_is_resolvable",
        "shell_value_is_quoted",
        "bash_write_targets",
    }
    if not required.issubset(selected_names):
        raise ValueError("missing bash_write_targets dependency while extracting hook logic")
    module = ast.fix_missing_locations(ast.Module(body=selected, type_ignores=[]))
    namespace: dict[str, Any] = {"os": os, "re": re, "shlex": __import__("shlex"), "hook_cwd": cwd}
    exec(compile(module, str(hook_path), "exec"), namespace)
    return namespace["bash_write_targets"]


def load_receipt_workspace_covers(hook_path: Path = HOOK):
    """Load the CH5 COVERS predicate, returning ``None`` before it exists."""
    source = hook_python_source(hook_path)
    tree = ast.parse(source)
    node = next(
        (
            item for item in tree.body
            if isinstance(item, ast.FunctionDef) and item.name == "receipt_workspace_covers"
        ),
        None,
    )
    if node is None:
        return None
    module = ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[]))
    namespace: dict[str, Any] = {"os": os}
    exec(compile(module, str(hook_path), "exec"), namespace)
    return namespace["receipt_workspace_covers"]


def pristine_hook_copy(destination: Path) -> Path:
    if not PRISTINE_FIXTURE.is_file():
        raise FileNotFoundError(
            f"pristine oracle fixture missing: {PRISTINE_FIXTURE}. "
            "The differential property tests compare the current hook against the "
            "pre-fix behaviour and cannot run without it."
        )
    payload = PRISTINE_FIXTURE.read_bytes()
    actual = hashlib.sha256(payload).hexdigest()
    if actual != PRISTINE_SHA256:
        raise ValueError(
            f"pristine oracle fixture digest mismatch: {PRISTINE_FIXTURE}\n"
            f"  expected {PRISTINE_SHA256}\n"
            f"  actual   {actual}\n"
            "Refusing to run differential tests against an unverified oracle — a "
            "wrong fixture makes every monotonicity comparison meaningless while "
            "still reporting green."
        )
    destination.write_bytes(payload)
    destination.chmod(0o755)
    return destination
