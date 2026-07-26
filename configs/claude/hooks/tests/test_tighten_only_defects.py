"""Regression tests for tighten-only dispatch and shell-target handling."""

from __future__ import annotations

import unittest

from tests.harness import (
    GateFixture,
    assert_allow,
    assert_block,
    bash_exchange,
    dispatch_exchange,
    write_exchange,
)


class DispatchCoverageTests(unittest.TestCase):
    def test_01_worker_dispatch_does_not_discharge_earlier_write(self) -> None:
        target = "/home/test/unreviewed-before-dispatch"
        records = [
            *write_exchange(target),
            *dispatch_exchange("codex-wrapper", content={"launcher_status": "ok"}),
        ]
        with GateFixture() as fixture:
            result = fixture.run(records=records)

        assert_block(self, result, [target])

    def test_02_covering_review_receipt_allows_write(self) -> None:
        target = "/home/test/reviewed/target"
        with GateFixture() as fixture:
            fixture.write_receipt(
                {
                    "mode": "review",
                    "launcher_status": "ok",
                    "completed_at": "2026-01-01T00:00:20Z",
                    "workspace": "/home/test/reviewed",
                }
            )
            result = fixture.run(records=write_exchange(target))

        assert_allow(self, result)

    def test_03_noncovering_review_receipt_does_not_allow_write(self) -> None:
        target = "/home/test/outside-review-workspace"
        with GateFixture() as fixture:
            fixture.write_receipt(
                {
                    "mode": "review",
                    "launcher_status": "ok",
                    "completed_at": "2026-01-01T00:00:20Z",
                    "workspace": "/home/other-workspace",
                }
            )
            result = fixture.run(records=write_exchange(target))

        assert_block(self, result, [target])


class ShellTargetResolutionTests(unittest.TestCase):
    def test_04_named_in_scope_absolute_shell_target_blocks(self) -> None:
        target = "/home/test/absolute-literal"
        with GateFixture() as fixture:
            result = fixture.run(records=bash_exchange(f"cp source {target}"))

        assert_block(self, result, [target])

    def test_05_unresolvable_only_shell_write_is_ignored(self) -> None:
        with GateFixture() as fixture:
            result = fixture.run(
                records=bash_exchange("cp source relative/only; printf %s /home/test")
            )

        assert_allow(self, result)


if __name__ == "__main__":
    unittest.main()
