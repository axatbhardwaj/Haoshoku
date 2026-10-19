## Opt-in Executor clients

For an ordinary agent user, run this standalone command after making the existing
Executor HTTPS MCP endpoint and its authentication available:

```bash
# Supply EXECUTOR_AUTHORIZATION securely in this process environment first.
haoshoku --executor-clients https://executor.example.net/mcp
```

`EXECUTOR_AUTHORIZATION` must contain the **complete** Authorization header value:
`Bearer ` followed by the API key/token accepted by that endpoint. Do not put the
secret in CLI arguments, a tracked file, or shell history. Missing, empty, raw-token,
and newline-bearing values are rejected without printing them. The command stores
the full header inline in both private client configs (mode 0600). Future harness
sessions do not need this environment variable. HTTPS is required;
ports and endpoint paths such as `/mcp` are supported, credentials/query/fragment
are rejected. This endpoint differs from `--server-executor`'s origin-only input.

The command adds an `executor` HTTP entry for **both Claude Code and Codex**.
It requires no root privileges or harness subprocess and can run from any directory.
It is separate from server provisioning and never creates accounts, keys, policy
rules, or integrations. It is not part of default OS setup and cannot be combined
with another mode or `--os`.

Supported configuration locations:

- Claude Code: `$HOME/.claude.json`, or `$CLAUDE_CONFIG_DIR/.claude.json` when that
  override is nonempty. The entry lives in the top-level `mcpServers` map (user
  scope), with `headers.Authorization` set to the complete supplied header.
- Codex: `$CODEX_HOME/config.toml`, defaulting to `$HOME/.codex/config.toml`.
  The `[mcp_servers.executor]` table uses
  `http_headers = { Authorization = "Bearer <API key/token>" }`.

Claude's legacy `$HOME/.claude/.config.json` or
`$CLAUDE_CONFIG_DIR/.config.json` takes precedence over the standard file.
If that path exists (including a link), or its layout cannot be safely inspected,
setup refuses before writing either client. A default `$HOME/.claude` directory
with group write permissions or a resolvable symlink is supported when no legacy
file exists and lookup succeeds; it is only a lookup path. Actual write-target ownership, permissions
and link checks still apply, including to an explicit `CLAUDE_CONFIG_DIR`.
It never reads, adopts or rewrites the legacy file. Use manual user-scope MCP
setup in the intended Claude/Codex environment for these layouts. An explicitly empty `CLAUDE_CONFIG_DIR` is
ambiguous for legacy lookup; unset it for the default home or set an absolute home.

Nonempty `CLAUDE_CODE_CUSTOM_OAUTH_URL`, `USE_STAGING_OAUTH` or `USE_LOCAL_OAUTH`
also causes refusal before either write; use manual setup with that environment.
Custom OAuth selects `.claude-custom-oauth.json`. The installed production Claude
2.1.292 fixes its staging/local filename selector to production; other builds'
`.claude-staging-oauth.json` / `.claude-local-oauth.json` targets are unsupported.
The switches are refused conservatively for any nonempty value, including `0`
or `false`; setup does not interpret their value semantics or change them.

Use absolute homes for the intended non-root user; `XDG_CONFIG_HOME` does not
redirect these MCP files. Both clients use the saved header verbatim, including
`Bearer `. The file locations were checked against Claude Code **2.1.292**,
Codex **0.160.1**, and the
[Claude MCP documentation](https://code.claude.com/docs/en/mcp),
[Claude environment settings](https://code.claude.com/docs/en/env-vars), and
[Codex MCP](https://developers.openai.com/codex/mcp) /
[config-home documentation](https://developers.openai.com/codex/config-advanced).
Earlier native offline readback verified the previous environment-reference entries;
the inline entries and connectivity check are covered by local stub-server tests.
Live native client and T3 session access, older versions and other Claude builds
remain unverified.

Both files are inspected before writes. A matching entry already at mode 0600 is
a config no-op, including timestamps. Readable existing configs are restricted
to mode 0600. A differing or unknown `executor`
entry stops: reconcile it manually in the effective user config, then retry.
Matching inline headers are reused; differing credentials and old environment-reference
entries require manual reconciliation. They are never printed or migrated automatically.
Unrelated JSON bytes, settings, TOML sections, and comments are retained. Duplicate
JSON keys, malformed configs, linked files/directories, foreign ownership, and
shared write permissions are refused. The additive TOML path conservatively refuses
multiline strings and inline/dotted `mcp_servers` parent definitions; use regular
MCP tables or configure the entry manually for those shapes.

Config files use mode 0600 and new directories 0700. Existing files are updated
in place, with changed-input checks before writing and restoration from memory after caught write failures. No secret-bearing
backups or temporary config copies are created. Run with other config writers
stopped: these two file updates are not an atomic transaction across crashes or
power loss. An incomplete/recovery warning requires manual inspection of both
files before retrying; empty directories may remain after a failed fresh setup.

For **T3-launched sessions**, run setup with the homes of the user that runs the
future T3 backend/harness. That backend and its future child sessions must use
the same `HOME`, `CODEX_HOME`, and/or `CLAUDE_CONFIG_DIR`. The inline header is
read from those files; no service or login-shell environment setup is needed.
This command does not alter T3 provider settings, services, launch environments, or sessions. Managed/project config and explicit launch overrides
can take precedence over these user entries.

“Configuration written” or “already matches” reports local registration. The command
then sends an authenticated MCP `initialize` request, accepting JSON or event-stream
responses, and an `initialized` notification. The check has a five-second total
timeout and refuses redirects. “Executor connected” confirms that check only;
OAuth, tool discovery and account/integration access remain unverified. A failed
check prints “Executor connection failed”, exits nonzero, and keeps the private
configs for inspection and retry. Headers, server responses and transport errors
are never printed. Verify expected tool access separately in the future harness session.
