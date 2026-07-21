"""Reusable in-process differential fuzz scaffold for ``bash_write_targets``."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import random
import tempfile
from typing import Any, Callable
import unittest

from tests.harness import HOOK, load_bash_write_targets, pristine_hook_copy


VERBS = ("cp", "rm", "mv", "tee", "dd", "install", "sed")
QUOTES = ("{}", "'{}'", '"{}"', "{}\\ space")
OPERANDS = (
    "/home/fuzz/plain",
    "/home/fuzz/path with spaces",
    "/home/fuzz/δ-unicode",
    "/home/fuzz/semi;colon",
    "/home/fuzz/$(substitution)",
    "/home/fuzz/line\nbreak",
    "--leading-dash",
)
SEPARATORS = (" ", "; ", " && ", " || ", " | ", " & ", "\n")
REDIRECTIONS = ("", " > /home/fuzz/out", " >> '/home/fuzz/out file'", " 2>&1", " > $TARGET")
FLAG_CLUSTERS = ("", " -rf", " -ai", " -m 755", " --", " --unknown", " -t /home/fuzz/target")
AMBIGUOUS = ("", " <<EOF", " $(echo x)", " `echo x`", " [[ x > y ]]", " ((x > 0))")


def generated_commands(count: int, seed: int = 0x5EED) -> list[str]:
    rng = random.Random(seed)
    commands: list[str] = []
    for index in range(count):
        verb = VERBS[index % len(VERBS)]
        operand = OPERANDS[index % len(OPERANDS)]
        quote = QUOTES[index % len(QUOTES)]
        rendered = quote.format(operand.replace("'", "'\\''"))
        flags = FLAG_CLUSTERS[index % len(FLAG_CLUSTERS)]
        if verb == "dd":
            base = f"dd if=/dev/zero of={rendered} bs={rng.randint(1, 4096)}"
        elif verb == "sed":
            base = f"sed{flags} -i{rng.choice(('', '.bak'))} 's/a/b/' {rendered}"
        elif verb == "tee":
            base = f"tee{flags} {rendered} {rng.choice(OPERANDS)}"
        else:
            base = f"{verb}{flags} source {rendered}"
        if index % 5 == 0:
            second = f"echo {rng.choice(OPERANDS)}"
            base = base + SEPARATORS[index % len(SEPARATORS)] + second
        base += REDIRECTIONS[index % len(REDIRECTIONS)]
        base += AMBIGUOUS[index % len(AMBIGUOUS)]
        commands.append(base)
    return commands


def _evaluate(function: Callable[[str], list[str]], command: str) -> dict[str, Any]:
    try:
        return {"targets": function(command)}
    except Exception as exc:  # Characterize exception identity as part of the output.
        return {"exception": type(exc).__name__, "message": str(exc)}


def compare_hooks(left_path: Path, right_path: Path, *, count: int = 10_000, seed: int = 0x5EED) -> dict[str, Any]:
    left = load_bash_write_targets(left_path)
    right = load_bash_write_targets(right_path)
    diffs: list[dict[str, Any]] = []
    for index, command in enumerate(generated_commands(count, seed)):
        left_result = _evaluate(left, command)
        right_result = _evaluate(right, command)
        if left_result != right_result:
            diffs.append(
                {
                    "index": index,
                    "command": command,
                    "left": left_result,
                    "right": right_result,
                }
            )
    return {"command_count": count, "seed": seed, "diff_count": len(diffs), "diffs": diffs[:20]}


def pristine_vs_pristine(count: int = 10_000) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="routing-gate-fuzz-") as raw_tmp:
        pristine = pristine_hook_copy(Path(raw_tmp) / "routing-gate-pristine.sh")
        return compare_hooks(pristine, pristine, count=count)


def pristine_vs_fixed(count: int = 10_000, seed: int = 0x5EED) -> dict[str, Any]:
    """Prove the fixed extractor is exception-free and a target superset of pristine."""
    with tempfile.TemporaryDirectory(prefix="routing-gate-fuzz-") as raw_tmp:
        pristine = pristine_hook_copy(Path(raw_tmp) / "routing-gate-pristine.sh")
        pristine_function = load_bash_write_targets(pristine)
        fixed_function = load_bash_write_targets(HOOK)
        fixed_exceptions: list[dict[str, Any]] = []
        superset_violations: list[dict[str, Any]] = []
        added_target_cases = 0
        for index, command in enumerate(generated_commands(count, seed)):
            pristine_result = _evaluate(pristine_function, command)
            fixed_result = _evaluate(fixed_function, command)
            if "exception" in fixed_result:
                fixed_exceptions.append(
                    {"index": index, "command": command, "fixed": fixed_result}
                )
                continue
            pristine_targets = pristine_result.get("targets")
            if pristine_targets is None:
                continue
            fixed_targets = fixed_result["targets"]
            if not set(fixed_targets).issuperset(pristine_targets):
                superset_violations.append(
                    {
                        "index": index,
                        "command": command,
                        "pristine": pristine_result,
                        "fixed": fixed_result,
                    }
                )
            elif set(fixed_targets) > set(pristine_targets):
                added_target_cases += 1
        return {
            "command_count": count,
            "seed": seed,
            "fixed_exception_count": len(fixed_exceptions),
            "superset_violation_count": len(superset_violations),
            "added_target_cases": added_target_cases,
            "fixed_exceptions": fixed_exceptions[:20],
            "superset_violations": superset_violations[:20],
        }


class DifferentialFuzzScaffoldTest(unittest.TestCase):
    def test_neutral_pristine_vs_pristine_10k_has_zero_diffs(self) -> None:
        report = pristine_vs_pristine()
        self.assertEqual(report["command_count"], 10_000)
        self.assertEqual(report["diff_count"], 0, report["diffs"])

    def test_neutral_pristine_vs_fixed_10k_is_exception_free_target_superset(self) -> None:
        report = pristine_vs_fixed()
        self.assertEqual(report["command_count"], 10_000)
        self.assertEqual(report["fixed_exception_count"], 0, report["fixed_exceptions"])
        self.assertEqual(report["superset_violation_count"], 0, report["superset_violations"])
        self.assertGreater(report["added_target_cases"], 0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--left", type=Path)
    parser.add_argument("--right", type=Path)
    parser.add_argument("--count", type=int, default=10_000)
    args = parser.parse_args()
    if bool(args.left) != bool(args.right):
        parser.error("--left and --right must be supplied together")
    report = (
        compare_hooks(args.left, args.right, count=args.count)
        if args.left and args.right
        else pristine_vs_pristine(args.count)
    )
    print(json.dumps(report, indent=2, sort_keys=True))
