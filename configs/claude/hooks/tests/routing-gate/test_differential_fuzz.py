"""Expose the 10k differential-fuzz proof to stdlib unittest discovery."""

from tests.differential_fuzz import DifferentialFuzzScaffoldTest


__all__ = ["DifferentialFuzzScaffoldTest"]
