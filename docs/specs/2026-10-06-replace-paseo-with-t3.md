# Spec r5: Replace Paseo with T3 Code in Haoshoku

Status: APPROVED by user 2026-10-06 ("approve and release"); r5 amendment (PR6 installs the latest Axstack instead of a pin) requested by the user 2026-10-06 ("it should install the latest axstack not pin"). This issue is the authoritative specification.

## Outcome

Haoshoku no longer installs, configures, launches, or documents Paseo or its bundled model-routing policy. T3 Code takes Paseo's place: a nightly T3 Code service exposed over Tailscale on Debian servers, the T3 Code Nightly desktop app on Omarchy, and a T3-native Axstack release. Hermes stays on Debian servers as the Telegram transport for `hermes send`, without the Paseo review-relay plugin. When every PR is merged, Haoshoku releases v12.0.0.

## Accepted decisions

User decisions (T3 thread, 2026-10-06):
- D1 Paseo is no longer used. Remove it from Haoshoku.
- D2 Routing lives in the axstack repository. Remove Haoshoku's bundled routing skills and policy.
- D3 Keep Hermes on Debian. Remove only the Paseo review-relay plugin and what exists to support it.
- D4 Replace Paseo with T3 Code completely.
- D5 Remote access uses Tailscale (user: "we use tailsclae now").
- D6 Merge and release when everything is done.

Driver decisions (from host evidence and adviser review; approval of this spec confirms them):
- D7 T3 channel is nightly: Debian installs `t3@nightly`; Omarchy uses the packaged `t3-nightly`. Observed: `t3 --version` reports `0.0.46-nightly.20261003.2610` on the VPS and on the workstation (`t3-nightly` there reports `.20261004.2644`). Axstack 0.24.1's check requires `t3` ≥ `0.0.46-nightly.20261003.2610`; npm `t3@latest` is 0.0.45. Advisers had recommended keeping the Debian T3 step optional (default no); D4 overrides that, so the T3 step becomes required.
- D8 Install the latest T3-native Axstack from npm instead of a pinned release (user, r5). The current 0.8.0 pin is Orca-era (it does not touch Paseo), and Orca is retired.
- D9 Keep the `--server-hermes-relay` flag name and `configs/agent-profile/GEMINI.append.md` (Antigravity cost rule, not Paseo routing).
- D10 Repository-only change: no live-host mutation. Historical CHANGELOG entries, `docs/specs/`, `docs/plans/`, `docs/superpowers/` stay unchanged. Maintained docs (README, `docs/haoshoku.md`, `docs/runbooks/axstack-migration.md`, CLAUDE.md/AGENTS.md files) are updated by the PR that removes each feature.
- D16 T3 Connect is removed and existing Connect exposure is unlinked (driver inference from D5 and the VPS probe, where Connect is disabled).
- D17 The release waits for PR #103 to merge too, so v12.0.0 includes the settings backup (driver sequencing choice).
- D12 `IS_SANDBOX=1` is written to the T3 service only when setup runs as root (uid 0), matching the root VPS; non-root hosts do not get it.
- D13 SUPER+T launches or focuses T3 Code (it opened Paseo before).
- D14 Release version 12.0.0: removing CLI flags is a breaking change.
- D15 The `PROFILE.md` Hermes notification text is out of scope and stays unchanged.
- D11 Delivery: `gh stack` bottom-up from `stable`, each PR green alone; granular semantic commits of about 200 lines; each PR adds a CHANGELOG `Unreleased` entry.

## Verified starting point

- Base `stable` @ 9a0717193f5ddc6151f7b8a366e24db884d4664e (v11.15.0); full suite 1256 pass / 0 fail.
- VPS probes (run evidence `vps-probe-20261006.md`, first and second probe sections): Debian 13; `hermes-gateway.service` and `t3code.service` running; T3 service runs nightly with systemd drop-ins `axstack-path.conf` (PATH), `axstack-sandbox.conf` (`IS_SANDBOX=1`), `axstack-tailscale.conf` (`T3CODE_TAILSCALE_SERVE=true`); `tailscale serve` proxies the tailnet HTTPS URL to `127.0.0.1:3773`; T3 Connect exposure disabled. `paseo-review-relay` plugin present but not enabled.
- Axstack 0.24.1 is published only on npm: `https://registry.npmjs.org/axstack/-/axstack-0.24.1.tgz`, SHA-256 `c2e2ced6bb0dd600e0b59cf9e4cb7a93ee9b1e35e3d08739d589716d52e0b891` (matches npm integrity); layout `package/bin/axstack.js`; install/check CLI arguments unchanged. Tag v0.24.1 has no GitHub release.

## Stack

