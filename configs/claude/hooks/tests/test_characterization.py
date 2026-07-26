"""Characterization tests that intentionally PASS on the pristine hook.

This is the explicit TDD inversion required by Station S2: a failure means the
test misunderstood current behavior.  It must never be "fixed" by changing the
hook (apart from the independently tested report-root seam).

Every test name carries its failure direction: ``under_block``, ``over_block``,
or ``neutral``.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import unittest

from tests.harness import (
    DEFAULT_RESULT_TS,
    DEFAULT_SESSION_TS,
    DEFAULT_WRITE_TS,
    GateFixture,
    assert_allow,
    assert_block,
    bash_exchange,
    dispatch_exchange,
    load_bash_write_targets,
    message_record,
    tool_result_record,
    tool_use_record,
    write_exchange,
)


VALID_RECEIPT = {
    "mode": "review",
    "launcher_status": "ok",
    "completed_at": "2026-01-01T00:00:20Z",
    "workspace": "/unrelated/workspace",
}


class FailOpenCharacterization(unittest.TestCase):
    def test_under_block_malformed_stdin_json_exits_silently(self) -> None:
        with GateFixture() as fixture:
            result = fixture.run(raw_stdin="{not json")
        assert_allow(self, result)

    def test_under_block_non_dict_hook_inputs_exit_silently(self) -> None:
        for hook_input in ([], "scalar", 17, None):
            with self.subTest(hook_input=hook_input), GateFixture() as fixture:
                result = fixture.run(hook_input=hook_input)
                assert_allow(self, result)

    def test_under_block_missing_or_nonexistent_transcript_exits_silently(self) -> None:
        inputs = ({"cwd": "/home/test"}, {"transcript_path": "/definitely/missing/transcript.jsonl"})
        for hook_input in inputs:
            with self.subTest(hook_input=hook_input), GateFixture() as fixture:
                result = fixture.run(hook_input=hook_input)
                assert_allow(self, result)

    def test_under_block_stop_hook_active_unconditionally_allows_uncovered_write(self) -> None:
        with GateFixture() as fixture:
            fixture.write_transcript(write_exchange())
            hook_input = fixture.hook_input(stop_hook_active=True)
            result = fixture.run(hook_input=hook_input)
        assert_allow(self, result)

    def test_under_block_malformed_interior_transcript_line_fails_open(self) -> None:
        use = json.dumps(tool_use_record("write-1", "Write", {"file_path": "/home/test/a"}))
        result_record = json.dumps(tool_result_record("write-1"))
        with GateFixture() as fixture:
            result = fixture.run(raw_transcript=use + "\n{torn\n" + result_record + "\n")
        assert_allow(self, result)

    def test_neutral_malformed_final_transcript_line_reaches_block_decision(self) -> None:
        complete = "".join(json.dumps(record) + "\n" for record in write_exchange())
        with GateFixture() as fixture:
            result = fixture.run(
                raw_transcript=complete + "{torn",
                env_overrides={"ROUTING_GATE_POLL_MS": "0"},
            )
        assert_block(self, result, ["/home/test/file.txt"])

    def test_under_block_duplicate_pending_tool_use_id_fails_open(self) -> None:
        records = [
            tool_use_record("duplicate", "Write", {"file_path": "/home/test/a"}),
            tool_use_record("duplicate", "Edit", {"file_path": "/home/test/b"}),
        ]
        with GateFixture() as fixture:
            result = fixture.run(records=records)
        assert_allow(self, result)

    def test_under_block_non_bool_tool_result_is_error_fails_open(self) -> None:
        records = [
            tool_use_record("write-1", "Write", {"file_path": "/home/test/a"}),
            tool_result_record("write-1", is_error="false"),
        ]
        with GateFixture() as fixture:
            result = fixture.run(records=records)
        assert_allow(self, result)


class BashParserCharacterization(unittest.TestCase):
    INVISIBLE_COMMANDS = {
        "cp_quoted": "cp -- 'source file' '/home/test/copied file'",
        "rm_flags": "rm -rf -- /home/test/removed",
        "mv_separator": "mv -- source /home/test/moved",
        "tee_flags": "printf x | tee -a /home/test/tee-output",
        "dd_operands": "dd if=/dev/zero of=/home/test/disk-image bs=1 count=1",
        "install_flags": "install -m 755 source /home/test/installed",
        "sed_in_place": "sed -i.bak 's/x/y/' /home/test/edited",
    }

    def test_neutral_writer_verbs_are_detected(self) -> None:
        expected_by_label = {
            "cp_quoted": [],
            "rm_flags": ["/home/test/removed"],
            "mv_separator": ["/home/test/moved"],
            "tee_flags": ["/home/test/tee-output"],
            "dd_operands": ["/home/test/disk-image"],
            "install_flags": ["/home/test/installed"],
            "sed_in_place": ["/home/test/edited"],
        }
        parser = load_bash_write_targets()
        for label, command in self.INVISIBLE_COMMANDS.items():
            with self.subTest(label=label):
                expected = expected_by_label[label]
                self.assertEqual(parser(command), expected)
                with GateFixture() as fixture:
                    result = fixture.run(records=bash_exchange(command))
                assert_block(self, result, expected)

    def test_under_block_python_heredoc_remains_invisible(self) -> None:
        command = "python3 - <<'PY'\nopen('/home/test/heredoc', 'w').write('x')\nPY"
        parser = load_bash_write_targets()
        self.assertEqual(parser(command), [])
        with GateFixture() as fixture:
            result = fixture.run(records=bash_exchange(command))
        assert_allow(self, result)

    def test_neutral_plain_and_append_redirections_are_detected(self) -> None:
        cases = {
            "plain": ("printf x > /home/test/output", ["/home/test/output"]),
            "append_quoted": ('printf x >> "/home/test/output file"', []),
            "verb_plus_redirection": (
                "cp source /home/test/invisible > /home/test/cp-log",
                ["/home/test/cp-log", "/home/test/invisible"],
            ),
        }
        parser = load_bash_write_targets()
        for label, (command, targets) in cases.items():
            with self.subTest(label=label):
                self.assertEqual(parser(command), targets)
                with GateFixture() as fixture:
                    result = fixture.run(records=bash_exchange(command))
                assert_block(self, result, targets)

    def test_neutral_command_substitution_does_not_hide_literal_redirection(self) -> None:
        command = "echo $(printf x) > /home/test/otherwise-visible"
        parser = load_bash_write_targets()
        self.assertEqual(parser(command), ["/home/test/otherwise-visible"])
        with GateFixture() as fixture:
            result = fixture.run(records=bash_exchange(command))
        assert_block(self, result, ["/home/test/otherwise-visible"])

    def test_under_block_unterminated_quote_exception_fails_entire_hook_open(self) -> None:
        command = "printf x > '/home/test/unclosed"
        parser = load_bash_write_targets()
        with self.assertRaises(ValueError):
            parser(command)
        with GateFixture() as fixture:
            result = fixture.run(records=bash_exchange(command))
        assert_allow(self, result)


class DurablePathCharacterization(unittest.TestCase):
    def test_neutral_tmp_scratchpad_and_dev_null_are_excluded(self) -> None:
        targets = (
            "/tmp/routing-gate-excluded",
            "/home/test/scratchpad/excluded.txt",
            "/dev/null",
        )
        for target in targets:
            with self.subTest(target=target), GateFixture() as fixture:
                result = fixture.run(records=write_exchange(target))
                assert_allow(self, result)

    def test_neutral_relative_path_resolves_against_hook_cwd(self) -> None:
        with GateFixture() as fixture:
            fixture.write_transcript(write_exchange("nested/../relative.txt"))
            result = fixture.run(hook_input=fixture.hook_input(cwd="/home/project"))
        assert_block(self, result, ["/home/project/relative.txt"])

    def test_neutral_tilde_expansion_uses_home(self) -> None:
        with GateFixture() as fixture:
            result = fixture.run(
                records=write_exchange("~/expanded.txt"),
                env_overrides={"HOME": "/home/fixture-user"},
            )
        assert_block(self, result, ["/home/fixture-user/expanded.txt"])

    def test_neutral_symlink_is_resolved_before_durability_filter(self) -> None:
        with GateFixture() as fixture:
            link = fixture.root / "durable-link"
            link.symlink_to("/home/test/real-target")
            result = fixture.run(records=write_exchange(str(link)))
        assert_block(self, result, ["/home/test/real-target"])


class LauncherStatusCharacterization(unittest.TestCase):
    NON_OK_STATUSES = (
        "detached",
        "still_running",
        "blocked_dirty_tree",
        "codex_failed",
        "invalid_result",
        "invalid_report",
        "review_violated_readonly",
    )

    def test_neutral_receipt_arm_requires_literal_ok_launcher_status(self) -> None:
        for status in self.NON_OK_STATUSES + ("OK", None):
            with self.subTest(status=status), GateFixture() as fixture:
                report = dict(VALID_RECEIPT, launcher_status=status)
                fixture.write_receipt(report)
                result = fixture.run(records=write_exchange())
                assert_block(self, result, ["/home/test/file.txt"])

    def test_neutral_dispatch_payload_without_failure_still_does_not_cover(self) -> None:
        payloads = (None, {}, {"launcher_status": None}, {"launcher_status": 0})
        for payload in payloads:
            with self.subTest(payload=payload), GateFixture() as fixture:
                records = write_exchange() + dispatch_exchange("codex-wrapper", content=payload)
                result = fixture.run(records=records)
                assert_block(self, result, ["/home/test/file.txt"])

    def test_neutral_dispatch_arm_rejects_every_named_non_ok_launcher_status(self) -> None:
        for status in self.NON_OK_STATUSES:
            with self.subTest(status=status), GateFixture() as fixture:
                records = write_exchange() + dispatch_exchange(
                    "codex-wrapper", content={"launcher_status": status}
                )
                result = fixture.run(records=records)
                assert_block(self, result, ["/home/test/file.txt"])

    def test_neutral_generic_non_success_status_set_keeps_dispatch_failed(self) -> None:
        statuses = ("failed", "blocked", "partial", "cancelled", "canceled", "timeout", "error")
        for status in statuses:
            with self.subTest(status=status), GateFixture() as fixture:
                records = write_exchange() + dispatch_exchange(
                    "codex-wrapper", content={"status": status, "launcher_status": "ok"}
                )
                result = fixture.run(records=records)
                assert_block(self, result, ["/home/test/file.txt"])


class ReceiptEligibilityCharacterization(unittest.TestCase):
    def test_neutral_receipt_mode_must_equal_review(self) -> None:
        for mode in ("write", "reviewer", "REVIEW", None):
            with self.subTest(mode=mode), GateFixture() as fixture:
                fixture.write_receipt(dict(VALID_RECEIPT, mode=mode))
                result = fixture.run(records=write_exchange())
                assert_block(self, result)

    def test_neutral_receipt_must_postdate_write_and_not_precede_session(self) -> None:
        cases = (
            ("2026-01-01T00:00:09Z", DEFAULT_SESSION_TS, DEFAULT_WRITE_TS),
            (DEFAULT_WRITE_TS, DEFAULT_SESSION_TS, DEFAULT_WRITE_TS),
            ("2026-01-01T00:00:15Z", "2026-01-01T00:00:20Z", DEFAULT_WRITE_TS),
        )
        for completed_at, session_ts, write_ts in cases:
            with self.subTest(completed_at=completed_at), GateFixture() as fixture:
                fixture.write_receipt(dict(VALID_RECEIPT, completed_at=completed_at))
                records = [
                    message_record([], timestamp=session_ts, role="system"),
                    *write_exchange(timestamp=write_ts),
                ]
                result = fixture.run(records=records)
                assert_block(self, result)

    def test_neutral_far_future_receipt_is_rejected_by_skew_bound(self) -> None:
        with GateFixture() as fixture:
            fixture.write_receipt(dict(VALID_RECEIPT, completed_at="2099-01-01T00:00:00Z"))
            result = fixture.run(records=write_exchange())
        assert_block(self, result, ["/home/test/file.txt"])

    def test_neutral_unsafe_or_invalid_receipt_candidates_are_ignored(self) -> None:
        kinds = ("symlink", "fifo", "directory", "oversized", "invalid-json", "non-dict")
        for kind in kinds:
            with self.subTest(kind=kind), GateFixture() as fixture:
                path = fixture.receipt_path()
                if kind == "symlink":
                    target = fixture.receipt_root / "actual.json"
                    target.write_text(json.dumps(VALID_RECEIPT), encoding="utf-8")
                    path.symlink_to(target)
                elif kind == "fifo":
                    os.mkfifo(path)
                elif kind == "directory":
                    path.mkdir()
                elif kind == "oversized":
                    path.write_bytes(b" " * (1024 * 1024 + 1))
                elif kind == "invalid-json":
                    path.write_text("{not-json", encoding="utf-8")
                else:
                    path.write_text(json.dumps([VALID_RECEIPT]), encoding="utf-8")
                result = fixture.run(records=write_exchange())
                assert_block(self, result)


class CoverageSemanticsCharacterization(unittest.TestCase):
    @staticmethod
    def two_writes() -> list[dict[str, object]]:
        return [
            *write_exchange("/home/test/first", tool_id="write-1", timestamp="2026-01-01T00:00:10Z"),
            *write_exchange("/home/test/second", tool_id="write-2", timestamp="2026-01-01T00:00:20Z"),
        ]

    def test_neutral_unrelated_receipt_does_not_discharge_any_target(self) -> None:
        with GateFixture() as fixture:
            fixture.write_receipt(dict(VALID_RECEIPT, completed_at="2026-01-01T00:00:30Z"))
            result = fixture.run(records=self.two_writes())
        assert_block(self, result, ["/home/test/first", "/home/test/second"])

    def test_neutral_receipt_after_only_earlier_write_does_not_cover_latest(self) -> None:
        with GateFixture() as fixture:
            fixture.write_receipt(dict(VALID_RECEIPT, completed_at="2026-01-01T00:00:15Z"))
            result = fixture.run(records=self.two_writes())
        assert_block(self, result, ["/home/test/first", "/home/test/second"])


class SessionAndDispatchCharacterization(unittest.TestCase):
    def test_neutral_first_record_with_timestamp_defines_session_start(self) -> None:
        records = [
            {"type": "session-meta", "message": {"content": []}},
            message_record([], timestamp="2026-01-01T00:00:05Z", role="system"),
            *write_exchange(timestamp="2026-01-01T00:00:10Z"),
        ]
        with GateFixture() as fixture:
            fixture.write_receipt(
                dict(VALID_RECEIPT, completed_at="2026-01-01T00:00:20Z", workspace="/home/test")
            )
            result = fixture.run(records=records)
        assert_allow(self, result)

    def test_neutral_task_and_agent_calls_do_not_cover_writes(self) -> None:
        recognized = ("codex-wrapper", "opencode-wrapper", "grok-wrapper")
        for tool_name in ("Task", "Agent"):
            for subagent_type in recognized:
                with self.subTest(tool_name=tool_name, subagent_type=subagent_type), GateFixture() as fixture:
                    records = write_exchange() + dispatch_exchange(
                        subagent_type,
                        tool_name=tool_name,
                        content={"launcher_status": "ok"},
                    )
                    result = fixture.run(records=records)
                    assert_block(self, result, ["/home/test/file.txt"])

        for subagent_type in ("general-purpose", "review", "codex_wrapper", None):
            with self.subTest(unrecognized=subagent_type), GateFixture() as fixture:
                records = write_exchange() + dispatch_exchange(
                    subagent_type,
                    content={"launcher_status": "ok"},
                )
                result = fixture.run(records=records)
                assert_block(self, result)

    def test_neutral_write_invoked_before_dispatch_remains_uncovered(self) -> None:
        records = [
            tool_use_record("write-1", "Write", {"file_path": "/home/test/interleaved"}),
            tool_use_record("dispatch-1", "Task", {"subagent_type": "codex-wrapper"}),
            tool_result_record("dispatch-1", content={"launcher_status": "ok"}),
            tool_result_record("write-1"),
        ]
        with GateFixture() as fixture:
            result = fixture.run(records=records)
        assert_block(self, result, ["/home/test/interleaved"])

    def test_neutral_dispatch_invoked_before_write_does_not_cover_write(self) -> None:
        records = [
            tool_use_record("dispatch-1", "Task", {"subagent_type": "codex-wrapper"}),
            tool_use_record("write-1", "Write", {"file_path": "/home/test/interleaved"}),
            tool_result_record("dispatch-1", content={"launcher_status": "ok"}),
            tool_result_record("write-1"),
        ]
        with GateFixture() as fixture:
            result = fixture.run(records=records)
        assert_block(self, result, ["/home/test/interleaved"])

    def test_over_block_complete_failure_json_in_narrative_marks_dispatch_failed(self) -> None:
        payload = {
            "status": "completed",
            "launcher_status": "ok",
            "verification": [{"evidence": json.dumps({"status": "failed"})}],
        }
        with GateFixture() as fixture:
            result = fixture.run(records=write_exchange() + dispatch_exchange("codex-wrapper", content=payload))
        assert_block(self, result)

    def test_neutral_successful_dispatch_narrative_does_not_cover_write(self) -> None:
        payload = {
            "status": "completed",
            "launcher_status": "ok",
            "verification": [{"evidence": 'observed {"status":"failed"} during RED'}],
        }
        with GateFixture() as fixture:
            result = fixture.run(records=write_exchange() + dispatch_exchange("codex-wrapper", content=payload))
        assert_block(self, result, ["/home/test/file.txt"])


class McpAndMessageCharacterization(unittest.TestCase):
    def test_neutral_mcp_mutations_emit_real_or_pseudo_targets(self) -> None:
        cases = (
            ("mcp__files__create_item", {"name": "fixture"}, "<mcp__files__create_item>"),
            ("mcp__files__updateThing", {"value": "fixture"}, "<mcp__files__updateThing>"),
            ("mcp__files__delete_item", {"file_path": "/home/test/mcp-file"}, "/home/test/mcp-file"),
        )
        for name, tool_input, expected in cases:
            with self.subTest(name=name), GateFixture() as fixture:
                records = [tool_use_record("mcp-1", name, tool_input), tool_result_record("mcp-1")]
                result = fixture.run(records=records)
                assert_block(self, result, [expected])

    def test_neutral_non_mutating_mcp_operation_is_ignored(self) -> None:
        records = [
            tool_use_record("mcp-1", "mcp__files__get_item", {"file_path": "/home/test/read-only"}),
            tool_result_record("mcp-1"),
        ]
        with GateFixture() as fixture:
            result = fixture.run(records=records)
        assert_allow(self, result)

    def test_neutral_mcp_mutation_with_only_excluded_paths_is_ignored(self) -> None:
        records = [
            tool_use_record("mcp-1", "mcp__files__create_item", {"file_path": "/tmp/excluded"}),
            tool_result_record("mcp-1"),
        ]
        with GateFixture() as fixture:
            result = fixture.run(records=records)
        assert_allow(self, result)

    def test_neutral_block_message_is_byte_pinned(self) -> None:
        target = "/home/test/exact-message"
        reason = (
            "ROUTING GATE — durable writes with no covering review.\n\n"
            "1 uncovered target(s) (detected: Write/Edit/NotebookEdit/MultiEdit, MCP mutations, "
            "shell redirections, cp/mv/install/tee/dd/rm/sed -i; heredocs and other shell writes "
            "are NOT tracked — the true count may be higher):\n"
            "1 shell write(s) with unresolvable targets (relative path, variable, or glob) "
            "— not tracked by path.\n"
            f"  - {target}  (not found on disk — deleted, or a relative path resolved against an "
            "uncertain directory)\n\n"
            "Coverage requires a later codex-wrapper / opencode-wrapper / grok-wrapper dispatch or "
            "a review receipt whose workspace contains the target.\n\n"
            "To proceed: dispatch a batched review covering these paths (mode review, "
            "--resume-from-pointer). If a named carve-out or exemption genuinely applies, state it "
            "for the completion ledger and stop again — the gate cannot verify statements; the "
            "statement is your record, not the gate's."
        )
        expected = json.dumps({"decision": "block", "reason": reason}) + "\n"
        with GateFixture() as fixture:
            result = fixture.run(
                records=[
                    *write_exchange(target),
                    *bash_exchange("cp source relative/unresolvable", tool_id="bash-2"),
                ]
            )
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, "")
        self.assertEqual(result.stdout, expected)

    def test_neutral_background_tasks_do_not_suppress_current_block(self) -> None:
        with GateFixture() as fixture:
            fixture.write_transcript(write_exchange())
            result = fixture.run(hook_input=fixture.hook_input(background_tasks=[{"status": "running"}]))
        assert_block(self, result)

    def test_neutral_last_assistant_message_mismatch_is_suspected_stale(self) -> None:
        assistant = message_record(
            [{"type": "text", "text": "older transcript text"}],
            timestamp=DEFAULT_SESSION_TS,
        )
        with GateFixture() as fixture:
            result = fixture.run(
                records=[assistant],
                hook_input=fixture.hook_input(last_assistant_message="new text absent from transcript"),
                env_overrides={"ROUTING_GATE_POLL_MS": "0"},
            )
        assert_block(self, result)
        self.assertIn("transcript appears stale", result.output_json["reason"])


if __name__ == "__main__":
    unittest.main()
