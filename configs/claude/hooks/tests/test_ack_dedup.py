"""Session-scoped acknowledgement tests for uncovered routing-gate writes."""

from __future__ import annotations

from pathlib import Path
import unittest

from tests.harness import (
    GateFixture,
    assert_allow,
    assert_block,
    write_exchange,
)


SESSION_ID = "ack-dedup-session"
FIRST_TARGET = "/home/test/first.txt"
SECOND_TARGET = "/home/test/second.txt"


def runtime_env(fixture: GateFixture) -> tuple[Path, dict[str, str]]:
    runtime = fixture.root / "runtime"
    runtime.mkdir()
    return runtime, {"XDG_RUNTIME_DIR": str(runtime)}


def ack_path(runtime: Path, session_id: str = SESSION_ID) -> Path:
    return runtime / "claude-routing-gate" / f"{session_id}.ack"


class AckDedupTests(unittest.TestCase):
    def test_01_first_uncovered_state_blocks(self) -> None:
        with GateFixture() as fixture:
            _, env = runtime_env(fixture)
            result = fixture.run(
                records=write_exchange(FIRST_TARGET),
                hook_input=fixture.hook_input(session_id=SESSION_ID),
                env_overrides=env,
            )

        assert_block(self, result, [FIRST_TARGET])

    def test_02_repeated_uncovered_state_is_silent(self) -> None:
        with GateFixture() as fixture:
            _, env = runtime_env(fixture)
            hook_input = fixture.hook_input(session_id=SESSION_ID)
            records = write_exchange(FIRST_TARGET)

            first = fixture.run(records=records, hook_input=hook_input, env_overrides=env)
            repeated = fixture.run(records=records, hook_input=hook_input, env_overrides=env)

        assert_block(self, first, [FIRST_TARGET])
        assert_allow(self, repeated)

    def test_03_new_target_reblocks(self) -> None:
        with GateFixture() as fixture:
            _, env = runtime_env(fixture)
            hook_input = fixture.hook_input(session_id=SESSION_ID)
            first_records = write_exchange(FIRST_TARGET)
            expanded_records = [
                *first_records,
                *write_exchange(
                    SECOND_TARGET,
                    tool_id="write-2",
                    timestamp="2026-01-01T00:00:12Z",
                ),
            ]

            first = fixture.run(
                records=first_records,
                hook_input=hook_input,
                env_overrides=env,
            )
            expanded = fixture.run(
                records=expanded_records,
                hook_input=hook_input,
                env_overrides=env,
            )

        assert_block(self, first, [FIRST_TARGET])
        assert_block(self, expanded, [FIRST_TARGET, SECOND_TARGET])

    def test_04_later_write_to_already_reported_target_reblocks(self) -> None:
        with GateFixture() as fixture:
            _, env = runtime_env(fixture)
            hook_input = fixture.hook_input(session_id=SESSION_ID)
            first_records = write_exchange(FIRST_TARGET)
            later_records = [
                *first_records,
                *write_exchange(
                    FIRST_TARGET,
                    tool_id="write-2",
                    timestamp="2026-01-01T00:00:12Z",
                ),
            ]

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
            later = fixture.run(
                records=later_records,
                hook_input=hook_input,
                env_overrides=env,
            )

        assert_block(self, first, [FIRST_TARGET])
        assert_allow(self, repeated)
        assert_block(self, later, [FIRST_TARGET])

    def test_05_coverage_arriving_clears_uncovered_state(self) -> None:
        with GateFixture() as fixture:
            _, env = runtime_env(fixture)
            hook_input = fixture.hook_input(session_id=SESSION_ID)
            records = write_exchange(FIRST_TARGET)
            first = fixture.run(records=records, hook_input=hook_input, env_overrides=env)
            fixture.write_receipt(
                {
                    "mode": "review",
                    "launcher_status": "ok",
                    "completed_at": "2026-01-01T00:00:20Z",
                    "workspace": "/home/test",
                }
            )
            covered = fixture.run(
                records=records,
                hook_input=hook_input,
                env_overrides=env,
            )

        assert_block(self, first, [FIRST_TARGET])
        assert_allow(self, covered)

    def test_06_different_sessions_do_not_share_acknowledgements(self) -> None:
        with GateFixture() as fixture:
            _, env = runtime_env(fixture)
            records = write_exchange(FIRST_TARGET)
            session_a = fixture.hook_input(session_id="ack-session-a")
            session_b = fixture.hook_input(session_id="ack-session-b")

            first_a = fixture.run(
                records=records,
                hook_input=session_a,
                env_overrides=env,
            )
            repeated_a = fixture.run(
                records=records,
                hook_input=session_a,
                env_overrides=env,
            )
            first_b = fixture.run(
                records=records,
                hook_input=session_b,
                env_overrides=env,
            )

        assert_block(self, first_a, [FIRST_TARGET])
        assert_allow(self, repeated_a)
        assert_block(self, first_b, [FIRST_TARGET])

    def test_07_invalid_session_ids_always_block(self) -> None:
        cases = (
            ("missing", None),
            ("empty", ""),
            ("non-string", 17),
            ("slash", "nested/session"),
            ("dot-dot", "session..escape"),
        )
        for label, session_id in cases:
            with self.subTest(label=label), GateFixture() as fixture:
                _, env = runtime_env(fixture)
                hook_input = fixture.hook_input()
                if session_id is None:
                    hook_input.pop("session_id")
                else:
                    hook_input["session_id"] = session_id

                first = fixture.run(
                    records=write_exchange(FIRST_TARGET),
                    hook_input=hook_input,
                    env_overrides=env,
                )
                repeated = fixture.run(
                    records=write_exchange(FIRST_TARGET),
                    hook_input=hook_input,
                    env_overrides=env,
                )

                assert_block(self, first, [FIRST_TARGET])
                assert_block(self, repeated, [FIRST_TARGET])

    def test_08_corrupt_or_unreadable_state_file_blocks(self) -> None:
        for label in ("corrupt", "unreadable", "symlink"):
            with self.subTest(label=label), GateFixture() as fixture:
                runtime, env = runtime_env(fixture)
                state_file = ack_path(runtime)
                hook_input = fixture.hook_input(session_id=SESSION_ID)
                first = fixture.run(
                    records=write_exchange(FIRST_TARGET),
                    hook_input=hook_input,
                    env_overrides=env,
                )
                assert_block(self, first, [FIRST_TARGET])
                if label == "corrupt":
                    state_file.write_text("{not json", encoding="utf-8")
                elif label == "unreadable":
                    state_file.chmod(0o000)
                else:
                    symlink_target = state_file.parent / "symlink-target"
                    state_file.replace(symlink_target)
                    state_file.symlink_to(symlink_target.name)

                try:
                    result = fixture.run(
                        records=write_exchange(FIRST_TARGET),
                        hook_input=hook_input,
                        env_overrides=env,
                    )
                finally:
                    if label == "unreadable":
                        state_file.chmod(0o600)

                assert_block(self, result, [FIRST_TARGET])

    def test_09_unwritable_state_directory_blocks_without_crashing(self) -> None:
        with GateFixture() as fixture:
            runtime, env = runtime_env(fixture)
            state_directory = ack_path(runtime).parent
            state_directory.mkdir(mode=0o500)
            try:
                result = fixture.run(
                    records=write_exchange(FIRST_TARGET),
                    hook_input=fixture.hook_input(session_id=SESSION_ID),
                    env_overrides=env,
                )
            finally:
                state_directory.chmod(0o700)

        assert_block(self, result, [FIRST_TARGET])
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()
