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

On a fresh machine, bootstrap a private policy repository the user owns inside
the existing `~/.claude/` directory with the following in-place sequence.
Because the forced checkout overwrites any existing live file whose path is
tracked by the private repository, copy or review anything you need before
running these commands.

```bash
policy_repo='REPLACE_WITH_PRIVATE_POLICY_REPOSITORY_CLONE_URL'
git -C ~/.claude init
git -C ~/.claude remote add origin "$policy_repo"
git -C ~/.claude fetch origin
git -C ~/.claude remote set-head origin --auto
policy_branch="$(git -C ~/.claude symbolic-ref --short refs/remotes/origin/HEAD)"
git -C ~/.claude checkout -f -B "${policy_branch#origin/}" "$policy_branch"
```

Haoshoku deliberately cannot discover or fetch that private repository, so the
three-file deploy does not produce a complete policy checkout by itself.

After the checkout, every differing `haoshoku --claude` deploy overwrites the
tracked `CLAUDE.md` and `.gitignore`, preserving their previous live contents as
`CLAUDE.md.bak` and `.gitignore.bak`; reconcile each file individually instead
of committing the bundled text wholesale.

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
