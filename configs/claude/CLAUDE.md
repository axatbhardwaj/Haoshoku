## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update 'tasks/lessons.md' with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests -> then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management
1. **Plan First**: Write plan to 'tasks/todo.md' with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review to 'tasks/todo.md'
6. **Capture Lessons**: Update 'tasks/lessons.md' after corrections

## Core Principles
- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
- **Avoid Over-engineering**: Follow the KISS principle: keep things very simple.

### Git Commits

- Keep commit messages short and precise (50 chars max for subject).
- One file per commit when possible - do not club multiple unrelated files.
- Each commit should represent one logical change.
- Use semantic prefixes: feat, fix, refactor, docs, test, chore.
- Avoid vague messages like "update files" or "fix stuff".

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
