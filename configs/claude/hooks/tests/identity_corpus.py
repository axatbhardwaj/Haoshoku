"""Whole-hook pristine-vs-fixed monotonicity corpus.

The pristine hook is materialized from the repository's initial commit into a
private temporary file. Corpus writes deliberately have no tool-use timestamp,
so unrelated production receipts can never make the proof flaky. S3A permits
message-only diffs and an explicit allow-to-block set, but no block-to-allow
transition in this static corpus.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import tempfile
import threading
import time
from typing import Any, Iterable
import unittest

from tests.harness import (
    HOOK,
    GateFixture,
    bash_exchange,
    dispatch_exchange,
    message_record,
    pristine_hook_copy,
    tool_result_record,
    tool_use_record,
    write_exchange,
)


@dataclass(frozen=True)
class IdentityScenario:
    name: str
    records: Iterable[Any] | None = None
    raw_transcript: str | None = None
    hook_input: Any | None = None
    raw_stdin: str | None = None


def _write(target: str, *, tool_id: str = "write-1", name: str = "Write") -> list[dict[str, Any]]:
    return write_exchange(target, tool_id=tool_id, name=name, timestamp=None)


def _bash(command: str, *, tool_id: str = "bash-1") -> list[dict[str, Any]]:
    return bash_exchange(command, tool_id=tool_id, timestamp=None)


def build_identity_scenarios(fixture: GateFixture) -> list[IdentityScenario]:
    """Return a varied 48-scenario corpus spanning every major current arm."""
    durable = "/home/identity/file"
    valid_input = fixture.hook_input()
    stop_active_input = fixture.hook_input(stop_hook_active=True)
    malformed_use = json.dumps(tool_use_record("write-1", "Write", {"file_path": durable}, timestamp=None))
    malformed_result = json.dumps(tool_result_record("write-1"))
    scenarios = [
        IdentityScenario("malformed-stdin", raw_stdin="{bad"),
        IdentityScenario("blank-stdin", raw_stdin=""),
        IdentityScenario("array-input", hook_input=[]),
        IdentityScenario("scalar-input", hook_input="scalar"),
        IdentityScenario("null-input", hook_input=None, raw_stdin="null"),
        IdentityScenario("missing-transcript-field", hook_input={"cwd": "/home/test"}),
        IdentityScenario("nonexistent-transcript", hook_input={"transcript_path": "/missing/identity.jsonl"}),
        IdentityScenario("stop-active-write", records=_write(durable), hook_input=stop_active_input),
        IdentityScenario("empty-transcript", records=[]),
        IdentityScenario("blank-transcript", raw_transcript="\n  \n", hook_input=valid_input),
        IdentityScenario("scalar-transcript-record", records=[17], hook_input=valid_input),
        IdentityScenario(
            "malformed-interior",
            raw_transcript=malformed_use + "\n{torn\n" + malformed_result + "\n",
            hook_input=valid_input,
        ),
        IdentityScenario(
            "malformed-tail",
            raw_transcript=malformed_use + "\n" + malformed_result + "\n{torn",
            hook_input=valid_input,
        ),
        IdentityScenario("write", records=_write(durable), hook_input=valid_input),
        IdentityScenario("edit", records=_write(durable, name="Edit"), hook_input=valid_input),
        IdentityScenario("notebook-edit", records=_write(durable, name="NotebookEdit"), hook_input=valid_input),
        IdentityScenario("multi-edit", records=_write(durable, name="MultiEdit"), hook_input=valid_input),
        IdentityScenario("tmp-exclusion", records=_write("/tmp/identity"), hook_input=valid_input),
        IdentityScenario("scratchpad-exclusion", records=_write("/home/x/scratchpad/y"), hook_input=valid_input),
        IdentityScenario("dev-null-exclusion", records=_write("/dev/null"), hook_input=valid_input),
    ]
    invisible_commands = [
        "cp source /home/identity/cp",
        "rm -f /home/identity/rm",
        "mv source /home/identity/mv",
        "printf x | tee /home/identity/tee",
        "dd if=/dev/null of=/home/identity/dd",
        "install source /home/identity/install",
        "sed -i 's/x/y/' /home/identity/sed",
        "python3 - <<'PY'\nprint('>')\nPY",
    ]
    scenarios.extend(
        IdentityScenario(f"bash-invisible-{index}", records=_bash(command), hook_input=valid_input)
        for index, command in enumerate(invisible_commands, start=1)
    )
    scenarios.extend(
        [
            IdentityScenario("bash-plain-redirection", records=_bash("echo x > /home/identity/out"), hook_input=valid_input),
            IdentityScenario("bash-append-redirection", records=_bash("echo x >> '/home/identity/out file'"), hook_input=valid_input),
            IdentityScenario("bash-command-substitution", records=_bash("echo $(x) > /home/identity/out"), hook_input=valid_input),
            IdentityScenario("bash-unterminated-quote", records=_bash("echo x > '/home/identity/out"), hook_input=valid_input),
        ]
    )
    for worker in ("codex-wrapper", "opencode-wrapper", "grok-wrapper"):
        records = [
            *_write(durable),
            tool_use_record("dispatch-1", "Task", {"subagent_type": worker}, timestamp=None),
            tool_result_record("dispatch-1", content={"launcher_status": "ok"}),
        ]
        scenarios.append(IdentityScenario(f"dispatch-{worker}", records=records, hook_input=valid_input))
    scenarios.extend(
        [
            IdentityScenario(
                "dispatch-missing-launcher-status",
                records=[
                    *_write(durable),
                    tool_use_record("dispatch-1", "Task", {"subagent_type": "codex-wrapper"}, timestamp=None),
                    tool_result_record("dispatch-1", content={}),
                ],
                hook_input=valid_input,
            ),
            IdentityScenario(
                "dispatch-failed-status",
                records=[
                    *_write(durable),
                    tool_use_record("dispatch-1", "Task", {"subagent_type": "codex-wrapper"}, timestamp=None),
                    tool_result_record("dispatch-1", content={"launcher_status": "failed"}),
                ],
                hook_input=valid_input,
            ),
            IdentityScenario(
                "unrecognized-dispatch",
                records=[
                    *_write(durable),
                    tool_use_record("dispatch-1", "Task", {"subagent_type": "general-purpose"}, timestamp=None),
                    tool_result_record("dispatch-1", content={"launcher_status": "ok"}),
                ],
                hook_input=valid_input,
            ),
            IdentityScenario(
                "write-before-dispatch-completes-last",
                records=[
                    tool_use_record("write-1", "Write", {"file_path": durable}, timestamp=None),
                    tool_use_record("dispatch-1", "Task", {"subagent_type": "codex-wrapper"}, timestamp=None),
                    tool_result_record("dispatch-1", content={"launcher_status": "ok"}),
                    tool_result_record("write-1"),
                ],
                hook_input=valid_input,
            ),
            IdentityScenario(
                "dispatch-before-write",
                records=[
                    tool_use_record("dispatch-1", "Task", {"subagent_type": "codex-wrapper"}, timestamp=None),
                    tool_use_record("write-1", "Write", {"file_path": durable}, timestamp=None),
                    tool_result_record("dispatch-1", content={"launcher_status": "ok"}),
                    tool_result_record("write-1"),
                ],
                hook_input=valid_input,
            ),
        ]
    )
    scenarios.extend(
        [
            IdentityScenario(
                "mcp-pseudo-target",
                records=[
                    tool_use_record("mcp-1", "mcp__files__create_item", {"value": "x"}, timestamp=None),
                    tool_result_record("mcp-1"),
                ],
                hook_input=valid_input,
            ),
            IdentityScenario(
                "mcp-real-target",
                records=[
                    tool_use_record("mcp-1", "mcp__files__delete_item", {"file_path": durable}, timestamp=None),
                    tool_result_record("mcp-1"),
                ],
                hook_input=valid_input,
            ),
            IdentityScenario(
                "mcp-read-only",
                records=[
                    tool_use_record("mcp-1", "mcp__files__get_item", {"file_path": durable}, timestamp=None),
                    tool_result_record("mcp-1"),
                ],
                hook_input=valid_input,
            ),
            IdentityScenario(
                "mcp-excluded-target",
                records=[
                    tool_use_record("mcp-1", "mcp__files__create_item", {"file_path": "/tmp/mcp"}, timestamp=None),
                    tool_result_record("mcp-1"),
                ],
                hook_input=valid_input,
            ),
            IdentityScenario(
                "duplicate-tool-id",
                records=[
                    tool_use_record("same", "Write", {"file_path": durable}, timestamp=None),
                    tool_use_record("same", "Edit", {"file_path": durable + "2"}, timestamp=None),
                ],
                hook_input=valid_input,
            ),
            IdentityScenario(
                "non-bool-is-error",
                records=[
                    tool_use_record("write-1", "Write", {"file_path": durable}, timestamp=None),
                    tool_result_record("write-1", is_error="false"),
                ],
                hook_input=valid_input,
            ),
            IdentityScenario(
                "failed-write-result",
                records=[
                    tool_use_record("write-1", "Write", {"file_path": durable}, timestamp=None),
                    tool_result_record("write-1", is_error=True),
                ],
                hook_input=valid_input,
            ),
            IdentityScenario(
                "sidechain-write-still-parsed",
                records=[
                    tool_use_record("write-1", "Write", {"file_path": durable}, timestamp=None, sidechain=True),
                    tool_result_record("write-1"),
                ],
                hook_input=valid_input,
            ),
        ]
    )
    return scenarios


def run_identity_corpus() -> dict[str, Any]:
    diffs: list[dict[str, Any]] = []
    block_to_allow: list[str] = []
    allow_to_block: list[str] = []
    block_message_only: list[str] = []
    unexpected_diffs: list[str] = []
    expected_allow_to_block = {"malformed-tail", *(f"bash-invisible-{index}" for index in range(1, 8))}
    with tempfile.TemporaryDirectory(prefix="routing-gate-pristine-") as raw_tmp:
        pristine = pristine_hook_copy(Path(raw_tmp) / "routing-gate-pristine.sh")
        with GateFixture() as fixture:
            scenarios = build_identity_scenarios(fixture)
            for scenario in scenarios:
                if scenario.records is not None:
                    fixture.write_transcript(scenario.records)
                elif scenario.raw_transcript is not None:
                    fixture.write_raw_transcript(scenario.raw_transcript)
                else:
                    fixture.write_transcript([])
                raw_stdin = scenario.raw_stdin
                if raw_stdin is None:
                    hook_input = fixture.hook_input() if scenario.hook_input is None else scenario.hook_input
                    raw_stdin = json.dumps(hook_input)
                pristine_result = fixture.run(
                    hook_path=pristine,
                    raw_stdin=raw_stdin,
                    use_receipt_seam=False,
                )
                current_result = fixture.run(
                    hook_path=HOOK,
                    raw_stdin=raw_stdin,
                    use_receipt_seam=False,
                    env_overrides={"ROUTING_GATE_POLL_MS": "0"},
                )
                left = (pristine_result.returncode, pristine_result.stdout)
                right = (current_result.returncode, current_result.stdout)
                if left != right:
                    diffs.append({"scenario": scenario.name, "pristine": left, "current": right})
                    if pristine_result.blocked and not current_result.blocked:
                        block_to_allow.append(scenario.name)
                    elif not pristine_result.blocked and current_result.blocked:
                        allow_to_block.append(scenario.name)
                        if scenario.name not in expected_allow_to_block:
                            unexpected_diffs.append(scenario.name)
                    elif pristine_result.blocked and current_result.blocked:
                        block_message_only.append(scenario.name)
                    else:
                        unexpected_diffs.append(scenario.name)
    missing_expected = sorted(expected_allow_to_block - set(allow_to_block))
    return {
        "scenario_count": len(scenarios),
        "pass_count": len(scenarios) - len(diffs),
        "diff_count": len(diffs),
        "diffs": diffs,
        "block_to_allow": block_to_allow,
        "allow_to_block": allow_to_block,
        "expected_allow_to_block": sorted(expected_allow_to_block),
        "missing_expected_allow_to_block": missing_expected,
        "block_message_only": block_message_only,
        "unexpected_diffs": unexpected_diffs,
        "compared": "initial-commit pristine vs working-tree hook",
        "environment": "no receipt fixtures; fixed poll interval forced to 0ms",
    }


def run_coverage_arrived_during_repoll() -> dict[str, Any]:
    """Create the sole permitted block-to-allow transition and timestamp its cover event."""
    with tempfile.TemporaryDirectory(prefix="routing-gate-pristine-") as raw_tmp:
        pristine = pristine_hook_copy(Path(raw_tmp) / "routing-gate-pristine.sh")
        with GateFixture() as fixture:
            initial = [
                *write_exchange("/home/identity/re-poll", timestamp=None),
                message_record([{"type": "text", "text": "older text"}], role="assistant"),
            ]
            covered = [
                *initial,
                *dispatch_exchange(
                    "codex-wrapper",
                    content={"launcher_status": "ok"},
                    timestamp="2026-01-01T00:00:12Z",
                ),
                message_record(
                    [{"type": "text", "text": "fresh completion text"}],
                    timestamp="2026-01-01T00:00:13Z",
                    role="assistant",
                ),
            ]
            fixture.write_transcript(initial)
            hook_input = fixture.hook_input(last_assistant_message="fresh completion text")
            pristine_result = fixture.run(
                hook_path=pristine,
                hook_input=hook_input,
                use_receipt_seam=False,
            )
            cover_event: dict[str, float] = {}

            def publish_coverage() -> None:
                time.sleep(0.15)
                replacement = fixture.transcript.with_suffix(".replacement")
                replacement.write_text(
                    "".join(json.dumps(record) + "\n" for record in covered),
                    encoding="utf-8",
                )
                os.replace(replacement, fixture.transcript)
                cover_event["timestamp"] = time.monotonic()

            updater = threading.Thread(target=publish_coverage)
            updater.start()
            poll_started = time.monotonic()
            fixed_result = fixture.run(
                hook_path=HOOK,
                hook_input=hook_input,
                env_overrides={"ROUTING_GATE_POLL_MS": "100"},
            )
            poll_ended = time.monotonic()
            updater.join()
    return {
        "classification": "coverage-arrived-during-re-poll",
        "cover_event_kind": "successful transcript dispatch after the write",
        "pristine_blocked": pristine_result.blocked,
        "fixed_blocked": fixed_result.blocked,
        "poll_started": poll_started,
        "cover_event_timestamp": cover_event.get("timestamp"),
        "poll_ended": poll_ended,
        "event_inside_poll_window": (
            cover_event.get("timestamp") is not None
            and poll_started <= cover_event["timestamp"] <= poll_ended
        ),
    }


def run_uncovered_write_removed_during_repoll() -> dict[str, Any]:
    """Prove a transcript replacement cannot erase an already-observed uncovered write."""
    with tempfile.TemporaryDirectory(prefix="routing-gate-pristine-") as raw_tmp:
        pristine = pristine_hook_copy(Path(raw_tmp) / "routing-gate-pristine.sh")
        with GateFixture() as fixture:
            initial = [
                *write_exchange("/home/identity/must-remain", timestamp=None),
                message_record([{"type": "text", "text": "older text"}], role="assistant"),
            ]
            replacement_records = [
                message_record(
                    [{"type": "text", "text": "fresh completion text"}],
                    timestamp="2026-01-01T00:00:13Z",
                    role="assistant",
                )
            ]
            fixture.write_transcript(initial)
            hook_input = fixture.hook_input(last_assistant_message="fresh completion text")
            pristine_result = fixture.run(
                hook_path=pristine,
                hook_input=hook_input,
                use_receipt_seam=False,
            )

            def remove_uncovered_write() -> None:
                time.sleep(0.15)
                replacement = fixture.transcript.with_suffix(".replacement")
                replacement.write_text(
                    "".join(json.dumps(record) + "\n" for record in replacement_records),
                    encoding="utf-8",
                )
                os.replace(replacement, fixture.transcript)

            updater = threading.Thread(target=remove_uncovered_write)
            updater.start()
            fixed_result = fixture.run(
                hook_path=HOOK,
                hook_input=hook_input,
                env_overrides={"ROUTING_GATE_POLL_MS": "100"},
            )
            updater.join()
    return {
        "classification": "uncovered-write-disappeared-without-coverage",
        "pristine_blocked": pristine_result.blocked,
        "fixed_blocked": fixed_result.blocked,
        "fixed_reason": fixed_result.output_json.get("reason") if fixed_result.output_json else None,
    }


class SeamDefaultIdentityTest(unittest.TestCase):
    def test_neutral_static_corpus_has_no_pristine_block_to_fixed_allow(self) -> None:
        report = run_identity_corpus()
        self.assertGreaterEqual(report["scenario_count"], 30)
        self.assertEqual(report["block_to_allow"], [], report["diffs"])
        self.assertEqual(report["unexpected_diffs"], [], report["diffs"])
        self.assertEqual(report["missing_expected_allow_to_block"], [], report)
        self.assertEqual(sorted(report["allow_to_block"]), report["expected_allow_to_block"])

    def test_neutral_only_classified_repoll_case_may_transition_block_to_allow(self) -> None:
        report = run_coverage_arrived_during_repoll()
        self.assertEqual(report["classification"], "coverage-arrived-during-re-poll")
        self.assertTrue(report["pristine_blocked"], report)
        self.assertFalse(report["fixed_blocked"], report)
        self.assertTrue(report["event_inside_poll_window"], report)

    def test_neutral_repoll_cannot_erase_an_observed_uncovered_write(self) -> None:
        report = run_uncovered_write_removed_during_repoll()
        self.assertTrue(report["pristine_blocked"], report)
        self.assertTrue(report["fixed_blocked"], report)
        self.assertIn("/home/identity/must-remain", report["fixed_reason"])


if __name__ == "__main__":
    print(json.dumps(run_identity_corpus(), indent=2, sort_keys=True))
