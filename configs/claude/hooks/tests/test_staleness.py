"""CH2 staleness-detector and bounded re-poll tests."""

from __future__ import annotations

import threading
import time
import unittest
import json

from tests.harness import (
    GateFixture,
    assert_allow,
    assert_block,
    dispatch_exchange,
    message_record,
    write_exchange,
)


STALE_HEADER = "ROUTING GATE — cannot verify this turn: transcript appears stale"
STALE_REASON = (
    "ROUTING GATE — cannot verify this turn: transcript appears stale "
    "(final assistant text not flushed after re-poll). Writes made this turn may be unreviewed. "
    "Ensure coverage or state the carve-out for the ledger before stopping again."
)


def assistant_text_record(text_blocks: list[str], *, message_id: str = "assistant-message"):
    record = message_record(
        [{"type": "text", "text": text} for text in text_blocks],
        role="assistant",
    )
    record["message"]["id"] = message_id
    return record


class StalenessDetectorTests(unittest.TestCase):
    def test_neutral_mismatched_last_assistant_message_blocks_as_suspected_stale(self) -> None:
        with GateFixture() as fixture:
            fixture.write_transcript([assistant_text_record(["older transcript text"])])
            result = fixture.run(
                hook_input=fixture.hook_input(last_assistant_message="new text absent from transcript"),
                env_overrides={"ROUTING_GATE_POLL_MS": "0"},
            )
        assert_block(self, result)
        self.assertEqual(
            result.stdout,
            json.dumps({"decision": "block", "reason": STALE_REASON}) + "\n",
        )

    def test_neutral_torn_tail_without_writes_blocks_as_suspected_stale(self) -> None:
        with GateFixture() as fixture:
            result = fixture.run(
                raw_transcript="{torn",
                env_overrides={"ROUTING_GATE_POLL_MS": "0"},
            )
        assert_block(self, result)
        self.assertIn(STALE_HEADER, result.output_json["reason"])

    def test_neutral_non_hashable_write_timestamp_remains_uncovered(self) -> None:
        """neutral: observation retention must not add a timestamp-shaped fail-open."""
        records = write_exchange("/home/test/non-hashable-timestamp")
        records[0]["timestamp"] = {"unexpected": "shape"}
        with GateFixture() as fixture:
            result = fixture.run(records=records)
        assert_block(self, result, ["/home/test/non-hashable-timestamp"])

    def test_neutral_last_text_bearing_record_survives_later_same_message_tool_record(self) -> None:
        text = assistant_text_record(["final answer text"], message_id="repeated-message")
        later_tool_only = message_record(
            [{"type": "tool_use", "id": "read-1", "name": "Read", "input": {"file_path": "/x"}}],
            role="assistant",
        )
        later_tool_only["message"]["id"] = "repeated-message"
        with GateFixture() as fixture:
            result = fixture.run(
                records=[text, later_tool_only],
                hook_input=fixture.hook_input(last_assistant_message="final answer text"),
                env_overrides={"ROUTING_GATE_POLL_MS": "0"},
            )
        assert_allow(self, result)

    def test_neutral_text_blocks_are_concatenated_and_whitespace_normalized(self) -> None:
        with GateFixture() as fixture:
            result = fixture.run(
                records=[assistant_text_record(["alpha\n", "   beta\t gamma"])],
                hook_input=fixture.hook_input(last_assistant_message="alpha beta gamma"),
                env_overrides={"ROUTING_GATE_POLL_MS": "0"},
            )
        assert_allow(self, result)

    def test_neutral_non_string_empty_or_absent_last_message_does_not_infer_staleness(self) -> None:
        for overrides in ({}, {"last_assistant_message": ""}, {"last_assistant_message": None}, {"last_assistant_message": 7}):
            with self.subTest(overrides=overrides), GateFixture() as fixture:
                fixture.write_transcript([assistant_text_record(["transcript text"])])
                hook_input = fixture.hook_input(**overrides)
                result = fixture.run(
                    hook_input=hook_input,
                    env_overrides={"ROUTING_GATE_POLL_MS": "0"},
                )
                assert_allow(self, result)

    def test_under_block_stop_hook_active_remains_unconditional_with_stale_mismatch(self) -> None:
        with GateFixture() as fixture:
            fixture.write_transcript([assistant_text_record(["older"])])
            result = fixture.run(
                hook_input=fixture.hook_input(
                    stop_hook_active=True,
                    last_assistant_message="newer",
                ),
                env_overrides={"ROUTING_GATE_POLL_MS": "0"},
            )
        assert_allow(self, result)

    def test_neutral_compaction_summary_record_is_ignored_as_normal_non_assistant_text(self) -> None:
        compact = {
            "type": "user",
            "isCompactSummary": True,
            "timestamp": "2026-01-01T00:00:00Z",
            "message": {"role": "user", "content": "compacted context"},
        }
        with GateFixture() as fixture:
            result = fixture.run(
                records=[compact, assistant_text_record(["current final text"])],
                hook_input=fixture.hook_input(last_assistant_message="current final text"),
                env_overrides={"ROUTING_GATE_POLL_MS": "0"},
            )
        assert_allow(self, result)

    def test_neutral_stale_path_performs_exactly_five_configured_poll_sleeps(self) -> None:
        with GateFixture() as fixture:
            fixture.write_transcript([assistant_text_record(["older"])])
            started = time.perf_counter()
            result = fixture.run(
                hook_input=fixture.hook_input(last_assistant_message="newer"),
                env_overrides={"ROUTING_GATE_POLL_MS": "20"},
            )
            elapsed = time.perf_counter() - started
        assert_block(self, result)
        self.assertGreaterEqual(elapsed, 0.09, elapsed)
        self.assertLess(elapsed, 1.0, elapsed)

    def test_neutral_repoll_keeps_write_after_text_becomes_fresh(self) -> None:
        with GateFixture() as fixture:
            fixture.write_transcript([
                *write_exchange("/home/test/pre-poll-write"),
                assistant_text_record(["older"]),
            ])
            hook_input = fixture.hook_input(last_assistant_message="fresh final text")

            def make_transcript_fresh() -> None:
                time.sleep(0.05)
                fixture.write_transcript([
                    *write_exchange("/home/test/pre-poll-write"),
                    *dispatch_exchange("codex-wrapper", content={"launcher_status": "ok"}),
                    assistant_text_record(["fresh final text"]),
                ])

            updater = threading.Thread(target=make_transcript_fresh)
            updater.start()
            result = fixture.run(
                hook_input=hook_input,
                env_overrides={"ROUTING_GATE_POLL_MS": "100"},
            )
            updater.join()

        assert_block(self, result, ["/home/test/pre-poll-write"])


if __name__ == "__main__":
    unittest.main()
