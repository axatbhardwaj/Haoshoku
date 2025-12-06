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
- **`src/helpers/`**: Standalone helper scripts (e.g., `configure_git.js`).
 