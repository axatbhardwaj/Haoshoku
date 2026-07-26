"""Regression tests for routing-gate tracked-root write scope."""

from __future__ import annotations

import os
from pathlib import Path
import unittest

from tests.harness import GateFixture, assert_allow, assert_block, bash_exchange, write_exchange


HOME = Path(os.path.realpath(os.path.expanduser("~")))
HOME_ENV = {"HOME": str(HOME)}


class TrackedRootScopeTests(unittest.TestCase):
    def test_01_structured_write_under_personal_is_named_and_blocks(self) -> None:
        target = HOME / "personal/x/f.ts"
        with GateFixture() as fixture:
            result = fixture.run(
                records=write_exchange("~/personal/x/f.ts"),
                env_overrides=HOME_ENV,
            )

        assert_block(self, result, [str(target)])

    def test_02_structured_write_under_defi_is_named_and_blocks(self) -> None:
        target = HOME / "defi/x/f.ts"
        with GateFixture() as fixture:
            result = fixture.run(
                records=write_exchange("~/defi/x/f.ts"),
                env_overrides=HOME_ENV,
            )

        assert_block(self, result, [str(target)])

    def test_03_structured_write_under_claude_is_named_and_blocks(self) -> None:
        target = HOME / ".claude/agents/x.md"
        with GateFixture() as fixture:
            result = fixture.run(
                records=write_exchange("~/.claude/agents/x.md"),
                env_overrides=HOME_ENV,
            )

        assert_block(self, result, [str(target)])

    def test_04_structured_write_under_codex_is_named_and_blocks(self) -> None:
        target = HOME / ".codex/config.toml"
        with GateFixture() as fixture:
            result = fixture.run(
                records=write_exchange("~/.codex/config.toml"),
                env_overrides=HOME_ENV,
            )

        assert_block(self, result, [str(target)])

    def test_05_structured_write_under_tmp_is_ignored(self) -> None:
        with GateFixture() as fixture:
            result = fixture.run(
                records=write_exchange("/tmp/scratch/f.txt"),
                env_overrides=HOME_ENV,
            )

        assert_allow(self, result)

    def test_06_absolute_shell_write_under_tracked_root_is_named(self) -> None:
        target = HOME / "personal/x/shell.txt"
        with GateFixture() as fixture:
            result = fixture.run(
                records=bash_exchange(f"cp source {target}"),
                env_overrides=HOME_ENV,
            )

        assert_block(self, result, [str(target)])

    def test_07_absolute_shell_write_outside_tracked_roots_is_ignored(self) -> None:
        with GateFixture() as fixture:
            result = fixture.run(
                records=bash_exchange("cp source /tmp/out.txt"),
                env_overrides=HOME_ENV,
            )

        assert_allow(self, result)

    def test_10_shared_string_prefix_is_outside_tracked_root(self) -> None:
        target = HOME / "personalX/f"
        with GateFixture() as fixture:
            result = fixture.run(
                records=write_exchange(str(target)),
                env_overrides=HOME_ENV,
            )

        assert_allow(self, result)

    def test_11_dotdot_traversal_outside_tracked_roots_is_ignored(self) -> None:
        escaped = "~/personal/../outside-tracked/f"
        with GateFixture() as fixture:
            result = fixture.run(
                records=write_exchange(escaped),
                env_overrides=HOME_ENV,
            )

        assert_allow(self, result)

    def test_12_tracked_root_itself_is_in_scope(self) -> None:
        target = HOME / "defi"
        with GateFixture() as fixture:
            result = fixture.run(
                records=write_exchange("~/defi"),
                env_overrides=HOME_ENV,
            )

        assert_block(self, result, [str(target)])


if __name__ == "__main__":
    unittest.main()