### PR1 — Hermes without Paseo
- `--server-hermes-relay` succeeds when: an existing usable Hermes is kept, or the pinned runtime (`configs/hermes-relay/hermes-runtime.json`) is installed if Hermes is absent; `$HERMES_HOME/config.yaml` exists; the Telegram bot token is configured; a private Telegram home channel resolves; the Hermes gateway reports running. No prompt, no gateway restart, no plugin writes.
- Remove plugin deployment/enable/validation, `configs/hermes-relay/lock.json`, the `paseo status` identity check, and the `~/.config/haoshoku/hermes-relay.json` marker writer/remover.
- Delete `tests/hermes_relay_publication_transition.test.js` and `tests/hermes_relay_host_boundary.test.js`; delete the `hermes-relay-host-enabled` checker script with them.
- Remove the instructions that tell agents to run the deleted checker from `model-routing/references/human-decisions.md`, `paseo-pr-review/SKILL.md`, `paseo-pr-babysit/SKILL.md`, and README.
- Debian server setup runs the Hermes step without waiting for Paseo profiles; Hermes failure fails setup.

### PR2 — Remove Paseo orchestration
- Remove `configure_paseo_profiles.js`, `configure_paseo_schedules.js`, `configure_paseo_tasks.js`, `paseo_schedule_client.js`, `configs/paseo/`, `@getpaseo/client` (package.json + bun.lock), and their tests.
- Remove flags `--paseo-profiles`, `--paseo-profiles-backup`, `--paseo-tasks`, `--paseo-schedules`, `--paseo-schedules-check`, `--paseo-schedules-apply`, `--paseo-tasks-enabled`, `--paseo-task-cleanup`, `--paseo-task-renaming` from haoshoku.js and cli_utils.js.
- Remove the profile-sync step from CachyOS default setup and Debian server setup (import, call, failure gate), and the `ensurePaseoTaskConfig` import and call in `configure_agent_skills.js`.
- Same PR: delete the profile-data case in `tests/workflow_routing_policy.test.js`, the task-config cases in `tests/configure_agent_skills.test.js`, and update default-run reachability/side-effect, CachyOS, Debian server, gh-stack, cli-utils, and help tests.

### PR3 — Remove bundled routing skills
- Delete `configs/agent-skills/{model-routing,paseo-pr-babysit,paseo-pr-review}`. Add the three names to `RETIRED_AGENT_SKILLS`; `AGENT_SKILLS` becomes empty, so remove its copy loop, `backupAgentSkills`, and `--agent-skills-backup`.
- Remove `REFERENCED_SKILLS` and its warning loop (every entry exists only for model-routing).
- Remove the `getpaseo/paseo` skills sync from `configure_skills.js`; `--skills` and `--skills-update` help name Matt Pocock skills only.
- Delete `tests/workflow_routing_policy.test.js`; move its PROFILE/AGENTS/CLAUDE alignment case to a surviving test file. Remove obsolete exceptions in `tests/retired_orchestration_boundary.test.js` without weakening its other checks.

### PR4 — T3 Code server over Tailscale
- Check first that Tailscale is logged in (`tailscale status` succeeds); otherwise fail with guidance. Haoshoku does not install or log in to Tailscale.
- Reuse a `t3` already on PATH when its version meets the Axstack floor; otherwise install the durable CLI with `npm --global --prefix ~/.local install t3@nightly`. The resulting `t3 --version` must meet the floor.
- Before service changes, read `t3 connect status --json`; if its `desired` state enables Connect, run `t3 connect unlink` and confirm `desired` is disabled; failure is incomplete setup.
- Before `t3 service install`, write `~/.config/systemd/user/t3code.service.d/` drop-ins: `axstack-path.conf` (`PATH=%h/.local/bin:%h/.bun/bin:/usr/local/bin:/usr/bin:/bin`), `axstack-tailscale.conf` (`T3CODE_TAILSCALE_SERVE=true`), and `axstack-sandbox.conf` (`IS_SANDBOX=1`, root only, D12). `service install` reloads, enables, and restarts the unit.
- Readiness: the service is active, `tailscale serve status` maps the tailnet HTTPS URL to `http://127.0.0.1:3773`, and that HTTPS URL responds within a bounded wait. Any failure returns false with guidance.
- Remove T3 Connect linking, authorization, and polling.
- Replace the README T3 Connect section with Tailscale prerequisites (logged in, tailnet HTTPS certificates enabled, `tailscale set --operator=$USER` for non-root) and pairing via `t3 pair --tailscale`; remove the `tailscale serve --https=443 off` advice. Update CLI help, its test, and `src/helpers/CLAUDE.md`.
- Debian server setup runs the T3 step as required (no prompt); T3 failure fails setup. `--server-t3-code` runs the same step.

