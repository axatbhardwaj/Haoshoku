# Haoshoku: Color of the Supreme King

## Overview

`haoshoku` is a JavaScript-based command-line tool designed to dominate the setup of your development environment. It is built to run with the **Bun** runtime for speed and efficiency.

The tool bundles a collection of OS-specific scripts. It intelligently detects the host operating system (or asks the user) and then executes the appropriate script to configure the system. This approach provides a consistent, reliable, and automated way to provision a new machine.

---

## How It Works: A Step-by-Step Guide

The script follows a clear, linear sequence of operations:

### 1. **Initialization**
   - The entry point is `haoshoku.js`.
   - It uses `commander` to parse command-line arguments and define the CLI interface.

### 2. **OS Determination**
   - **Command-Line Argument (`--os`)**: The user can explicitly specify the target OS (e.g., `haoshoku --os cachyos`).
   - **Automatic Detection**: If no argument is provided, the script reads `/etc/os-release` to detect the distribution ID (e.g., `cachyos`, `debian`).
   - **Manual Selection**: If auto-detection fails, the script uses `prompts` to ask the user to select their OS.

### 3. **Script Execution**
   - Once the OS is determined, the corresponding setup function is imported dynamically from `src/os_scripts/`.
   - The setup logic is executed, handling package installation, configuration copying, and system tweaks.
   - Helper functions in `src/common/utils.js` handle command execution (`runCommand`), logging, and checks.

---

## Technical Details

The project is built using modern JavaScript (ES Modules) and runs on Bun.

### Key Libraries

- **`commander`**: Handles CLI argument parsing and help generation.
- **`prompts`**: Provides interactive user prompts (selection, confirmation).
- **`chalk`**: Used for colorful terminal output and logging.

### Architecture

- **`haoshoku.js`**: Main entry point. Handles OS detection and routing.
- **`src/os_scripts/`**: Contains the setup logic for each supported OS (e.g., `cachyos.js`, `debian_server.js`).
- **`src/common/utils.js`**: Shared utilities for running shell commands, logging, and checking for file/command existence.
- **`src/common/cli_utils.js`**: The `MODE_FLAGS` registry and OS detection; every one-shot flag is registered there and exactly one may run per invocation.
- **`src/helpers/`**: Standalone helper scripts (e.g., `configure_git.js`).

### Local Paseo schedule configuration

Schedule configuration is an explicit three-step workflow and is never part of
normal OS setup:

```bash
haoshoku --paseo-schedules        # initialize or edit explicit role mappings
haoshoku --paseo-schedules-check  # read-only preflight and diff
haoshoku --paseo-schedules-apply  # private backup, update diffs, verify
```

`~/.config/haoshoku/paseo-schedules.json` contains the `staleArchive`,
`worktreeCleaner`, and `mergeReadiness` roles. Every bundled `scheduleId` is
`null`; each host maps only schedules it owns. Null roles are successful skips,
including a completely unmapped config.

For mapped roles, Haoshoku asks `paseo daemon status --home ~/.paseo --json`
with ambient Paseo routing variables removed, requires the same running local
home and a loopback endpoint, then connects to `/ws` through the pinned
`@getpaseo/client` API. It inspects explicit IDs only and validates provider,
model, effort, and effective mode capabilities before mutation. Apply sends
only changed owned fields and verifies that prompt, cadence, status, limits,
target safeguards, and other unowned data are preserved. A failed backup stops
before API writes; a failed post-write readback reports attempted, verified,
and uncertain roles separately and requires inspection before a manual retry.
