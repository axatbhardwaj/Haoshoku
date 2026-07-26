"""Honest rendering and decision-invariance tests for uncovered targets."""

from __future__ import annotations

import unittest
from typing import Any

from tests.harness import (
    HOOK,
    GateFixture,
    HookResult,
    dispatch_exchange,
    pristine_hook_copy,
    tool_result_record,
    tool_use_record,
    write_exchange,
)


NOT_FOUND_SUFFIX = (
    "  (not found on disk — deleted, or a relative path resolved against an uncertain directory)"
)
MISSING_TARGET = HOOK.parent / "tests" / "__routing_gate_message_honesty_missing__"
# The pristine hook predates the private receipt seam and scans real /tmp receipt trees.
# Keep ambient receipts from discharging these controlled writes in either implementation.
FUTURE_WRITE_TS = "2099-01-01T00:00:10Z"
FUTURE_DISPATCH_TS = "2099-01-01T00:00:20Z"


def listing_lines(result: HookResult) -> list[str]:
    output = result.output_json
    if output is None:
        return []
    return [line for line in output["reason"].splitlines() if line.startswith("  - ")]


def listed_target_paths(result: HookResult) -> set[str]:
    targets = set()
    for line in listing_lines(result):
        rendered = line[len("  - ") :]
        if rendered.endswith(NOT_FOUND_SUFFIX):
            rendered = rendered[: -len(NOT_FOUND_SUFFIX)]
        targets.add(rendered)
    return targets


class MessageHonestyTests(unittest.TestCase):
    def run_current_and_pristine(
        self,
        fixture: GateFixture,
        records: list[dict[str, Any]],
    ) -> tuple[HookResult, HookResult]:
        pristine = pristine_hook_copy(fixture.root / "routing-gate.pristine.sh")
        current_result = fixture.run(records=records)
        pristine_result = fixture.run(records=records, hook_path=pristine)
        return current_result, pristine_result

    def test_existing_target_preserves_listing_line_byte_for_byte(self) -> None:
        existing = str(HOOK)
        self.assertTrue(HOOK.exists())
        with GateFixture() as fixture:
            current, pristine = self.run_current_and_pristine(
                fixture,
                write_exchange(existing, timestamp=FUTURE_WRITE_TS),
            )
        expected = [f"  - {existing}"]
        self.assertEqual(listing_lines(pristine), expected)
        self.assertEqual(listing_lines(current), expected)

    def test_missing_target_is_annotated_honestly(self) -> None:
        missing = str(MISSING_TARGET)
        self.assertFalse(MISSING_TARGET.exists())
        with GateFixture() as fixture:
            current, _ = self.run_current_and_pristine(
                fixture,
                write_exchange(missing, timestamp=FUTURE_WRITE_TS),
            )
        self.assertEqual(listing_lines(current), [f"  - {missing}{NOT_FOUND_SUFFIX}"])

    def test_mcp_pseudo_target_is_rendered_bare(self) -> None:
        target = "<mcp__notion__update-page>"
        records = [
            tool_use_record(
                "mcp-1",
                "mcp__notion__update-page",
                {"value": "fixture"},
                timestamp=FUTURE_WRITE_TS,
            ),
            tool_result_record("mcp-1"),
        ]
        with GateFixture() as fixture:
            current = fixture.run(records=records)
        self.assertEqual(listing_lines(current), [f"  - {target}"])

    def test_mixed_targets_render_existing_bare_and_missing_annotated(self) -> None:
        existing = str(HOOK)
        missing = str(MISSING_TARGET)
        records = write_exchange(
            existing,
            tool_id="write-existing",
            timestamp=FUTURE_WRITE_TS,
        ) + write_exchange(
            missing,
            tool_id="write-missing",
            timestamp=FUTURE_WRITE_TS,
        )
        with GateFixture() as fixture:
            current, _ = self.run_current_and_pristine(fixture, records)
        self.assertEqual(
            set(listing_lines(current)),
            {f"  - {existing}", f"  - {missing}{NOT_FOUND_SUFFIX}"},
        )

    def test_rendering_does_not_change_decisions_or_listed_target_sets(self) -> None:
        existing = str(HOOK)
        missing = str(MISSING_TARGET)
        scenarios = {
            "existing": write_exchange(existing, timestamp=FUTURE_WRITE_TS),
            "missing": write_exchange(missing, timestamp=FUTURE_WRITE_TS),
            "mixed": write_exchange(
                existing,
                tool_id="write-existing",
                timestamp=FUTURE_WRITE_TS,
            )
            + write_exchange(
                missing,
                tool_id="write-missing",
                timestamp=FUTURE_WRITE_TS,
            ),
            "allowed_after_dispatch": write_exchange(missing, timestamp=FUTURE_WRITE_TS)
            + dispatch_exchange(
                "codex-wrapper",
                tool_id="dispatch-cover",
                timestamp=FUTURE_DISPATCH_TS,
            ),
        }
        for label, records in scenarios.items():
            with self.subTest(label=label), GateFixture() as fixture:
                current, pristine = self.run_current_and_pristine(fixture, records)
                self.assertEqual(current.returncode, pristine.returncode)
                if label == "allowed_after_dispatch":
                    self.assertTrue(current.blocked)
                    self.assertFalse(pristine.blocked)
                    self.assertEqual(listed_target_paths(current), {missing})
                    self.assertEqual(listed_target_paths(pristine), set())
                    continue
                self.assertEqual(current.blocked, pristine.blocked)
                self.assertEqual(listed_target_paths(current), listed_target_paths(pristine))


if __name__ == "__main__":
    unittest.main()
