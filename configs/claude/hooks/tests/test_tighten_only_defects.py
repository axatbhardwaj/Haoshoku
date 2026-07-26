"""Regression tests for tighten-only dispatch and shell-target handling."""

from __future__ import annotations

from pathlib import Path
import unittest

from tests.harness import (
    GateFixture,
    assert_allow,
    assert_block,
    bash_exchange,
    dispatch_exchange,
    write_exchange,
)


SESSION_ID = "tighten-only-defects"
UNRESOLVABLE_LINE = (
    "{count} shell write(s) with unresolvable targets (relative path, variable, or glob) "
    "— not tracked by path."
)


def runtime_env(fixture: GateFixture) -> tuple[Path, dict[str, str]]:
    runtime = fixture.root / "runtime"
    runtime.mkdir()
    return runtime, {"XDG_RUNTIME_DIR": str(runtime)}


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
    def test_04_absolute_literal_shell_target_is_named(self) -> None:
        target = "/home/test/absolute-literal"
        with GateFixture() as fixture:
            result = fixture.run(records=bash_exchange(f"cp source {target}"))

        assert_block(self, result, [target])
        self.assertNotIn(UNRESOLVABLE_LINE.format(count=1), result.output_json["reason"])

    def test_05_variable_shell_target_is_counted_but_not_named(self) -> None:
        phantom = "/home/test/$VAR"
        with GateFixture() as fixture:
            result = fixture.run(records=bash_exchange(f"cp source {phantom}"))

        assert_block(self, result)
        reason = result.output_json["reason"]
        self.assertIn(UNRESOLVABLE_LINE.format(count=1), reason)
        self.assertNotIn(f"  - {phantom}", reason)

    def test_06_relative_shell_target_is_counted_without_assumed_cwd(self) -> None:
        relative = "configs/kit/output"
        assumed = f"/home/wrong-stop-cwd/{relative}"
        with GateFixture() as fixture:
            result = fixture.run(
                records=bash_exchange(f"cp source {relative}; printf %s /home/test"),
                hook_input=fixture.hook_input(cwd="/home/wrong-stop-cwd"),
            )

        assert_block(self, result)
        reason = result.output_json["reason"]
        self.assertIn(UNRESOLVABLE_LINE.format(count=1), reason)
        self.assertNotIn(f"  - {relative}", reason)
        self.assertNotIn(f"  - {assumed}", reason)

    def test_07_unresolvable_count_only_still_blocks(self) -> None:
        with GateFixture() as fixture:
            result = fixture.run(
                records=bash_exchange("cp source relative/only; printf %s /home/test")
            )

        assert_block(self, result)
        reason = result.output_json["reason"]
        self.assertIn("0 uncovered target(s)", reason)
        self.assertIn(UNRESOLVABLE_LINE.format(count=1), reason)
        self.assertNotIn("  - ", reason)

    def test_08_new_unresolvable_write_reblocks_after_acknowledgement(self) -> None:
        first_records = bash_exchange("cp source relative/same; printf %s /home/test")
        expanded_records = [
            *first_records,
            *bash_exchange(
                "cp source relative/same; printf %s /home/test",
                tool_id="bash-2",
                timestamp="2026-01-01T00:00:12Z",
            ),
        ]
        with GateFixture() as fixture:
            _, env = runtime_env(fixture)
            hook_input = fixture.hook_input(session_id=SESSION_ID)
            first = fixture.run(
                records=first_records,
                hook_input=hook_input,
                env_overrides=env,
            )
            repeated = fixture.run(
                records=first_records,
                hook_input=hook_input,
                env_overrides=env,
            )
            expanded = fixture.run(
                records=expanded_records,
                hook_input=hook_input,
                env_overrides=env,
            )

        assert_block(self, first)
        assert_allow(self, repeated)
        assert_block(self, expanded)
        self.assertIn(UNRESOLVABLE_LINE.format(count=1), first.output_json["reason"])
        self.assertIn(UNRESOLVABLE_LINE.format(count=2), expanded.output_json["reason"])

    def test_09_quoted_writer_target_is_counted_but_not_named(self) -> None:
        target = "/home/test/quoted-writer-target"
        with GateFixture() as fixture:
            result = fixture.run(records=bash_exchange(f"cp source '{target}'"))

        assert_block(self, result)
        reason = result.output_json["reason"]
        self.assertIn(UNRESOLVABLE_LINE.format(count=1), reason)
        self.assertNotIn(f"  - {target}", reason)

    def test_10_quoted_redirection_target_is_counted_but_not_named(self) -> None:
        target = "/home/test/quoted-redirection-target"
        with GateFixture() as fixture:
            result = fixture.run(records=bash_exchange(f'printf x > "{target}"'))

        assert_block(self, result)
        reason = result.output_json["reason"]
        self.assertIn(UNRESOLVABLE_LINE.format(count=1), reason)
        self.assertNotIn(f"  - {target}", reason)

    def test_11_backtick_writer_target_is_counted_but_not_named(self) -> None:
        phantom = "/home/test/`runtime-name`"
        with GateFixture() as fixture:
            result = fixture.run(records=bash_exchange(f"cp source {phantom}"))

        assert_block(self, result)
        reason = result.output_json["reason"]
        self.assertIn(UNRESOLVABLE_LINE.format(count=1), reason)
        self.assertNotIn(f"  - {phantom}", reason)

    def test_12_command_substitution_target_is_counted_but_not_named(self) -> None:
        phantom = "/home/test/$(runtime-name)"
        with GateFixture() as fixture:
            result = fixture.run(records=bash_exchange(f"cp source {phantom}"))

        assert_block(self, result)
        reason = result.output_json["reason"]
        self.assertIn(UNRESOLVABLE_LINE.format(count=1), reason)
        self.assertNotIn(f"  - {phantom}", reason)


if __name__ == "__main__":
    unittest.main()
