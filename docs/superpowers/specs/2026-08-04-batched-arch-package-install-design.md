# Batched Arch Package Installation Design

## Problem

Haoshoku currently classifies and installs every Arch application one at a
time. This allows setup to continue after an individual failure, but it repeats
package-manager startup, dependency resolution, AUR metadata requests, build
menus, and sudo transitions for every target. A normal setup is therefore much
slower and noisier than necessary.

A single batch command is faster, but neither pacman nor an AUR helper provides
the exact desired contract of silently discarding every missing or broken
target while safely installing all remaining targets. Invalid targets can
prevent dependency resolution for a batch, and pacman transactions are atomic.

## Goals

- Use one repository batch and one AUR batch on the successful path.
- Preserve best-effort installation when either batch fails.
- Exclude missing packages before installation where metadata permits.
- Retry only targets that remain uninstalled after a failed batch.
- Keep repository and AUR failures independent.
- Clearly distinguish missing targets from targets that failed to install.
- Keep package-list input safe to interpolate into existing command strings.
- Preserve the full pacman refresh/upgrade preflight.

## Non-goals

- Making broken PKGBUILDs reliable.
- Guessing replacement package names or providers.
- Changing the package list, AUR helper preference, or gaming package flow.
- Editing pacman, mirror, AUR helper, or user environment configuration.
- Adding a new runtime dependency solely for AUR metadata lookup.

## Architecture

### Package-list preparation

The installer will parse non-empty, non-comment lines from
`common/paru_applist.txt`, preserve first-seen order, and discard duplicates.
Before any package name reaches a shell command, it must match Arch's practical
package-name character set: ASCII letters, digits, `@`, `.`, `_`, `+`, and `-`,
with at least one character. Invalid entries will be reported as malformed and
will not be queried or installed.

The installer will snapshot `pacman -Qq` once and skip exact package names that
are already installed. Existing `--needed` flags remain as defense for
provider/version cases that exact-name filtering cannot identify.

### Classification and validation

For each remaining valid name, the existing `pacman -Si <name>` boundary will
determine repository membership. Because the full Arch setup has already
completed `pacman -Syu`, this query operates against synchronized metadata.

Targets absent from configured pacman repositories are candidates for AUR
installation. When an AUR helper exists, Haoshoku will validate each candidate
with the selected helper's info operation in AUR-only mode. Missing candidates
will be recorded and excluded before the batch command. Metadata checks may be
performed concurrently with a conservative fixed limit, while output order and
final reporting retain package-list order.

When no AUR helper exists, all AUR candidates will be reported as unavailable;
Haoshoku will still install repository packages.

### Repository batch and fallback

All repository targets will first be passed to one command:

```text
sudo pacman -S --needed --noconfirm <repo targets...>
```

If it succeeds, no individual repository commands run. If it fails, Haoshoku
will snapshot installed packages again, remove targets now present, and retry
only the remaining repository targets individually using the same pacman
flags. This accommodates a transaction that produced useful work before an
external failure while avoiding redundant retries.

### AUR batch and fallback

All validated AUR targets will first be passed to one selected-helper command:

```text
<helper> -S --needed --noconfirm --batchinstall <AUR targets...>
```

If it succeeds, no individual AUR commands run. If it fails, Haoshoku will
snapshot installed packages again, remove targets now present, and retry only
the remaining targets individually without `--batchinstall`. A failure in this
phase does not alter the repository result.

### Results and reporting

The batching unit will return a structured result with ordered arrays:

- `installed`: requested targets confirmed installed or whose install command
  succeeded during this run;
- `failed`: valid, available targets whose batch and individual fallback did
  not produce a successful installation;
- `missing`: well-formed targets absent from both configured repositories and
  the AUR, plus AUR candidates that cannot be validated because no helper is
  available;
- `invalid`: malformed package-list entries rejected before command execution;
- `skipped`: targets already installed at the initial snapshot.

Logs will summarize counts and list `failed`, `missing`, and `invalid`
separately. A package must appear in exactly one terminal result category.

## Components and interfaces

The package workflow will be exposed as a dependency-injectable function in
`src/os_scripts/cachyos.js` so tests cannot invoke real package managers:

```text
installArchPackageBatch(packages, {
  aurHelper,
  packageInRepositoryImpl,
  packageInAurImpl,
  getInstalledPackagesImpl,
  runCommandImpl
}) -> Promise<{ installed, failed, missing, invalid, skipped }>
```

Small pure helpers may parse/deduplicate names and validate package-name syntax.
The existing `installSystemPackages` orchestration will read the file, obtain
sudo once, call the batching unit, log its summary, and then continue to Nerd
Fonts and the optional gaming prompt as it does today.

## Error handling

- Empty repository or AUR groups do not execute empty install commands.
- A failed metadata query classifies only that target as non-repository or
  missing; it does not stop the other group.
- A failed installed-package snapshot is treated as an empty set, retaining
  current best-effort behavior and `--needed` protection.
- A failed batch triggers exactly one individual fallback pass for the targets
  still absent.
- An individual failure is recorded and setup continues.
- Missing and malformed targets are never passed to an install command.

## Testing

Tests will use injected metadata, installed-state, and command functions. They
will cover:

- stable deduplication and initial installed-package skipping;
- malformed name rejection without metadata or command calls;
- one successful repository batch and no individual repository commands;
- one successful AUR `--batchinstall` command and no individual AUR commands;
- missing AUR targets excluded from the batch and reported separately;
- no AUR helper while repository installation still proceeds;
- repository batch failure followed by retries of only still-absent targets;
- AUR batch failure followed by retries of only still-absent targets;
- partial fallback success and ordered final categories;
- independence between repository and AUR batch failures;
- empty groups producing no empty package-manager command.

The focused Arch tests, complete Bun suite, Biome lint, and `git diff --check`
will be run before completion.

## Documentation

The README will describe the batched fast path, missing-target filtering, and
individual fallback behavior under the Arch and Omarchy behavior section.

