# Haoshoku

Multi-distro Linux setup and configuration toolkit (JavaScript/Bun).

## Planning and issue tracking

Use Linear only for repositories in the `defi-com` GitHub organization.
Keep specs for other repositories on GitHub. If the right GitHub location
(issue, PR, or repo file) is unclear, ask me before creating a planning
artifact. Do not create or update Linear items for those repositories.

## Files

| File            | What                              | When to read                                    |
| --------------- | --------------------------------- | ----------------------------------------------- |
| `haoshoku.js`   | CLI entry point, OS detection     | Modifying CLI args, adding new OS targets       |
| `package.json`  | Dependencies and npm scripts      | Adding deps, updating scripts                   |
| `README.md`     | User documentation, feature list  | Understanding features, installation options    |
| `CHANGELOG.md`  | Version history                   | Checking release notes                          |
| `info.txt`      | Theme names and resource links    | Reference for KDE theme components              |
| `bun.lock`      | Dependency lockfile (Bun)         | Checking exact dependency versions              |
| `bunfig.toml`   | Test preload that isolates HOME   | Debugging test isolation                        |
| `install.sh`    | No-Bun Linux binary installer     | Changing install locations or release downloads |
| `AGENTS.md`     | Codex copy of this file; keep both in sync | Editing repo guidance for either harness |
| `biome.json`    | Lint/format config and fixture excludes | Changing lint rules or excluded fixtures |
| `BRANCH-NOTES.md` | Dated log of branch outcomes and test counts | Checking what a past branch delivered |

## Subdirectories

| Directory   | What                              | When to read                                    |
| ----------- | --------------------------------- | ----------------------------------------------- |
| `src/`      | Core source code                  | Modifying setup logic, adding features          |
| `configs/`  | Template configs for deployment   | Adding/modifying terminal, app, or AI configs   |
| `common/`   | Package lists for OS setup        | Adding/removing packages to install             |
| `tests/`    | Test suite                        | Writing tests, debugging test failures          |
| `scripts/`  | Build and release scripts         | Modifying release process                       |
| `docs/`     | Additional documentation          | Understanding project details                   |
| `CHANGELOG/`| Archived changelog pages          | Checking older release notes                    |
| `README/`   | Split README topic pages (iobox, Executor, Debian, Omarchy) | Reading setup details linked from README.md |
| `.github/`  | CI, npm publish and Linux binary release workflows | Changing CI or release automation   |
| `deskback/` | Wallpaper assets                  | Adding wallpapers                               |
| `icons/`    | Icon assets                       | Adding icons                                    |
| `video/`    | Remotion project for the README intro animation | Regenerating `icons/haoshoku-readme.gif`       |

## Install

```bash
# Option 1: Run with Bun (Recommended)
bun install
bun haoshoku.js

# Option 2: Install via npm
npm install -g haoshoku
haoshoku
```

## Arch app setup

Supported setup retains T3, Debian Hermes, Claude/Codex, Axstack,
Git/gh/gh-stack, shared agent instructions and unrelated desktop/editor setup.
Future installers must not restore Matt Pocock skills, visual-explainer, Claude
Remote Control, stay-awake or PR watch, including the whole legacy agent-skills
route. Reruns do not uninstall existing copies. See the README for all eleven
retired CLI forms and current T3, tailnet SSH and opt-in Executor contracts.

The [current reconciliation notice](README.md#current-reconciliation-and-authority)
supersedes historical human-only merge/no-release gates. T1–T7 shipped in
12.3.0; the owning driver handles and verifies tag, npm and Linux binary
publication separately. Preserve dated specs, plans and approvals. Author
candidates stop locally; live-host changes remain deferred and separately authorized.

## Fleet and engineering workers

The fleet is io (PC), iobook (laptop), iobox (always-on T3 agent box), and
axat-vps (Debian Executor/Hermes VPS), plus planned iosatellite (Dell Inspiron
7570 Omarchy worker). iosatellite runs work locally, always awake, with a managed
lid-ignore policy; it remains unprovisioned until local setup and real closed-lid
AC job, SSH and T3 checks pass. Credentials, timers, peer sync and ACL deployment
are separate; existing four-host release verification stays mandatory, with
iosatellite added after provisioning. Fleet access uses Tailscale only. Agents may
SSH to any fleet host and act there; one compromised agent can reach all hosts.
See [iosatellite bring-up](README/iosatellite-profile.md) and [iobox bring-up](README.md#iobox-profile-and-fleet) for setup, CLIProxyAPI
subscriptions and `op`, and [Executor](README.md#opt-in-executor-server) for the default
tailnet-only origin and temporary Funnel OAuth exception.

## Test

Run `bun test` from the repository root; the `bunfig.toml` preload that isolates HOME for tests only applies there.

```bash
bun test
```

## Lint

```bash
bun run lint
bun run format
```