### PR5 — Remove Paseo server and desktop integration
- Remove `configure_paseo_server.js`, `--server-paseo`, their tests, and the Debian setup step.
- Remove `paseo-bin` from `common/paru_applist.txt`.
- Omarchy workspaces (pc + laptop): remove the Paseo autostart; bind SUPER+T to `o.launch_sole("^com\\.t3tools\\.T3Code$", "t3code-nightly")`; `bindings.lua` unchanged. Remove the `paseo` recipe from `haoshoku-special-workspace`. Update workspace and special-workspace tests.
- README and maintained docs describe T3 Code instead of Paseo, with a migration note listing what existing hosts keep until removed manually: `paseo-daemon.service`, `~/.paseo`, the `@getpaseo/cli` install, upstream Paseo skills, `~/.hermes/plugins/paseo-review-relay` and its data, `~/.local/bin/hermes-relay`, and `~/.config/haoshoku/{hermes-relay,paseo-tasks,paseo-schedules}.json`.

### PR6 — Install the latest T3-native Axstack
- Resolve the latest Axstack from the npm registry (`axstack` package `latest` dist-tag: version, tarball URL, and `dist.integrity`). Download that tarball and verify it against the registry's `dist.integrity` (sha512) before extraction or shim creation; a mismatch or an unreachable registry fails without changing the installed shim. Remove the hard-coded version, URL, and SHA-256 pin. Keep existing reuse/unparsable-shim behaviour; an installed version equal to or newer than latest is kept. Tests mock the registry response.
- `--axstack-check` reports `roles.json` presence at `~/.claude/skills/axstack/roles.json` and `~/.agents/skills/axstack/roles.json` instead of `~/.paseo/config.json`; readback stays report-only, outside `ok`.
- In `configureAxstack`, before install on Omarchy: if no `t3` is on PATH and `/usr/bin/t3-nightly` exists, link `~/.local/bin/t3` to it; never replace an existing `~/.local/bin/t3`. README documents Axstack's Bun ≥ 1.3.14 and `t3` ≥ 0.0.46-nightly prerequisites.

### Release
After every PR and PR #103 are verified merged: from a clean `stable` checkout fast-forwarded to `origin/stable`, with exactly one `## Unreleased` CHANGELOG heading and no existing `v12.0.0` tag, run `bun run release --version=12.0.0 --yes` once (D14). It commits, tags, pushes, and creates the GitHub release; `publish-to-npm.yml` runs tests and publishes. Verify the workflow succeeded and npm reports `haoshoku@12.0.0`. If publishing fails, fix forward with 12.0.1; never move a tag. No host installation is requested. Tests mock every host probe (t3, t3-nightly, tailscale, systemctl, loginctl) so CI does not depend on host tools.

## Acceptance

- A1 `bun test` passes and `bun run lint` reports no errors at every stack head.
- A2 At the top of the stack, `rg -i paseo` over `src/`, `configs/`, `common/`, `haoshoku.js`, `package.json`, `bun.lock`, README, `docs/haoshoku.md`, `docs/runbooks/`, and maintained CLAUDE.md/AGENTS.md files returns only the migration note and `RETIRED_AGENT_SKILLS` entries. Under `tests/`, matches occur only in tests that assert removal.
- A3 A table test covers every removed flag (boolean and value-bearing): nonzero unknown-option exit and zero helper, process, or service calls.
- A4 Debian server setup (mocked): runs T3 and Hermes steps without prompting; T3 failure or Hermes failure returns false; at the top of the stack it never calls Paseo.
- A5 `--server-hermes-relay` (mocked): passes the PR1 success checks; keeps an existing Hermes; installs pinned Hermes only when absent; writes no plugin files, restarts no gateway, and calls no `paseo` executable.
- A6 T3 server step (mocked): reuses a `t3` that meets the floor and installs `t3@nightly` under `~/.local` only when `t3` is missing or too old; writes the drop-ins (sandbox only as root); requires Tailscale before changes; fails on stopped service, missing or wrong Serve mapping, or unreachable HTTPS URL; unlinks enabled Connect before the service restart and never links or authorizes Connect.
- A7 Agent-skill sync archives the live copies of `model-routing`, `paseo-pr-babysit`, `paseo-pr-review`, unlinks managed Claude/Codex links, and returns true.
- A8 Both workspace variants bind SUPER+T to the anchored T3 class pattern and have no Paseo autostart; primary-app behaviour and `bindings.lua` are unchanged.
- A9 `haoshoku --axstack` installs the npm `latest` Axstack, verified against the registry's `dist.integrity` (mocked in tests); `--axstack-check` reports both `roles.json` paths; the Omarchy `t3` link is created only when `t3` is absent.
- A10 `GEMINI.append.md`, the `PROFILE.md` Hermes notification text, and historical docs are unchanged.
- A11 Release: tag `v12.0.0`, GitHub release published, npm reports `haoshoku@12.0.0`.

## Exclusions

- No live-host mutation (daemons, `~/.paseo`, installed skills, Hermes plugins including `orca-status`, systemd units).
- No Tailscale installation or login automation; no T3 features beyond what Paseo provided.
- No Hermes changes beyond removing the plugin and its support code.
- No host installation of the released version.
- Rerunning T3 setup after the service self-updated past npm's nightly tag may fail; documented as a retry case, no code change.
