# Arch Package Database Preflight Design

## Problem

The Arch setup currently installs `base-devel` and `git` before ensuring that
pacman's repository databases are usable. When the `core`, `extra`, `multilib`,
and Omarchy databases are absent, that install fails, but Haoshoku continues.
Later, `pacman -Si` cannot recognize repository packages, so Haoshoku sends
ordinary packages such as Chromium to an AUR helper. The helper then attempts
to satisfy repository dependencies through AUR providers, producing large,
incorrect dependency trees and interactive provider prompts.

The setup also invokes rustup even when a working system Rust installation is
already present, causing avoidable duplicate-installation warnings.

## Goals

- Establish valid, current pacman repository metadata before any Arch package
  classification or installation.
- Avoid Arch partial upgrades.
- Stop safely when the package-manager preflight or essential build tools fail.
- Preserve an existing usable Rust toolchain.
- Keep repository-versus-AUR routing unchanged once the preflight succeeds.
- Make no direct changes to pacman configuration, mirrors, or user environment.

## Design

### Package-manager preflight

At the beginning of the full Arch setup, Haoshoku will run:

```text
sudo pacman -Syu --noconfirm
```

This performs a database refresh and full system upgrade together, following
Arch's requirement to avoid partial upgrades. It will run before installing
`base-devel`, querying `pacman -Si`, resolving an AUR helper, or installing any
other development tool.

The preflight will be an exported, dependency-injectable function so its
control flow can be tested without executing pacman. It returns success only
when both the full upgrade and the subsequent essential dependency install
succeed.

### Failure behavior

If `pacman -Syu` fails, Haoshoku will log a clear error and abort the Arch setup.
It will not continue into Rust, AUR helper, application, Flatpak, or
configuration work.

After a successful upgrade, Haoshoku will install `base-devel` and `git`. These
are essential for `makepkg` and AUR helper bootstrapping, so failure at this
stage will also abort the Arch setup instead of being downgraded to a warning.

The setup function will return a failure result rather than terminating the
process internally. This keeps the function testable and avoids hiding control
flow behind `process.exit`.

### Existing Rust detection

Rust installation will be separated from the package-manager preflight. When
both `rustc` and `cargo` are available, Haoshoku will report that Rust is
already installed and skip rustup. If either command is absent, the existing
rustup installation command will run.

### Package routing

After the preflight succeeds, the existing `pacman -Si <package>` check remains
the authority for repository membership. Repository packages use pacman; only
packages absent from synchronized repositories use the selected AUR helper.
No fallback will reinterpret every package as AUR when repository metadata is
unavailable, because preflight failure stops the setup first.

## Testing

Regression tests will use injected command and command-existence functions to
verify:

- the preflight runs `pacman -Syu` before installing essential dependencies;
- failed synchronization prevents the dependency install;
- failed essential dependency installation reports failure;
- the full setup performs no later work after a failed preflight;
- existing `rustc` and `cargo` skip rustup;
- a missing Rust command invokes the existing rustup command.

The focused Arch tests and then the complete Bun test suite will be run. Lint
will also be run to catch formatting and static issues.

## Documentation

The README's Arch behavior section will state that a full pacman refresh and
upgrade occurs before package installation and that setup aborts if this
preflight fails.

## Non-goals

- Editing `/etc/pacman.conf`, mirror lists, keyrings, or files under
  `/var/lib/pacman`.
- Running `pacman -Syyu` unconditionally.
- Repairing broken mirrors or repository configuration automatically.
- Changing the contents of Haoshoku's application lists.
- Changing AUR helper preference or package routing after a successful
  preflight.
