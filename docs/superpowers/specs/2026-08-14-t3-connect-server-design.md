# T3 Connect Server Setup Design

## Status

Approved in conversation on 2026-08-14.

## Context

Haoshoku v8.5.3 configures Debian T3 Code servers through Tailscale. It installs
and authenticates Tailscale, enables its system service, creates a Tailscale
Serve endpoint, and runs `t3 pair --tailscale`.

The deployed VPS demonstrated two problems with that default. A pre-existing
Nginx wildcard listener on port 443 intercepted the Tailnet address and served
an unrelated public-domain certificate, and the T3 Code phone app required the
phone to remain connected to Tailscale. The same server was then successfully
linked through T3 Connect: the environment link became provisioned, T3's
managed Cloudflare relay client started, the phone connected without
Tailscale, and the obsolete Serve configuration was removed.

This design replaces the v8.5.3 Tailscale setup with T3 Connect. It supersedes
the T3 Code Tailscale Service Design while preserving T3's upstream service,
loopback listener, Node.js compatibility gate, and Debian-only CLI entry point.

## Goals

- Make T3 Connect the only remote-access setup performed by
  `haoshoku --server-t3-code` and the normal Debian Server flow.
- Keep T3 bound to `127.0.0.1:3773` and avoid public Nginx, DNS, or firewall
  changes.
- Run headless T3 Connect authorization interactively in the invoking terminal.
- Restart the persistent upstream T3 service after a new link so it provisions
  the environment and launches its managed relay client.
- Verify persisted link and relay state through T3's JSON status output.
- Make repeated Haoshoku runs idempotent for already-provisioned environments.
- Preserve the current-user ownership model, including intentional root-owned
  T3 installations.

## Non-goals

- Do not install, authenticate, configure, stop, or uninstall Tailscale.
- Do not remove an existing Tailscale Serve handler automatically.
- Do not create a public `t3` Nginx virtual host or certificate.
- Do not bind T3 to a public address or open port 3773.
- Do not manage the Cloudflare relay client directly; T3 owns its download,
  verification, installation, process lifecycle, and updates.
- Do not capture, persist, repeat, or log T3 authorization codes in Haoshoku.
- Do not change whether agent activity publishing is enabled.
- Do not replace T3's upstream systemd user unit with a Haoshoku-owned unit.

## Selected Approach

Retain `configureT3CodeServer()` as the single entry point shared by the
standalone flag and the full Debian setup. Replace its Tailscale phase with a
focused T3 Connect phase that calls only upstream T3 CLI commands.

T3 v0.0.33 provides `connect status --json` with machine-readable fields for
the desired exposure state, stored authorization, environment link, relay URL,
activity-publishing preference, and relay-client availability. Haoshoku will
parse only the minimum fields required for readiness and will not retain user
or environment identifiers.

## Setup Flow

The helper performs these stages in order:

1. Ensure Node.js satisfies T3's supported runtime range.
2. Run `npx --yes t3@latest service install`.
3. Run `npx --yes t3@latest service status`.
4. Read `npx --yes t3@latest connect status --json`.
5. If Connect is already desired, authenticated, linked, has a non-empty relay
   URL, and reports an available relay client, skip authorization and report
   the existing setup as ready.
6. If Connect is desired and authenticated and the relay client is available,
   but the environment link is still pending, preserve the stored
   authorization and continue directly to service restart and polling.
7. For every other state, run
   `npx --yes t3@latest connect link --headless` with inherited terminal I/O.
   T3 owns relay-client installation and the browser/code authorization
   exchange.
8. Run `npx --yes t3@latest service update` so the installed service uses the
   current upstream-managed runtime.
9. Run `systemctl --user restart t3code.service` as the invoking user. This is
   intentionally root's user manager when Haoshoku itself runs as root.
10. Poll `connect status --json` for up to 60 seconds until the readiness fields
   from step 5 are satisfied.
11. Run `npx --yes t3@latest service status` again to verify the persistent
    service after provisioning.
12. Print a success message directing the operator to sign into T3 Connect in
    the phone app with the same account.

