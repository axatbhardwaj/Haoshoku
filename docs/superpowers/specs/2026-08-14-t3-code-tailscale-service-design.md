# T3 Code Tailscale Service Design

## Status

Approved in conversation on 2026-08-14.

## Context

Haoshoku v8.5.2 installs T3 Code's upstream Linux background service during
Debian setup and through `haoshoku --server-t3-code`. The service listens on
loopback, so the existing `npx t3@latest pair` guidance produces a URL that is
not reachable from another device.

This design extends that setup with durable, private Tailscale access. It
supersedes only the earlier T3 integration design's prohibitions on automatic
Tailscale setup and automatic pairing. T3 remains loopback-only, and Haoshoku
still must not expose port 3773 publicly or add firewall rules for it.

## Goals

- Make Tailscale a required part of every Debian T3 server setup.
- Keep both Tailscale and T3 Code running across crashes, logout, and reboot.
- Finish setup with a private HTTPS Tailscale Serve endpoint and a fresh pairing
  credential.
- Make failures explicit and provide a concrete retry command.
- Support both root and ordinary sudo-capable operators.

## Non-goals

- Do not bind T3 Code to `0.0.0.0`, a public address, or the Tailnet IP.
- Do not open port 3773 in UFW or another firewall.
- Do not create or replace vendor systemd units.
- Do not configure Tailscale Funnel, exit nodes, subnet routing, SSH, ACLs,
  tags, or auth keys.
- Do not store, parse, repeat, or log pairing tokens in Haoshoku.
- Do not disable Tailscale key expiry automatically.

## Selected Approach

Use the system-level `tailscaled.service` shipped by Tailscale and the user-level
service installed by `npx t3@latest service install`. T3 continues listening on
`127.0.0.1:3773`. `npx t3@latest pair --tailscale` configures Tailscale Serve to
proxy a private Tailnet HTTPS endpoint to that loopback backend and prints the
one-time pairing output directly.

This avoids a startup dependency between T3 and a Tailnet IP. Tailscale and T3
can restart independently; the endpoint becomes reachable again when both are
healthy.

## Setup Flow

`configureT3CodeServer()` remains the single entry point used by both
`--server-t3-code` and the normal Debian setup. It performs these stages in
order:

1. Ensure Node.js satisfies T3's current engine range.
2. Install T3 Code's upstream background service.
3. Verify the T3 Code service.
4. Detect whether the `tailscale` CLI is present.
5. If it is missing, run Tailscale's official Linux installer:
   `curl -fsSL https://tailscale.com/install.sh | sh`.
6. Enable and start the vendor daemon with
   `systemctl enable --now tailscaled` as root or
   `sudo systemctl enable --now tailscaled` otherwise.
7. Verify the daemon is boot-enabled with `systemctl is-enabled tailscaled` and
   currently running with `systemctl is-active tailscaled`, using the same
   root-aware privilege prefix.
8. Inspect Tailnet connectivity. If the node is not connected, run
   `tailscale up` as root or `sudo tailscale up` otherwise, then re-check
   connectivity. The command's login URL and authentication interaction remain
   attached to the terminal. The connectivity probe parses
   `tailscale status --json` and accepts only `BackendState: "Running"`.
9. When Haoshoku is running as a non-root user, resolve and validate that
   account's Unix username, then run
   `sudo tailscale set --operator=<username>`. This lets the same account that
   owns the T3 user service configure and inspect Tailscale Serve without
   running T3 itself as root. Skip this step when the T3 service belongs to
   root.
10. Run `npx --yes t3@latest pair --tailscale` without capturing or rewriting
   its output.
11. Verify the persistent private proxy with `tailscale serve status`.
12. Print a success message and remind unattended VPS operators to disable key
    expiry for this device or enroll it with an appropriately tagged server auth
    key in their Tailnet administration policy.

The official Tailscale unit already uses `Restart=on-failure` and is installed
for `multi-user.target`; Haoshoku must not add a custom restart override. The T3
service installer owns its systemd user-unit lifecycle, including boot and
post-logout persistence, so Haoshoku continues to use the upstream lifecycle
instead of generating another unit.

## Component Boundaries

### Node runtime preparation

Retain `ensureT3NodeRuntime()` unchanged. Tailscale setup starts only after the
T3 service is installed and verified.

### Tailscale preparation

Add a focused, dependency-injectable helper in
`src/helpers/configure_t3_code_server.js` that:

- checks command availability;
- selects root-aware systemctl commands;
- installs Tailscale when necessary;
- enables, starts, and verifies `tailscaled.service`;
- checks Tailnet connection state and drives `tailscale up` only when needed;
- grants a validated non-root service owner Tailscale operator access;
- returns a boolean and logs no credentials.

Command execution and connection probing must be injectable so tests never
modify the host's Tailscale state.

### Pairing and Serve verification

`configureT3CodeServer()` calls the Tailscale helper after T3 service
verification, then invokes upstream pairing and Serve-status commands. It
returns `false` on any failure and `true` only after both persistent services
and the private endpoint have been verified.

## Failure Behavior

- A Node or T3 service failure stops before any Tailscale mutation.
- A Tailscale installation failure stops before systemd commands.
- A systemd enable/start or verification failure stops before authentication.
- A failed or incomplete `tailscale up` is detected by the post-login
  connectivity check and stops before pairing.
- Failure to resolve a safe non-root username or grant operator access stops
  before pairing.
- A pairing failure reports
  `npx --yes t3@latest pair --tailscale` as the retry command.
- A Serve verification failure reports `tailscale serve status` as the retry
  command.
- The standalone CLI exits nonzero through the existing boolean result path.
- The full Debian setup completes its remaining portable configuration but
  returns failure at the end through its existing T3 failure path.

No failure path may fall back to a public bind or modify firewall policy.

## Testing

Extend `tests/configure_t3_code_server.test.js` using injected probes and
command runners. Tests must cover:

- an existing, connected Tailscale installation;
- installation when the CLI is missing;
- root and non-root systemctl command selection;
- validated non-root Tailscale operator setup and the root-owned skip path;
- boot-enabled and active service verification;
- disconnected nodes running `tailscale up` exactly once;
- post-login connectivity failure;
- installation, systemd, pairing, and Serve-status failures stopping at the
  correct boundary;
- successful command order ending in `pair --tailscale` and Serve verification;
- removal of the old manual `npx t3@latest pair` guidance.

Existing CLI and Debian reachability tests continue proving that the standalone
flag and normal Debian setup share this helper.

## Documentation

Update the README, changelog, helper index, and develop-feature progress
artifact to describe:

- mandatory Tailscale installation and authentication;
- persistent `tailscaled` and T3 services;
- private HTTPS pairing through Tailscale Serve;
- the same behavior in standalone and full Debian setup;
- the key-expiry/tagged-auth-key reminder;
- the absence of public port or firewall changes.

## Acceptance Criteria

- `haoshoku --server-t3-code` and full Debian setup run the same durable
  Tailscale/T3 flow.
- `tailscaled.service` is enabled and active before pairing.
- T3 remains bound to loopback and port 3773 is not opened publicly.
- Successful setup prints upstream Tailscale pairing output and verifies Serve.
- Failed setup returns nonzero at the documented boundary.
- Focused tests, the full Bun suite, scoped Biome checks, `git diff --check`, and
  `npm pack --dry-run` pass from the isolated worktree.
