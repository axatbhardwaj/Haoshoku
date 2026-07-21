"""Hash pins for source spans S3A is expected to touch deliberately.

``dispatch_failed`` delimitation is syntax-based: parse the embedded Python with
``ast``, start at its top-level ``def`` line, and end at the function node's
inclusive ``end_lineno``.  The redirection scanner is the exact inner span from
the indented ``targets = []`` line through the inclusive unterminated-quote
``raise``.  S3A may add verb extraction outside that inner span while both hash
pins remain unchanged; any edit to either pinned span is prohibited.
"""

from __future__ import annotations

from hashlib import sha256
from pathlib import Path
import unittest

from tests.harness import function_span, redirection_scanner_span


DISPATCH_FAILED_SHA256 = "20bfeff63369db83a96ed57602dccf2b7e72c3db0484d4535a61ae4221c4e9f6"
REDIRECTION_SCANNER_SHA256 = "de4e4471736510c2bae5daebee56fe0138beb2081254064610cc7d875d008dbd"
LIMITATIONS_ONE_TO_THREE_SHA256 = "50fe4677ebea4aa0114e6ed8f11a4aaa0882c6f07d65dda0870f7d752ec53af1"
HOOK = Path(__file__).resolve().parents[1] / "routing-gate.sh"
WONTFIX_TEXT = """**Not fixed, deliberately (2026-07-21; S3B dropped by human decision after two plan-review
rounds).** D1/D2 stand: the gate still cannot verify a stated carve-out or exemption, and the same
uncovered write re-blocks once per turn until genuinely covered. Every design that honored
statements or capped repeat blocks required the hook to trust a durable record that a block had
already occurred — and the only storage within a Stop hook's reach is writable by the same model
the gate watches. A strict-valid forged `{blocked, waived}` record would silence the tripwire
before it ever fired (S0-v2 finding R2-B2). We keep the noise rather than ship a quietable gate.
Also unfixed: in-transcript dispatches remain target-blind (a junk dispatch still discharges
everything — D5 residual); stops with work in flight still hard-block (any deferral that can repeat
is a standing bypass — R2-B3); receipts remain unauthenticated launcher files — per-target scoping
and the future-skew bound narrow forgery, they do not close it."""


class SourceInvariantHashes(unittest.TestCase):
    def test_neutral_dispatch_failed_exact_span_hash(self) -> None:
        actual = sha256(function_span("dispatch_failed").encode()).hexdigest()
        self.assertEqual(actual, DISPATCH_FAILED_SHA256)

    def test_neutral_redirection_scanner_exact_span_hash(self) -> None:
        actual = sha256(redirection_scanner_span().encode()).hexdigest()
        self.assertEqual(actual, REDIRECTION_SCANNER_SHA256)

    def test_neutral_ch7_header_contract(self) -> None:
        """neutral: CH7 preserves #1-#3 and records every mandated residual verbatim."""
        source = HOOK.read_text(encoding="utf-8")
        limitations_start = source.index("# 1. Narrative text")
        limitations_end = source.index(
            "#    The design deliberately over-blocks on any doubt rather than risk under-blocking."
        ) + len(
            "#    The design deliberately over-blocks on any doubt rather than risk under-blocking.\n#\n"
        )
        preserved = source[limitations_start:limitations_end]
        self.assertEqual(sha256(preserved.encode()).hexdigest(), LIMITATIONS_ONE_TO_THREE_SHA256)
        self.assertIn("receipts are now scoped per target", source)
        self.assertIn("in-transcript dispatches remain target-blind", source)
        self.assertIn("suspected-staleness signal", source)
        self.assertIn("stop_hook_active passes the next stop", source)
        self.assertIn("final torn transcript tail", source)
        self.assertIn("interior transcript corruption still fails open", source)
        self.assertIn("~/.claude/** is deliberately not exempt", source)
        self.assertIn("the hook mirrors policy", source)

        wontfix_lines = []
        collecting = False
        for line in source.splitlines():
            if line.startswith("# **Not fixed, deliberately"):
                collecting = True
            if collecting:
                if not line.startswith("# "):
                    break
                wontfix_lines.append(line[2:])
        self.assertEqual("\n".join(wontfix_lines), WONTFIX_TEXT)


if __name__ == "__main__":
    unittest.main()
