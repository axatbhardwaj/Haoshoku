# configs/claude/

Public Claude Code personal-file bundle deployed to `~/.claude/`.

## Managed surface

| Bundle source             | Live destination                    | Direction |
| ------------------------- | ----------------------------------- | --------- |
| `CLAUDE.md`               | `~/.claude/CLAUDE.md`               | Both      |
| `statusline-command.sh`   | `~/.claude/statusline-command.sh`   | Both      |
| `gitignore.template`      | `~/.claude/.gitignore`              | Both      |

`haoshoku --claude` copies exactly these three entries. The template name keeps
the deny-first ignore file visible to git and npm-packlist inside this package;
it is deployed as the real `~/.claude/.gitignore`.

`haoshoku --claude-backup` captures exactly the same three entries in reverse.
Every captured file passes through a refusal guard: content containing a literal
absolute home-directory path is not written to this public bundle, the offending
file is named in a warning, and the final summary reports backed-up and refused
counts.

## Executable policy bootstrap

This public package deliberately carries no `agents/` or `workflows/` policy
surface and neither Claude command reads or writes those directories.

On a fresh machine, bootstrap a private policy repository the user owns in
place at `~/.claude/` with the following sequence. It creates the directory
when absent and updates an existing `origin` URL, so rerunning it with a changed
repository URL cannot silently use the stale remote. The forced checkout
replaces files at paths tracked by the private repository; copy or review
colliding files first. Non-colliding local-only files remain in place.

```bash
policy_repo='REPLACE_WITH_PRIVATE_POLICY_REPOSITORY_URL'
mkdir -p ~/.claude &&
git -C ~/.claude init &&
if git -C ~/.claude remote get-url origin >/dev/null 2>&1; then
  git -C ~/.claude remote set-url origin "$policy_repo"
else
  git -C ~/.claude remote add origin "$policy_repo"
fi &&
git -C ~/.claude fetch --prune origin &&
git -C ~/.claude remote set-head origin --auto &&
policy_branch="$(git -C ~/.claude symbolic-ref --short refs/remotes/origin/HEAD)" &&
git -C ~/.claude checkout -f -B "${policy_branch#origin/}" "$policy_branch"
```

Haoshoku deliberately cannot discover or fetch that private repository, so the
three-file deploy does not produce a complete policy checkout by itself.

After the checkout, do not run a differing `haoshoku --claude` deploy without
first reconciling the co-owned `CLAUDE.md` and `.gitignore`. A deploy replaces
each differing live file and unconditionally overwrites its `.bak`; a second
deploy carrying changed bundle content can therefore destroy both the user's
edits and the backup that held the previous content. The deny-first
`.gitignore` excludes those root-level `.bak` files from git, so this is a
genuine, unrecoverable data-loss window rather than merely a dirty-tree or
diff-noise problem.

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