An already-ready environment performs only the Node gate, service install and
status checks, and JSON readiness probe. It does not reauthorize, restart the
service, or disturb the running tunnel.

## Component Boundaries

### Node and service preparation

Keep `ensureT3NodeRuntime()` and the upstream service install/status lifecycle
unchanged. T3 Connect setup begins only after the service is healthy.

### Connect status probe

Add a dependency-injectable probe that runs the JSON status command, parses its
stdout, and returns a small internal readiness result. It rejects malformed
JSON, non-object roots, missing boolean fields, missing relay URLs, and relay
clients whose status is not `available`.

The production probe may capture only the JSON status command. Interactive
authorization continues through the existing attached command runner so codes
and prompts are never stored by Haoshoku.

### Authorization and provisioning

Add a focused function that accepts injected command execution, status probes,
wait scheduling, and logging. This makes command order, polling, timeouts, and
failure boundaries deterministic in tests without contacting T3 Connect or
restarting the developer's user service.

## Failure Behavior

- A Node or T3 service installation failure stops before Connect inspection.
- An unreadable initial JSON status is treated as not ready and proceeds to the
  explicit link flow; the later verification must still parse successfully.
- A failed or cancelled `connect link --headless` reports that exact retry
  command and stops before service restart.
- A failed service update or user-service restart reports the exact failed
  command and stops before polling.
- A malformed status during polling remains unready; polling continues until a
  later valid ready response or the deadline.
- A provisioning timeout reports `npx --yes t3@latest connect status` as the
  diagnostic command and returns failure.
- A final service-status failure returns failure even if the persisted Connect
  link is ready.
- The standalone CLI retains its existing nonzero exit behavior. Full Debian
  setup retains its existing behavior of completing unrelated portable setup
  and reporting the T3 failure at the end.

No failure path falls back to Tailscale, public exposure, or a direct T3 bind.

## Legacy Tailscale State

Haoshoku will not automatically run `tailscale serve --https=443 off`. Existing
operators may use Tailscale Serve for unrelated routes, and the command returns
an error when no matching handler exists.

After a newly linked T3 Connect environment succeeds, documentation may tell
v8.5.3 upgraders to first inspect `tailscale serve status` and remove the old
443 handler only when it is present. A fresh setup does not mention or require
Tailscale.

## Testing

Use test-driven development in `tests/configure_t3_code_server.test.js` with
injected runners and probes. Cover:

- parsing ready, pending, malformed, and structurally invalid JSON status;
- idempotently skipping link, update, restart, and polling when already ready;
- preserving stored authorization while restarting a pending environment;
- successful command order for authorization, update, restart, polling, and
  final service verification;
- readiness appearing after one or more pending polls;
- cancellation or failure at link, update, restart, timeout, and final service
  verification boundaries;
- removal of every Tailscale install, daemon, authentication, pairing, Serve,
  username-validation, and key-expiry behavior from the helper and tests;
- unchanged standalone CLI and full Debian reachability through their shared
  `configureT3CodeServer()` entry point.

Static documentation assertions must prevent the README and help text from
regressing to Tailscale as the Debian T3 default.

## Documentation and Progress Artifact

Update the README, changelog, helper index, and develop-feature HTML progress
artifact to describe:

- headless T3 Connect authorization;
- the upstream-managed service and relay client;
- idempotent reruns;
- root-owned operation when Haoshoku is intentionally run as root;
- no phone-side Tailscale requirement;
- no public port, Nginx, DNS, or firewall changes;
- conditional manual cleanup guidance for legacy v8.5.3 Serve handlers.

## Acceptance Criteria

- Both Debian entry points use T3 Connect and execute no Tailscale command.
- Fresh setup authorizes headlessly, restarts the upstream service, and waits
  for a provisioned link and relay.
- An already-ready setup does not relink or restart.
- T3 remains loopback-only and no firewall, DNS, or Nginx behavior changes.
- Failure boundaries return false and provide concrete, non-secret retry or
  diagnostic commands.
- Focused tests, the full Bun suite, scoped Biome checks, `git diff --check`,
  and `npm pack --dry-run` pass from the isolated worktree.
