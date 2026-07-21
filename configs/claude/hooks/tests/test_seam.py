"""Tests for the report-root testability seam.

Unlike the characterization suite, this seam test follows ordinary RED/GREEN TDD:
the pristine hook must fail it because the environment override does not exist yet.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from tests.harness import assert_safe_fixture_path


ROOT = Path(__file__).resolve().parents[1]
HOOK = ROOT / "routing-gate.sh"
REAL_RECEIPT_ROOTS = {
    Path("/tmp/codex-wrapper"),
    Path("/tmp/opencode-wrapper"),
}


class ReportRootSeamTest(unittest.TestCase):
    def test_fixture_guard_rejects_production_wrapper_roots(self) -> None:
        """neutral: fixture helpers refuse both real receipt trees and descendants."""
        for root in REAL_RECEIPT_ROOTS:
            with self.subTest(root=root), self.assertRaises(AssertionError):
                assert_safe_fixture_path(root / "run-test" / "report.json")

    def test_override_root_supplies_receipt_without_real_wrapper_fixtures(self) -> None:
        """neutral: the seam redirects receipt discovery only when explicitly set."""
        with tempfile.TemporaryDirectory(prefix="routing-gate-seam-") as raw_tmp:
            tmp = Path(raw_tmp)
            now = datetime.now(timezone.utc)
            write_timestamp = (now - timedelta(seconds=10)).isoformat()
            result_timestamp = (now - timedelta(seconds=9)).isoformat()
            receipt_timestamp = (now - timedelta(seconds=5)).isoformat()
            receipt_root = tmp / "receipts"
            self.assertNotIn(receipt_root, REAL_RECEIPT_ROOTS)
            run_dir = receipt_root / "run-test"
            run_dir.mkdir(parents=True)
            (run_dir / "report.json").write_text(
                json.dumps(
                    {
                        "mode": "review",
                        "launcher_status": "ok",
                        "completed_at": receipt_timestamp,
                        "workspace": "/home/test",
                    }
                ),
                encoding="utf-8",
            )

            transcript = tmp / "transcript.jsonl"
            records = [
                {
                    "type": "assistant",
                    "timestamp": write_timestamp,
                    "isSidechain": False,
                    "message": {
                        "role": "assistant",
                        "content": [
                            {
                                "type": "tool_use",
                                "id": "write-1",
                                "name": "Write",
                                "input": {"file_path": "/home/test/seam.txt", "content": "x"},
                            }
                        ],
                    },
                },
                {
                    "type": "user",
                    "timestamp": result_timestamp,
                    "isSidechain": False,
                    "message": {
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": "write-1",
                                "is_error": False,
                                "content": "written",
                            }
                        ],
                    },
                },
            ]
            transcript.write_text(
                "".join(json.dumps(record) + "\n" for record in records),
                encoding="utf-8",
            )
            hook_input = {
                "session_id": "seam-test",
                "transcript_path": str(transcript),
                "cwd": "/home/test",
                "stop_hook_active": False,
                "last_assistant_message": "",
                "background_tasks": [],
            }
            env = os.environ.copy()
            env["ROUTING_GATE_REPORT_GLOB_ROOTS"] = str(receipt_root)
            completed = subprocess.run(
                [str(HOOK)],
                input=json.dumps(hook_input),
                text=True,
                capture_output=True,
                env=env,
                check=False,
            )

        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stderr, "")
        self.assertEqual(completed.stdout, "")

    def test_multiple_override_roots_are_colon_separated(self) -> None:
        """neutral: the seam discovers a receipt in any configured override root."""
        with tempfile.TemporaryDirectory(prefix="routing-gate-seam-multiple-") as raw_tmp:
            tmp = Path(raw_tmp)
            now = datetime.now(timezone.utc)
            write_timestamp = (now - timedelta(seconds=10)).isoformat()
            result_timestamp = (now - timedelta(seconds=9)).isoformat()
            receipt_timestamp = (now - timedelta(seconds=5)).isoformat()
            empty_root = tmp / "empty"
            receipt_root = tmp / "second"
            empty_root.mkdir()
            run_dir = receipt_root / "run-second"
            run_dir.mkdir(parents=True)
            (run_dir / "report.json").write_text(
                json.dumps(
                    {
                        "mode": "review",
                        "launcher_status": "ok",
                        "completed_at": receipt_timestamp,
                        "workspace": "/home/test",
                    }
                ),
                encoding="utf-8",
            )
            transcript = tmp / "transcript.jsonl"
            transcript.write_text(
                "".join(
                    json.dumps(record) + "\n"
                    for record in (
                        {
                            "timestamp": write_timestamp,
                            "isSidechain": False,
                            "message": {
                                "content": [
                                    {
                                        "type": "tool_use",
                                        "id": "write-1",
                                        "name": "Write",
                                        "input": {"file_path": "/home/test/multiple-roots"},
                                    }
                                ]
                            },
                        },
                        {
                            "timestamp": result_timestamp,
                            "isSidechain": False,
                            "message": {
                                "content": [
                                    {
                                        "type": "tool_result",
                                        "tool_use_id": "write-1",
                                        "is_error": False,
                                        "content": "written",
                                    }
                                ]
                            },
                        },
                    )
                ),
                encoding="utf-8",
            )
            env = os.environ.copy()
            env["ROUTING_GATE_REPORT_GLOB_ROOTS"] = os.pathsep.join(
                (str(empty_root), str(receipt_root))
            )
            completed = subprocess.run(
                [str(HOOK)],
                input=json.dumps(
                    {
                        "session_id": "seam-test",
                        "transcript_path": str(transcript),
                        "cwd": "/home/test",
                        "stop_hook_active": False,
                    }
                ),
                text=True,
                capture_output=True,
                env=env,
                check=False,
            )

        self.assertEqual(completed.returncode, 0)
        self.assertEqual(completed.stderr, "")
        self.assertEqual(completed.stdout, "")


if __name__ == "__main__":
    unittest.main()
