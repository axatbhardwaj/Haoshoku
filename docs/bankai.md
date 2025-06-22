# Bankai: Your Personal Setup Assistant

## Overview

`bankai` is a Python-based command-line tool designed to automate the setup of a development environment across different Linux distributions. It acts as a smart wrapper that clones a repository of setup scripts, intelligently detects the host operating system, and executes the appropriate script to configure the system. This approach provides a consistent, reliable, and automated way to provision a new machine.

The script is built to be robust, user-friendly, and flexible. It uses the `rich` library for clear, colored terminal output, provides sensible fallbacks for OS detection, and allows for manual overrides.

---

## How It Works: A Step-by-Step Guide

The script follows a clear, linear sequence of operations:

### 1. **Initialization and Logging**
   - When the script starts, it sets up a global logger using Python's `logging` module.
   - To enhance readability, it integrates with the `rich` library. The `RichHandler` formats log messages with colors and clean layouts, making the output intuitive and easy to follow. All subsequent informational messages, warnings, and errors are displayed through this system.

### 2. **Prerequisite Checks**
   - The script verifies that essential tools are installed before proceeding.
   - It first checks for `bash` because the target OS-specific setup files are shell scripts that require it.
   - It then checks for `git`. If `git` is missing, the script attempts to install it automatically by detecting the system's package manager (`pacman`, `apt-get`, or `dnf`). This self-healing capability makes the script more resilient on fresh OS installations.

### 3. **Repository Management**
   - The script is designed to work with a Git repository containing the actual setup logic. The URL for this repository is defined at the top of the script.
   - **Cloning**: If the repository directory does not exist locally, the script clones it from GitHub.
   - **Updating**: If the directory already exists, the script automatically runs `git pull` to fetch the latest changes. This ensures you are always running the most up-to-date version of your setup scripts.

### 4. **OS Determination**
   - This is the core intelligence of the script. It determines which setup script to run using a multi-tiered approach:
     - **Command-Line Argument (`--os`)**: The user can explicitly specify the target OS (e.g., `python bankai.py --os cachyos`). This is the highest priority and allows for manual override.
     - **Automatic Detection**: If no argument is provided, the script reads the `/etc/os-release` file. This standard Linux file contains information about the distribution. The script parses the `ID` and `ID_LIKE` fields to map the OS to one of the supported script types (`cachyos`, `kubuntu`, `nobara`).
     - **Manual Selection**: If auto-detection fails, the script prompts the user with a menu to select the correct OS. This ensures the process doesn't fail just because the OS is an unrecognized variant.

### 5. **Script Execution**
   - Once the target OS is determined, the script identifies the corresponding `.sh` file (e.g., `cachyos.sh`).
   - It makes the script executable by modifying its file permissions (`chmod +x`).
   - Finally, it executes the shell script using `bash`, passing along any additional arguments that were provided to the main `bankai.py` script. This allows you to pass custom flags or parameters to your OS-specific setup logic.

---

## A Deep Dive into the Imports

The script leverages a combination of standard Python libraries and one third-party library to achieve its functionality. Here's a detailed look at each one:

### Standard Libraries

- **`argparse`**: Used to parse command-line arguments. It provides a structured way to handle flags like `--os` and separates the main script's arguments from those intended for the target shell script. This makes the tool feel like a professional command-line utility.

- **`logging`**: The standard way to instrument code with event logs. It is used here to provide clear, level-based feedback (e.g., INFO, ERROR, WARNING) about the script's progress.

- **`os`**: Provides a way of using operating system-dependent functionality. It's used for changing the current directory (`os.chdir`) to navigate into the cloned repository.

- **`shlex`**: This module provides a simple way to parse shell-like syntaxes. Its `split()` function is used to break down a command string into a list of arguments, which is crucial for safely passing commands to `subprocess`.

- **`shutil`**: A high-level file operations library. Its `which()` function is used to check if a program (like `git` or `bash`) exists in the system's PATH, which is essential for the prerequisite checks.

- **`stat`**: Used to interpret file status information. The script uses `stat.S_IEXEC` to add the execute permission to the target shell script, ensuring it can be run.

- **`subprocess`**: The standard library for running external commands. It is used to execute `git`, package manager commands, and the final `.sh` setup script. The `run()` function is used for its flexibility and ability to manage command execution, capture output, and check for errors.

- **`sys`**: Provides access to system-specific parameters and functions. `sys.argv` is used to read command-line arguments, and `sys.exit()` is called to terminate the script cleanly after an error or user cancellation.

- **`pathlib`**: An object-oriented filesystem paths library. It provides a clean and modern way to handle file and directory paths, making the code more readable and cross-platform compatible than traditional string-based path manipulation.

### Third-Party Libraries

- **`rich`**: This is a powerful library for creating beautiful and readable terminal output.
  - **`Console`**: The main object for generating rich output.
  - **`RichHandler`**: A logging handler that formats log records using `rich`'s rendering capabilities, providing colored levels and clean formatting.
  - **`Prompt`**: Used to create user-friendly interactive prompts, like the menu for manual OS selection. It's a significant improvement over the standard `input()`. 