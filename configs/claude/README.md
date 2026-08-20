# configs/claude/

Public Claude Code personal-file bundle deployed to `~/.claude/`.

## Managed surface

| Bundle source | Live destination | Direction |
| --- | --- | --- |
| `CLAUDE.md`, `statusline-command.sh`, `gitignore.template` | `~/.claude/` (`gitignore.template` maps to `.gitignore`) | Both |

Custom agent definitions, wrapper launchers, and standalone skills are outside
this bundle. Claude and Codex use their native subagent/model facilities;
retired cross-engine plugin workflows remain outside Haoshoku.

`haoshoku --claude` uses this explicit portable-baseline manifest; it never walks
directories. The template name keeps the deny-first ignore file visible to git
and npm-packlist inside this package. If `~/.claude` is itself the root of a
git repository, any destination tracked in that repository's index is skipped
with an explanatory log line. Untracked destinations deploy normally. The
check fails open: if the directory is not a repository, git is unavailable, or
the query errors, the portable baseline deploys as usual.

`haoshoku --claude-backup` considers the same manifest in reverse. Index
ownership does not affect this backup direction.
Every captured file passes through a refusal guard: content containing a literal
absolute home-directory path is not written to this public bundle, the offending
file is named in a warning, and the final summary reports backed-up and refused
counts.

## Private policy bootstrap

The deployable config manifest carries only the three portable root files
above. The adjacent `README.md` is package documentation, not a deployed file.
Haoshoku does not recursively copy policy directories or become a general
private-policy backup.

During full setup, after Haoshoku deploys its public baseline, it asks whether
to bootstrap the configured private Claude policy repository in place at
`~/.claude/`; the prompt defaults to Yes. First configure git and add the
required credentials through the web interface. If the private repository is
unreachable or authentication fails, full setup warns and continues. Retry it
later with:

```console
haoshoku --claude-bootstrap
```

The standalone flag verifies remote reachability before changing the filesystem,
creates and initializes `~/.claude/` when needed, updates an existing `origin`,
resolves the remote's default branch, and force-checks it out. The repository
URL is optional and defaults to the owner's private policy repository. Other
users can set `claudeBootstrapUrl` alongside `skillSources` in
`~/.haoshoku.json` to use their own repository. Run the flag only after
credentials are configured; an authentication failure exits before `~/.claude/`
is created. The forced checkout replaces files at paths tracked by the private
repository, so copy or review colliding files first. Non-colliding local-only
files remain in place. Bootstrap never runs `git clean`, so the Omarchy-managed
`~/.claude/skills/omarchy` symlink survives.

The private repository may own the live `CLAUDE.md`, `settings.json`, richer
policy, conventions, and output styles. Haoshoku owns bootstrap orchestration
and the portable public baseline only. A private tracked file wins over
a colliding public baseline file.

The private repository owns every destination it tracks, including a locally
modified tracked file: `haoshoku --claude` skips that path instead of replacing
it. For an untracked destination that differs from the bundle, Haoshoku still
writes the live content once to `.haoshoku-first-capture` and also writes it to
a timestamped `.bak.<milliseconds>` file; the historical fixed `.bak` path is
populated only when absent for caller compatibility and is never replaced. A
numeric suffix keeps same-millisecond timestamped backups distinct, and an
identical deploy touches no backup. Existing `.orig` first captures are migrated
into the new slot. On a fresh machine,
`.haoshoku-first-capture` therefore holds the user file that predated the first
differing deploy. On an already-installed machine that has an old `.bak` but no
first capture, the next differing deploy captures whatever is live at upgrade
time — not the pristine original that an older Haoshoku run may already have
destroyed. Timestamped backups are not pruned, so later hand-edits remain
recoverable across subsequent differing deploys.

At the root of the private `~/.claude` repository,
`.haoshoku-first-capture` files are explicitly allowed by the deny-first
`.gitignore`, so they are untracked and visible in `git status`. That visibility
also exposes them to ordinary `git clean -fd`; commit a needed first capture or
move it outside the repository to make it durable. Timestamped
`.bak.<milliseconds>` files and the compatibility `.bak` file remain ignored at
that root: they do not appear in `git status`, and `git clean -xfd` removes
them. Move any needed ignored backup outside the repository before cleaning.

`haoshoku --skills` remains a separate, explicit system for linking skills from
configured sources into Claude's and Codex's shared skill directories. Neither
`--claude`, `--claude-update`, nor the default setup invokes it implicitly. It
deliberately ignores any source repository's `agents/` directory.

Upgrading Haoshoku does not recursively delete previously deployed files from
`~/.claude/agents/` or `~/.claude/skills/`, because those directories may be
co-owned. Retire old files through an explicit, reviewed path list; never delete
either parent configuration directory.

## Commands

```bash
# Deploy the portable baseline manifest
haoshoku --claude

# Back up the same explicit manifest where permitted by the refusal guard
haoshoku --claude-backup

# Sync skills separately
haoshoku --skills
```
