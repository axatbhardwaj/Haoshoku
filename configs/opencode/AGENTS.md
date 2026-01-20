# Rules

- The average (ideal) length of the function should be around 15 lines.
- Do not catch broad exceptions; only catch exceptions at the lowest level.
- Check for conditions to exit early.
- Reduce nesting as much as possible.
- Break logic into smaller readable functions.
- Keep changes to a minimum.
- Follow the KISS principle: keep things very simple.
- Only commit changes when explicitly told to do so.

# Known Issues

- **Ripgrep processes hang:** When using the Grep tool, ripgrep (`rg`) processes may remain running in the background after completion. If you notice high CPU usage or dangling processes, manually kill them:
  ```bash
  pkill -f rg
  ```

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

# Context Tracking (Opencode)

Since Opencode lacks automatic stop hooks, use the `context-tracker` subagent to persist session context.

**Usage:**
At the end of a session (or when asked), invoke the context-tracker:
```
@context-tracker Sync: <brief summary of what was done>
```

**The agent will:**
1. Generate a session log entry.
2. Update the project's `context.md` with a Recent Work entry.
3. Commit and push to the context repository.

**Manual alternative:**
If the agent fails, run the sync script directly:
```bash
echo '{"cwd": "<project_path>", "topics": ["<topic>"], "session_log_content": "...", "recent_work_entry": "..."}' | python3 ~/personal/claude-context-tracker/hooks/opencode_sync.py
```
