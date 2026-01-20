# Plan: Enable Ported Agents in Haoshoku

## Overview

Enable the standard set of agents (debugger, developer, quality-reviewer, technical-writer) for the `haoshoku` repository by symlinking them from the existing `configs/claude-config` submodule. This ensures the repo uses the shared agent configurations while keeping them in sync with the submodule.

## Planning Context

### Decision Log

| Decision | Reasoning Chain |
| :--- | :--- |
| Symlink agents from submodule | Agents exist in submodule `configs/claude-config` -> duplication would cause drift -> symlinking ensures `haoshoku` uses the latest shared config automatically |
| Target `.claude/agents/` | Standard location for agent definitions -> `haoshoku` repo needs local agent config -> `.claude/agents/` is the correct place |
| Skip tests | Configuration change only -> no application logic modified -> manual verification of agent availability is sufficient |

### Constraints & Assumptions

- **Submodule**: Assumes `configs/claude-config` is checked out and accessible.
- **Platform**: Symlinks work on the target platform (Linux).
- **Tooling**: The agent runner looks for agents in `.claude/agents/`.

### Known Risks

| Risk | Mitigation | Anchor |
| :--- | :--- | :--- |
| Submodule missing | User must ensure submodules are initialized. | N/A |
| Broken symlinks | If submodule moves, links break. Accepted as low risk. | N/A |

## Invisible Knowledge

### Architecture

N/A - Configuration change.

## Milestones

### Milestone 1: Configure Agents

**Files**:
- `.claude/agents/debugger.md`
- `.claude/agents/developer.md`
- `.claude/agents/quality-reviewer.md`
- `.claude/agents/technical-writer.md`

**Requirements**:
- Create `.claude/agents/` directory if it doesn't exist.
- Create relative symbolic links pointing to the corresponding files in `../../configs/claude-config/agents/`.

**Acceptance Criteria**:
- `ls -l .claude/agents/` shows valid symlinks.
- `read .claude/agents/developer.md` resolves to the file content.

**Tests**:
- Skip: Configuration only.

**Code Intent**:
- Create directory `.claude/agents/`
- Symlink `../../configs/claude-config/agents/debugger.md` to `.claude/agents/debugger.md`
- Symlink `../../configs/claude-config/agents/developer.md` to `.claude/agents/developer.md`
- Symlink `../../configs/claude-config/agents/quality-reviewer.md` to `.claude/agents/quality-reviewer.md`
- Symlink `../../configs/claude-config/agents/technical-writer.md` to `.claude/agents/technical-writer.md`

**Code Changes**:

```diff
--- /dev/null
+++ b/.claude/agents/debugger.md
@@ -0,0 +1 @@
+../../configs/claude-config/agents/debugger.md
```

```diff
--- /dev/null
+++ b/.claude/agents/developer.md
@@ -0,0 +1 @@
+../../configs/claude-config/agents/developer.md
```

```diff
--- /dev/null
+++ b/.claude/agents/quality-reviewer.md
@@ -0,0 +1 @@
+../../configs/claude-config/agents/quality-reviewer.md
```

```diff
--- /dev/null
+++ b/.claude/agents/technical-writer.md
@@ -0,0 +1 @@
+../../configs/claude-config/agents/technical-writer.md
```

### Milestone 2: Documentation

**Delegated to**: @agent-technical-writer (mode: post-implementation)

**Files**:
- `CLAUDE.md`

**Requirements**:
- Check if `CLAUDE.md` needs an update to mention the `.claude/` directory or agents.
- If appropriate, add `.claude/` to the "Subdirectories" table or a new section.
- Ensure `CLAUDE.md` follows the tabular format.

**Acceptance Criteria**:
- `CLAUDE.md` remains valid markdown and tabular.

**Source Material**: This plan.
