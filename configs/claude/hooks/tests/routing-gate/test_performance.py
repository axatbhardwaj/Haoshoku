"""Performance characterization for a full 500-candidate receipt scan."""

from __future__ import annotations

from time import perf_counter
import json
import unittest

from tests.harness import GateFixture, assert_block, write_exchange


RUN_DIR_COUNT = 500
PERF_LIMIT_SECONDS = 1.0
WORST_CASE_LIMIT_SECONDS = 5.0


def measure_receipt_scan() -> dict[str, float | int]:
    with GateFixture() as fixture:
        for index in range(RUN_DIR_COUNT):
            fixture.write_receipt(
                {
                    "mode": "review",
                    "launcher_status": "invalid_report",
                    "completed_at": "2026-01-01T00:00:20Z",
                },
                run_name=f"run-{index:04d}",
            )
        fixture.write_transcript(write_exchange())
        started = perf_counter()
        result = fixture.run()
        elapsed = perf_counter() - started
        assert result.blocked, result.stdout
    return {"run_dir_count": RUN_DIR_COUNT, "elapsed_seconds": elapsed, "limit_seconds": PERF_LIMIT_SECONDS}


def measure_worst_case_repoll() -> dict[str, float | int | str]:
    """Exercise all five default 500ms polls via the invalid-value fallback."""
    with GateFixture() as fixture:
        started = perf_counter()
        result = fixture.run(
            raw_transcript="{torn",
            env_overrides={"ROUTING_GATE_POLL_MS": "invalid"},
        )
        elapsed = perf_counter() - started
        assert result.blocked, result.stdout
    return {
        "poll_count": 5,
        "configured_value": "invalid (falls back to 500ms)",
        "elapsed_seconds": elapsed,
        "limit_seconds": WORST_CASE_LIMIT_SECONDS,
    }


class ReceiptScanPerformanceTest(unittest.TestCase):
    def test_neutral_500_run_dirs_complete_under_one_second(self) -> None:
        report = measure_receipt_scan()
        self.assertEqual(report["run_dir_count"], 500)
        self.assertLess(report["elapsed_seconds"], report["limit_seconds"], report)

    def test_neutral_five_default_polls_complete_under_five_seconds(self) -> None:
        report = measure_worst_case_repoll()
        self.assertEqual(report["poll_count"], 5)
        self.assertGreaterEqual(report["elapsed_seconds"], 2.25, report)
        self.assertLess(report["elapsed_seconds"], report["limit_seconds"], report)


if __name__ == "__main__":
    print(
        json.dumps(
            {"steady_state": measure_receipt_scan(), "worst_case": measure_worst_case_repoll()},
            indent=2,
            sort_keys=True,
        )
    )
