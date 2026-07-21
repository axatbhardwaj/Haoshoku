"""CH3 writer-verb grammar and union-only detection tests."""

from __future__ import annotations

import unittest

from tests.harness import load_bash_write_targets


class WriterVerbGrammarTests(unittest.TestCase):
    def setUp(self) -> None:
        self.parse = load_bash_write_targets()

    def test_neutral_cp_and_mv_target_directory_or_last_operand(self) -> None:
        cases = {
            "cp source /home/fuzz/destination": ["/home/fuzz/destination"],
            "cp -t /home/fuzz/directory source": ["/home/fuzz/directory"],
            "cp --target-directory=/home/fuzz/directory source": ["/home/fuzz/directory"],
            "mv -S .bak source /home/fuzz/destination": ["/home/fuzz/destination"],
            "mv --suffix=.bak source /home/fuzz/destination": ["/home/fuzz/destination"],
            "cp only-source": [],
            "mv --unknown source /home/fuzz/destination": [],
        }
        for command, expected in cases.items():
            with self.subTest(command=command):
                self.assertEqual(self.parse(command), expected)

    def test_neutral_install_consumes_known_flag_arguments(self) -> None:
        cases = {
            "install -m 755 -o root source /home/fuzz/installed": ["/home/fuzz/installed"],
            "install --mode=755 --group staff source /home/fuzz/installed": ["/home/fuzz/installed"],
            "install -t /home/fuzz/directory -m 755 source": ["/home/fuzz/directory"],
            "install only-source": [],
            "install --unknown source /home/fuzz/installed": [],
        }
        for command, expected in cases.items():
            with self.subTest(command=command):
                self.assertEqual(self.parse(command), expected)

    def test_neutral_tee_returns_all_operands_after_argless_flags(self) -> None:
        self.assertEqual(
            self.parse("tee -a -i /home/fuzz/one '/home/fuzz/two files'"),
            ["/home/fuzz/one", "/home/fuzz/two files"],
        )
        self.assertEqual(self.parse("tee --unknown /home/fuzz/one"), [])

    def test_neutral_dd_returns_only_of_operands(self) -> None:
        self.assertEqual(
            self.parse("dd if=/dev/zero of=/home/fuzz/one bs=1 of='/home/fuzz/two files'"),
            ["/home/fuzz/one", "/home/fuzz/two files"],
        )
        self.assertEqual(self.parse("dd if=/dev/zero bs=1"), [])

    def test_neutral_rm_returns_all_operands_and_honors_double_dash(self) -> None:
        self.assertEqual(
            self.parse("rm -rf -- /home/fuzz/one '/home/fuzz/two files'"),
            ["/home/fuzz/one", "/home/fuzz/two files"],
        )
        self.assertEqual(self.parse("rm --unknown /home/fuzz/one"), [])

    def test_neutral_sed_requires_in_place_and_distinguishes_script_from_files(self) -> None:
        cases = {
            "sed -i 's/a/b/' /home/fuzz/one /home/fuzz/two": ["/home/fuzz/one", "/home/fuzz/two"],
            "sed -i.bak -e 's/a/b/' /home/fuzz/one": ["/home/fuzz/one"],
            "sed --in-place=.bak --file script.sed /home/fuzz/one": ["/home/fuzz/one"],
            "sed 's/a/b/' /home/fuzz/one": [],
            "sed -i /home/fuzz/one": [],
            "sed -i --unknown 's/a/b/' /home/fuzz/one": [],
        }
        for command, expected in cases.items():
            with self.subTest(command=command):
                self.assertEqual(self.parse(command), expected)

    def test_neutral_segments_are_quote_aware_and_assignments_bail_per_segment(self) -> None:
        self.assertEqual(
            self.parse("cp source '/home/fuzz/semi;colon'; rm /home/fuzz/removed"),
            ["/home/fuzz/semi;colon", "/home/fuzz/removed"],
        )
        self.assertEqual(
            self.parse("VAR=value cp source /home/fuzz/skipped; mv source /home/fuzz/moved"),
            ["/home/fuzz/moved"],
        )
        self.assertEqual(
            self.parse("cp source '/home/fuzz/quoted>destination'"),
            ["/home/fuzz/quoted>destination"],
        )

    def test_neutral_verb_targets_union_with_unchanged_redirections(self) -> None:
        self.assertEqual(
            self.parse("cp source /home/fuzz/copied > /home/fuzz/log"),
            ["/home/fuzz/log", "/home/fuzz/copied"],
        )


if __name__ == "__main__":
    unittest.main()
