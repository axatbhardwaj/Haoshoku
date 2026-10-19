## Opt-in Executor server

```bash
haoshoku --server-executor https://axat-vps.tail140c22.ts.net
```

Run this command as root on Debian with Docker, Docker Compose v2 and `ss`
already available. Executor is never provisioned by default Arch or Debian
setup. Supply an explicit HTTPS origin (host and optional port, optionally a
trailing `/`). Credentials, other paths, queries and fragments are rejected.
The origin is omitted from Haoshoku run logs; no credentials are requested or
written by this installer.

The default is a tailnet-only HTTPS origin via operator-managed Tailscale Serve:
`https://axat-vps.<tailnet>.ts.net` (fleet: `https://axat-vps.tail140c22.ts.net`).
Forward it to `127.0.0.1:4788`, including `/api`, `/mcp` and `/.well-known`;
run setup and clients with tailnet access. Public reachability is not required.
Only OAuth providers that fetch callbacks or client metadata
server-side need temporary public exposure via operator-managed Funnel; arrange
that exception for their flow and restore tailnet-only access afterwards.
Haoshoku never changes nginx, DNS, TLS, firewall rules, Tailscale Serve/Funnel or
OAuth client credentials. The hand-edited VPS compose remains operator-managed:
a rerun refuses a differing compose rather than undoing the move to Serve.

A fresh deployment pulls `ghcr.io/usefulsoftwareco/executor-selfhost:latest`,
resolves its digest, checks the image's `65532:65532` runtime user and `/data`
volume, and pins that digest in `/srv/executor/docker-compose.yml`. The only
published port is `127.0.0.1:4788:4788`. `EXECUTOR_WEB_BASE_URL` supplies the
explicit HTTPS origin. Haoshoku creates a private empty `data/` directory and
changes ownership of that directory once; it never recursively changes data
ownership. Upstream persists its database and generated encryption/session keys
there. `haoshoku-executor.json` records the managed format and pulled digest.

An existing manually configured deployment, differing compose file, unknown
path, symlink, partial deployment, incompatible data ownership or conflicting
container/port stops before pulling or starting anything. Existing files remain
intact. Inspect and manage such deployments manually; there is no force,
automatic adoption, migration, cleanup or upgrade path. A matching managed rerun
checks the running `executor-selfhost` container and application without pulling,
recreating, restarting, updating or rewriting it. Supported managed data files
are `data.db` (plus SQLite `-wal`/`-shm` files), `secret.key` and `auth-secret.key`;
additional files require manual inspection.

Readiness checks require `/api/health` JSON with `status: "ok"` and Executor's
OAuth authorization-server metadata advertising the configured origin and
`/api/auth/mcp` endpoints, on both loopback and the configured HTTPS origin. Each
request, including its body, has a five-second deadline and a 16 KiB limit;
verification makes at most five attempts, with one second between failed attempts
(at most four retries). Redirects, proxy HTML, generic error
responses and wrong metadata fail. A failed step exits nonzero and preserves
partial state for manual inspection; rerunning never tries destructive repair.

“Container ready” does not prove owner onboarding, an authenticated MCP
handshake or healthy integrations. Complete first-owner signup yourself in the
tailnet web UI, then configure authentication, policies and integrations there.
Haoshoku does not create owners, API keys, policies or OAuth connections.
