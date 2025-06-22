# Bankai: Your Personal Setup Assistant

## Overview

`bankai` is a Python-based command-line tool designed to automate the setup of a development environment across different Linux distributions. It is distributed as a package that can be installed via `pipx` or `pip`.

The tool bundles a collection of OS-specific Python scripts. It intelligently detects the host operating system (or asks the user) and then executes the appropriate script to configure the system. This approach provides a consistent, reliable, and automated way to provision a new machine without needing to manually clone or manage scripts.

The script is built to be robust and user-friendly. It uses the `rich` library for clear, colored terminal output, provides sensible fallbacks for OS detection, and allows for manual overrides.

---

## How It Works: A Step-by-Step Guide

The script follows a clear, linear sequence of operations:

### 1. **Initialization and Logging**
   - When the script starts, it sets up a global logger using Python's `logging` module.
   - To enhance readability, it integrates with the `rich` library. The `RichHandler` formats log messages with colors and clean layouts, making the output intuitive and easy to follow.

### 2. **OS Determination**
   - This is the core intelligence of the script. It determines which setup script to run using a multi-tiered approach:
     - **Command-Line Argument (`--os`)**: The user can explicitly specify the target OS (e.g., `bankai --os cachyos`). This is the highest priority and allows for manual override.
     - **Automatic Detection**: If no argument is provided, the script reads the `/etc/os-release` file. This standard Linux file contains information about the distribution. The script parses the `ID` and `ID_LIKE` fields to map the OS to one of the supported script types (`cachyos`, `kubuntu`, `nobara`).
     - **Manual Selection**: If auto-detection fails, the script prompts the user with a menu to select the correct OS. This ensures the process doesn't fail just because the OS is an unrecognized variant.

### 3. **Script Discovery and Execution**
   - Once the target OS is determined (e.g., `cachyos`), the script looks for a corresponding Python script (`cachyos.py`) within its own `os_scripts` package.
   - It uses `importlib.resources` to locate the script, ensuring it can be found regardless of how `bankai` was installed.
   - Finally, it executes the target Python script using the same Python interpreter that is running `bankai` itself. It uses `subprocess.run` to launch the script as a new process, passing along any additional arguments that were provided to the main `bankai` command.

---

## A Deep Dive into the Imports

The script leverages a combination of standard Python libraries and one third-party library to achieve its functionality.

### Standard Libraries

- **`argparse`**: Used to parse command-line arguments. It provides a structured way to handle flags like `--os` and separates the main script's arguments from those intended for the target OS script.

- **`importlib.resources`**: A key part of the new design. It's used to find and access the packaged OS scripts (e.g., `cachyos.py`) from within the installed `bankai` package. This replaces the need to clone a repository.

- **`logging`**: The standard way to instrument code with event logs, providing clear feedback about the script's progress.

- **`shlex`**: Its `split()` function is used to break down command strings into a list of arguments, which is crucial for safely passing commands to `subprocess`.

- **`shutil`**: Its `which()` function is used to check if a program exists in the system's PATH.

- **`subprocess`**: The standard library for running external commands. It is used to execute the final OS-specific Python script.

- **`sys`**: Provides access to `sys.argv` to read command-line arguments and `sys.exit()` to terminate the script.

- **`pathlib`**: Provides a clean, object-oriented way to handle file and directory paths.

### Third-Party Libraries

- **`rich`**: A powerful library for creating beautiful and readable terminal output.
  - **`Console`**: The main object for generating rich output.
  - **`RichHandler`**: A logging handler that formats log records using `rich`'s rendering capabilities.
  - **`Prompt`**: Used to create user-friendly interactive prompts, such as the menu for manual OS selection. 