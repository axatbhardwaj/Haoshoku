# Arch Package Database Preflight: Final Fixes Report

## Scope

Addressed both final-review findings without running pacman, rustup, curl
installers, or changing system/environment configuration.

## Root cause

`runCachyOSSetup()` already returned `false` when the package-manager preflight
failed, as required by the approved design. The `arch`/`cachyos` dispatch branch
in `haoshoku.js` awaited that result without inspecting it, then continued to
the skills-sync prompt. With no exception or explicit exit status, the CLI
exited successfully.

A controlled child-process reproduction mocked only the Arch setup module and
the prompt boundary. It observed all three symptoms together:

- `runCachyOSSetup()` returned `false`;
- the skills-sync prompt was still called;
- the child exited with status `0`.

## TDD evidence

### RED

Tests were changed before production code:

- added `tests/haoshoku_arch_failure.test.js`, which runs the real CLI dispatch
  in a child process, substitutes the system-mutating Arch setup entry point,
  and asserts setup invocation, no post-setup prompt, and exit status `1`;
- made incomplete Rust-toolchain coverage table-driven for both
  `rustc`-present/`cargo`-missing and `rustc`-missing/`cargo`-present;
- added the `false` result assertion for a failed rustup command.

Command:

```text
bun test tests/cachyos.test.js tests/haoshoku_arch_failure.test.js
```

Observed before the production fix:

```text
15 pass
1 fail
38 expect() calls
Expected output not to contain: "SKILL_SYNC_PROMPT_CALLED"
Received output containing both "ARCH_SETUP_CALLED" and
"SKILL_SYNC_PROMPT_CALLED"
exit code: 1 (test command)
```

The CLI regression failed for the intended missing caller-side gate. The three
new Rust cases passed immediately because they characterize behavior already
implemented by `ensureRustToolchain`; no production Rust change was needed.

### GREEN

Minimal production change: the `arch`/`cachyos` caller now checks the Boolean
result, sets `process.exitCode = 1`, and returns before post-setup work when the
result is false. `runCachyOSSetup()` still returns `false` and does not terminate
the process internally.

Command:

```text
bun test tests/cachyos.test.js tests/haoshoku_arch_failure.test.js
```

Observed after the production fix:

```text
16 pass
0 fail
39 expect() calls
Ran 16 tests across 2 files.
exit code: 0
```

## Final verification evidence

```text
bun test tests/cachyos.test.js tests/haoshoku_arch_failure.test.js
16 pass, 0 fail, 39 expect() calls; exit code 0

bun test
577 pass, 10 skip, 0 fail, 1815 expect() calls; exit code 0

bun run lint
Checked 96 files; no errors; exit code 0
10 warnings remain in unrelated pre-existing HTML runbooks.

git diff --check
no output; exit code 0
```

## Changed files

- `haoshoku.js` — honor a failed Arch setup result at the CLI dispatch boundary,
  stop post-setup work, and set a nonzero process exit status.
- `tests/haoshoku_arch_failure.test.js` — child-process CLI/dispatch regression
  test with the system-mutating setup boundary mocked.
- `tests/cachyos.test.js` — symmetric incomplete-toolchain table and rustup
  failure-result coverage.
- `.superpowers/sdd/2026-08-04-arch-package-database-preflight/final-fixes-report.md`
  — this evidence report.

## Safety and mutation checks

- Removing the new caller-side Boolean check makes the CLI regression observe
  the skills prompt and fail.
- Omitting `process.exitCode = 1` makes the child exit `0` and fail.
- Checking only `rustc` or only `cargo` is caught by one side of the table.
- Returning success after a failed rustup command is caught by the new failure
  test.
- No package manager, installer, or user configuration operation was executed;
  all command-oriented helper tests used injected functions, and the CLI child
  replaced `runCachyOSSetup()` before importing the CLI.
