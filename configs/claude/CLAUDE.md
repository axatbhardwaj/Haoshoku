# Rules

- The average (ideal) length of the function should be around 15 lines.
- Do not catch broad exceptions; only catch exceptions at the lowest level.
- Check for conditions to exit early.
- Reduce nesting as much as possible.
- Break logic into smaller readable functions.
- Keep changes to a minimum.
- Follow the KISS principle: keep things very simple.
- Only commit changes when explicitly told to do so.

# Git Commits

- Keep commit messages short and precise (50 chars max for subject).
- One file per commit when possible - do not club multiple unrelated files.
- Each commit should represent one logical change.
- Use semantic prefixes: feat, fix, refactor, docs, test, chore.
- Avoid vague messages like "update files" or "fix stuff".

# Workflow

- Evaluate if a skill is more appropriate for the user's request before proceeding manually.
- Use skills and agents when they can optimize the workflow.
- Prefer Task tool with specialized agents for complex searches.
- Use parallel tool calls when operations are independent.

# Project Context Memory

Before starting work on any project, check for context at `~/context/{classification}/{project-name}/`:

**Structure:**
- `context.md` - Wiki with Architecture, Decisions, Patterns, Issues, Recent Work
- `history/` - Immutable session logs with full details
- `plans/` - Implementation plans for complex features

**On session start:**
1. Derive path: `~/context/personal/{project-name}/context.md` or `~/context/work/{project-name}/context.md`
2. Read `context.md` if it exists
3. Check Recent Work for what was done last
4. Review Decisions to follow established patterns
5. Check Issues to avoid repeating solved problems

**While working:**
- Follow patterns documented in Decisions section
- Reference history files via `[[Details](history/...)]` links for full context

**Example:**
For project at `~/personal/my-app/`, read `~/context/personal/my-app/context.md`
