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

T3 Code owns agent orchestration. Debian server setup requires its nightly
service over Tailscale and Hermes Telegram transport. Its
[tailnet SSH firewall](../README.md#debian-tailnet-ssh-firewall) checks readiness
before UFW mutation and reports incomplete hardening through the overall setup
result, including existing public rules and inactive-UFW enable refusal. Omarchy binds `Super+T`
to launch or focus T3 Code Nightly. Both T3 setup helpers enforce the
[single-backend preflight](../README.md#t3-single-backend-preflight), including reruns. See the [migration note](../README.md#existing-host-migration)
for existing host artifacts that require manual retirement.

See the [retired skill commands](../README.md#retired-skill-commands) and
[retired service and watcher commands](../README.md#retired-service-and-watcher-commands)
for refusal guidance and existing-installation preservation. Axstack continues
to supply workflow skills through `--axstack`.

Executor server provisioning is a separate, opt-in Debian command:
`haoshoku --server-executor <https-origin>`. It requires root, Docker Compose v2,
`ss`, and independently provisioned public DNS/TLS/nginx. It preserves unmanaged
or conflicting deployments and verifies an identical managed rerun without
updating it. The focused helpers separate process/filesystem preflight from
bounded application and origin probes. See [Executor server prerequisites and
preservation](../README.md#opt-in-executor-server) for the image, data ownership,
verification limits and manual owner/authentication steps.

Executor client registration is a separate, explicit user command:
`haoshoku --executor-clients <https-endpoint>`. The CLI validates the standalone
endpoint/auth inputs before logging or writes, then calls focused config and
filesystem helpers. Both Claude/Codex configs are preflighted together; JSON key
insertion and TOML append preserve unrelated bytes, and caught write failures
restore original contents from memory without backup artifacts. Matching entries
perform no config writes. No server provisioning or authenticated discovery runs.
See [Executor client prerequisites and session inheritance](../README.md#opt-in-executor-clients)
for auth syntax, effective user/config homes, conservative unsupported shapes,
T3 environment inheritance, and the crash/verification limits.
