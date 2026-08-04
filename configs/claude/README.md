# configs/claude/

Public Claude Code personal-file bundle deployed to `~/.claude/`.

## Managed surface

| Bundle source             | Live destination                    | Direction |
| ------------------------- | ----------------------------------- | --------- |
| `CLAUDE.md`               | `~/.claude/CLAUDE.md`               | Both      |
| `statusline-command.sh`   | `~/.claude/statusline-command.sh`   | Both      |
| `gitignore.template`      | `~/.claude/.gitignore`              | Both      |

`haoshoku --claude` considers exactly these three entries. The template name
keeps the deny-first ignore file visible to git and npm-packlist inside this
package; it maps to the real `~/.claude/.gitignore`. If `~/.claude` is itself
the root of a git repository, any destination tracked in that repository's
index is skipped with an explanatory log line. Untracked destinations deploy
normally. The check fails open: if the directory is not a repository, git is
unavailable, or the query errors, all three entries deploy as usual.

`haoshoku --claude-backup` captures exactly the same three entries in reverse.
Index ownership does not affect this backup direction.
Every captured file passes through a refusal guard: content containing a literal
absolute home-directory path is not written to this public bundle, the offending
file is named in a warning, and the final summary reports backed-up and refused
counts.

## Executable policy bootstrap

This public package deliberately carries no `agents/` or `workflows/` policy
surface and neither Claude command reads or writes those directories.

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

The private repository owns the live `CLAUDE.md`, `settings.json`, wrapper
agents, workflows, conventions, and output styles. Haoshoku owns bootstrap
orchestration and the public fallback/integration files only. A private tracked
file wins over a colliding public fallback file.

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

`haoshoku --skills` remains a separate system: it may create
`~/.claude/agents/` and link non-shadowed agent definitions from configured
skill sources. That cache-backed behavior does not make this bundle an owner of
private executable policy.

## Commands

```bash
# Deploy the three bundled personal files
haoshoku --claude

# Back up the same three personal files
haoshoku --claude-backup

# Sync skills and cache-backed agent definitions separately
haoshoku --skills
```
