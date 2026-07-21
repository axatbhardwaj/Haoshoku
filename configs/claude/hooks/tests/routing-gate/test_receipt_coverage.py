"""CH5 component-safe per-target receipt coverage tests."""

from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from tests.harness import (
    GateFixture,
    assert_allow,
    assert_block,
    load_receipt_workspace_covers,
    tool_result_record,
    tool_use_record,
    write_exchange,
)


def receipt(workspace, completed_at: str = "2026-01-01T00:00:30Z"):
    return {
        "mode": "review",
        "launcher_status": "ok",
        "completed_at": completed_at,
        "workspace": workspace,
    }


class CoversUnitMatrix(unittest.TestCase):
    def test_neutral_component_safe_workspace_coverage_matrix(self) -> None:
        covers = load_receipt_workspace_covers()
        self.assertIsNotNone(covers, "CH5 receipt_workspace_covers is absent")
        cases = (
            ("/home/repo", "/home/repo", True, "equality"),
            ("/home/repo", "/home/repo/sub/file", True, "ancestry"),
            ("/home/repo", "/home/repository/file", False, "string prefix"),
            ("/home/repo/sub", "/home/repo", False, "workspace nested beneath target"),
            ("/", "/home/repo", False, "root rejection"),
            (None, "/home/repo", False, "missing"),
            (17, "/home/repo", False, "non-string"),
            ("relative/repo", "/home/repo", False, "relative"),
            ("", "/home/repo", False, "empty"),
            ("/home/repo", "<mcp__files__create_item>", False, "pseudo-target"),
        )
        for workspace, target, expected, label in cases:
            with self.subTest(label=label):
                self.assertEqual(covers(workspace, target), expected)

    def test_neutral_symlinked_workspace_is_realpath_normalized(self) -> None:
        covers = load_receipt_workspace_covers()
        self.assertIsNotNone(covers, "CH5 receipt_workspace_covers is absent")
        with tempfile.TemporaryDirectory(prefix="routing-gate-covers-") as raw_tmp:
            workspace = Path(raw_tmp) / "workspace-link"
            workspace.symlink_to("/home/repo")
            self.assertTrue(covers(str(workspace), "/home/repo/sub/file"))


class PerTargetReceiptCoverageTests(unittest.TestCase):
    def test_neutral_invalid_workspace_shapes_and_prefixes_do_not_cover(self) -> None:
        cases = (
            ("/home/repo", "/home/repository/file"),
            ("/home/repo/sub", "/home/repo"),
            ("/", "/home/repo/file"),
            (None, "/home/repo/file"),
            ("relative/repo", "/home/repo/file"),
        )
        for workspace, target in cases:
            with self.subTest(workspace=workspace, target=target), GateFixture() as fixture:
                fixture.write_receipt(receipt(workspace))
                result = fixture.run(records=write_exchange(target))
                assert_block(self, result, [target])

    def test_neutral_equality_ancestry_and_symlinked_workspace_cover(self) -> None:
        cases = (
            ("/home/repo", "/home/repo"),
            ("/home/repo", "/home/repo/sub/file"),
        )
        for workspace, target in cases:
            with self.subTest(workspace=workspace, target=target), GateFixture() as fixture:
                fixture.write_receipt(receipt(workspace))
                result = fixture.run(records=write_exchange(target))
                assert_allow(self, result)

        with GateFixture() as fixture:
            workspace = fixture.root / "workspace-link"
            workspace.symlink_to("/home/repo")
            fixture.write_receipt(receipt(str(workspace)))
            result = fixture.run(records=write_exchange("/home/repo/sub/file"))
            assert_allow(self, result)

    def test_neutral_mcp_pseudo_target_is_never_receipt_coverable(self) -> None:
        records = [
            tool_use_record("mcp-1", "mcp__files__create_item", {"value": "x"}),
            tool_result_record("mcp-1"),
        ]
        with GateFixture() as fixture:
            fixture.write_receipt(receipt("/home/repo"))
            result = fixture.run(records=records)
        assert_block(self, result, ["<mcp__files__create_item>"])

    def test_neutral_disjoint_receipts_cover_only_their_own_target_subsets(self) -> None:
        records = [
            *write_exchange("/home/repo-a/one", tool_id="write-a", timestamp="2026-01-01T00:00:10Z"),
            *write_exchange("/home/repo-b/two", tool_id="write-b", timestamp="2026-01-01T00:00:20Z"),
            *write_exchange("/home/repo-c/three", tool_id="write-c", timestamp="2026-01-01T00:00:25Z"),
        ]
        with GateFixture() as fixture:
            fixture.write_receipt(receipt("/home/repo-a"), run_name="run-a")
            fixture.write_receipt(receipt("/home/repo-b"), run_name="run-b")
            result = fixture.run(records=records)
        assert_block(self, result, ["/home/repo-c/three"])
        reason = result.output_json["reason"]
        self.assertNotIn("  - /home/repo-a/one", reason)
        self.assertNotIn("  - /home/repo-b/two", reason)

    def test_neutral_receipt_timestamp_is_compared_to_each_targets_latest_write(self) -> None:
        records = [
            *write_exchange("/home/repo/early", tool_id="write-early", timestamp="2026-01-01T00:00:10Z"),
            *write_exchange("/home/repo/late", tool_id="write-late", timestamp="2026-01-01T00:00:20Z"),
        ]
        with GateFixture() as fixture:
            fixture.write_receipt(receipt("/home/repo", "2026-01-01T00:00:15Z"))
            result = fixture.run(records=records)
        assert_block(self, result, ["/home/repo/late"])
        self.assertNotIn("  - /home/repo/early", result.output_json["reason"])

    def test_neutral_missing_write_timestamp_is_never_receipt_coverable(self) -> None:
        with GateFixture() as fixture:
            fixture.write_receipt(receipt("/home/repo"))
            result = fixture.run(records=write_exchange("/home/repo/no-timestamp", timestamp=None))
        assert_block(self, result, ["/home/repo/no-timestamp"])


if __name__ == "__main__":
    unittest.main()
