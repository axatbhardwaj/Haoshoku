# Shape Spec

Gather context and structure planning for significant work. **Run this command while in plan mode.**

> **OUTPUT CONTRACT (local override).** Write the plan as ONE dark, self-contained HTML file to
> `./superpowers/plans/YYYY-MM-DD-{slug}.html` (gitignored). NEVER write `agent-os/specs/*.md`.
> Execution is Superpowers TDD, not `/execute-tasks`, so no machine-readable markdown task list is
> required. HTML quality bar = the user's CLAUDE.md "Deliverables" section (dark, beautiful,
> self-contained, no CDNs). Standards content (Step 5) is still injected — it renders as an HTML
> section, not a separate `standards.md`.

## Important Guidelines

- **Always use AskUserQuestion tool** when asking the user anything
- **Offer suggestions** — Present options the user can confirm, adjust, or correct
- **Keep it lightweight** — This is shaping, not exhaustive documentation

## Prerequisites

This command **must be run in plan mode**.

**Before proceeding, check if you are currently in plan mode.**

If NOT in plan mode, **stop immediately** and tell the user:

```
Shape-spec must be run in plan mode. Please enter plan mode first, then run /shape-spec again.
```

Do not proceed with any steps below until confirmed to be in plan mode.

## Process

### Step 1: Clarify What We're Building

Use AskUserQuestion to understand the scope:

```
What are we building? Please describe the feature or change.

(Be as specific as you like — I'll ask follow-up questions if needed)
```

Based on their response, ask 1-2 clarifying questions if the scope is unclear. Examples:
- "Is this a new feature or a change to existing functionality?"
- "What's the expected outcome when this is done?"
- "Are there any constraints or requirements I should know about?"

### Step 2: Gather Visuals

Use AskUserQuestion:

```
Do you have any visuals to reference?

- Mockups or wireframes
- Screenshots of similar features
- Examples from other apps

(Paste images, share file paths, or say "none")
```

If visuals are provided, note them for inclusion in the plan.

### Step 3: Identify Reference Implementations

Use AskUserQuestion:

```
Is there similar code in this codebase I should reference?

Examples:
- "The comments feature is similar to what we're building"
- "Look at how src/features/notifications/ handles real-time updates"
- "No existing references"

(Point me to files, folders, or features to study)
```

If references are provided, read and analyze them to inform the plan.

### Step 4: Check Product Context

Check if `agent-os/product/` exists and contains files.

If it exists, read key files (like `mission.md`, `roadmap.md`, `tech-stack.md`) and use AskUserQuestion:

```
I found product context in agent-os/product/. Should this feature align with any specific product goals or constraints?

Key points from your product docs:
- [summarize relevant points]

(Confirm alignment or note any adjustments)
```

If no product folder exists, skip this step.

### Step 5: Surface Relevant Standards

Read `agent-os/standards/index.yml` to identify relevant standards based on the feature being built.

Use AskUserQuestion to confirm:

```
Based on what we're building, these standards may apply:

1. **api/response-format** — API response envelope structure
2. **api/error-handling** — Error codes and exception handling
3. **database/migrations** — Migration patterns

Should I include these in the spec? (yes / adjust: remove 3, add frontend/forms)
```

Read the confirmed standards files to include their content in the plan context.

### Step 6: Generate Plan Filename

Create a single HTML filename using this format:
```
./superpowers/plans/YYYY-MM-DD-{feature-slug}.html
```

Where:
- Date is the current date
- Feature slug is derived from the feature description (lowercase, hyphens, max 40 chars)

Example: `./superpowers/plans/2026-01-15-user-comment-system.html`

**Note:** Create `./superpowers/plans/` if it doesn't exist. Never create `agent-os/specs/`.

### Step 7: Structure the Plan

Build the plan as ONE HTML file (the Step 6 filename). It opens by capturing the shaping work as HTML sections, then lists implementation tasks. There is no "save spec documentation" task — the single HTML file IS the saved artifact.

Present this structure to the user:

```
Here's the plan structure — one dark HTML file at ./superpowers/plans/{name}.html.

---

# {Feature} — Plan
## Shaping notes      (scope, decisions, context from our conversation)
## Standards applied  (full content of each injected standard)
## References         (pointers to reference implementations studied)
## Visuals            (inlined as data-URI <img> or linked paths; optional)
## Tasks
  1. [First implementation task]
  2. [Next task]
  ...

---

Does this structure look right? I'll fill in the implementation tasks next.
```

### Step 8: Complete the Plan

After the structure is confirmed, continue building out the remaining implementation tasks based on:
- The feature scope from Step 1
- Patterns from reference implementations (Step 3)
- Constraints from standards (Step 5)

Each task should be specific and actionable.

### Step 9: Ready for Execution

When the full plan is ready, save the HTML file to `./superpowers/plans/`, then:

```
Plan complete and saved to ./superpowers/plans/{name}.html.

Execution is Superpowers (TDD → verification → review), task by task.

Ready to start? (approve / adjust)
```

## Output Structure

The plan is ONE file: `./superpowers/plans/YYYY-MM-DD-{slug}.html` — dark, self-contained, no CDNs (see the user's CLAUDE.md "Deliverables"). It contains these sections:

```
./superpowers/plans/2026-01-15-user-comment-system.html
├── Header            # feature, goal, architecture, tech stack
├── Shaping notes     # scope, decisions, context (was shape.md)
├── Standards applied # FULL content of each injected standard (was standards.md)
├── References        # pointers to similar code (was references.md)
└── Tasks             # ordered, bite-sized steps with verification
```

No `agent-os/specs/` folder, no separate `.md` files, no `visuals/` folder (inline visuals as data-URI `<img>` or linked paths).

### "Shaping notes" section — capture

- **Scope** — what we're building (Step 1)
- **Decisions** — key decisions and constraints noted
- **Context** — visuals, references, product alignment (or "N/A")

### "Standards applied" section — capture

The full content of each relevant standard (from Step 5), each under its own heading, so the plan is self-contained.

### "References" section — capture

For each reference: **Location**, **Relevance**, and **Key patterns** to borrow.

## Tips

- **Keep shaping fast** — Don't over-document. Capture enough to start, refine as you build.
- **Visuals are optional** — Not every feature needs mockups.
- **Standards guide, not dictate** — They inform the plan but aren't always mandatory.
- **Plans are discoverable** — Months later, someone can find the HTML plan in `./superpowers/plans/` and understand what was built and why.
