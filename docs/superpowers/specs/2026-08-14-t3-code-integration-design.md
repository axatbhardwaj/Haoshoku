# T3 Code Desktop and Headless Server Integration Design

## Problem

Haoshoku does not currently install T3 Code on the Arch/Omarchy desktop path
or configure its headless server on Debian Server. The two operating-system
paths need different integrations:

- Arch/Omarchy should install the packaged desktop application from the AUR.
- Debian Server should install T3 Code's upstream-managed headless service,
  without adding a desktop package or exposing the service publicly.

The Debian operation must also be available as an explicit one-shot Haoshoku
mode so it can be rerun or repaired without executing the full server setup.

## Goals

- Add the current Arch desktop package, `t3code-bin`, to the existing
  `common/paru_applist.txt` pipeline.
- Add a Debian-only `haoshoku --server-t3-code` one-shot mode.
- Configure the same headless T3 Code service during the normal
  `haoshoku --os debian-server` flow.
- Use T3 Code's supported service manager rather than maintaining a custom
  systemd unit in Haoshoku.
- Ensure Node.js satisfies T3 Code's current runtime requirement before
  invoking the installer.
- Make reruns safe and provide actionable status and pairing guidance.
- Preserve the existing dirty checkout and unrelated desktop work.

## Non-goals

- Installing the T3 Code desktop application on Debian Server.
- Installing an AUR package outside the Arch/Omarchy path.
- Selecting or pinning a T3 Code release through a Haoshoku option.
- Configuring Tailscale, a reverse proxy, DNS, TLS, firewall ports, or public
  network access.
- Pairing a client automatically or storing pairing credentials.
- Replacing T3 Code's service lifecycle with a Haoshoku-owned systemd unit.

## Architecture

### Arch/Omarchy package

`common/paru_applist.txt` will gain one entry for `t3code-bin`. The existing
Arch package resolver will determine that it is an AUR target and install it
through the selected helper. No T3-specific Arch installer or service setup
will be added.

### Debian headless-server helper

A focused helper module will own the Debian T3 Code operation. Its public
function will accept injectable command and platform probes so tests never
install packages or services on the host.

The helper will:

1. Confirm the host belongs to the Debian family when invoked through the
   one-shot CLI mode.
2. Probe the active Node.js version.
3. Reuse the Debian Node installer when Node is missing or does not satisfy
   T3 Code's supported range.
4. Re-probe Node and stop with an actionable error if it remains incompatible.
5. Run `npx --yes t3@latest service install` as the current user.
6. Run `npx --yes t3@latest service status` to verify the installed service.
7. Report the pairing command without executing it automatically.

The pairing guidance will use `npx t3@latest pair` and recommend the
Tailscale-specific form only when the user has independently configured
Tailscale. Haoshoku will not bind T3 Code to a public interface or alter UFW.

### Compatible Node.js

The existing Debian Node installation step only checks whether `node` exists.
That is insufficient for a host carrying an older Node release. The Node
boundary will be refactored into an exported, dependency-injectable operation
that can ensure a compatible release for T3 Code while preserving the existing
full-setup behavior.

Compatibility checks will be explicit and covered by literal version
fixtures. The implementation will support T3 Code's current engine contract,
`^22.16 || ^23.11 || >=24.10`, without introducing a general-purpose semver
dependency. Unsupported major/minor combinations will not reach `npx`.

If installation or upgrade is required, the Debian path will install a
compatible Node 24 release through NodeSource. A failed installation or a
still-incompatible post-install probe is a hard failure for the one-shot mode.
During the full Debian setup, the T3 Code step will report the failure and the
overall setup will not claim that the service was configured.

### CLI routing

Commander will expose:

```text
haoshoku --server-t3-code
```

`serverT3Code` will be included in the complete mutually-exclusive mode-flag
registry. The one-shot route will reject Arch and unknown hosts before any
Node, npm, or systemd mutation. Debian and Ubuntu-family hosts will call the
headless-server helper directly and set a nonzero exit status on failure.

The normal Debian setup will call the same helper after its Node installation
step. This keeps the explicit flag and full setup on one implementation path.

## Error handling

- A non-Debian one-shot invocation fails before mutation and names the Debian
  requirement.
- Missing or incompatible Node triggers the compatible Debian Node installer.
- Failure to establish a compatible Node version prevents the T3 installer
  from running.
- A failed `service install` does not run `service status` and returns failure.
- A failed `service status` returns failure and prints the exact manual status
  command to retry.
- Pairing is never attempted as part of setup, so pairing tokens cannot leak
  into Haoshoku logs or test output.
- Repeated successful runs delegate idempotent repair/update behavior to T3
  Code's supported `service install` command.

## Testing

Red-green tests will cover behavior at the helper and CLI boundaries:

- supported Node 22, 23, and 24 fixtures;
- rejected old or too-early Node fixtures;
- compatible Node skips the installer and reaches T3 service installation;
- missing or incompatible Node runs the Debian Node installer and re-probes;
- a still-incompatible Node prevents T3 commands;
- successful service installation is followed by a status check;
- install failure skips status and returns failure;
- status failure returns failure with retry guidance;
- `--server-t3-code` appears in help and participates in mutual exclusion;
- the one-shot mode rejects a non-Debian host without mutations;
- the default Debian path invokes the same T3 helper in deliberate order.

The Arch manifest entry is data consumed by the already-tested package
pipeline. A source-text assertion that only checks for the new line would be a
change detector rather than a behavioral test, so it will receive format and
diff verification instead of a bespoke test.

Focused tests, the complete Bun suite, relevant Biome checks, and
`git diff --check` will run before completion.

## Documentation

The README will document the new Debian headless-server behavior, the
`--server-t3-code` one-shot command, Node compatibility, and manual pairing.
The changelog will record both the Arch desktop package and Debian server
integration.
