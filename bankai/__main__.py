import argparse
import logging
import os
import shlex
import shutil
import stat
import subprocess
import sys
import importlib
from pathlib import Path

from rich.console import Console
from rich.prompt import Prompt

from bankai.tui import TUI, get_tui_logger

# --- Logger Setup ---
log = logging.getLogger("bankai")
log.setLevel(logging.INFO)
log.propagate = False
# The RichHandler is now managed by the TUI

# --- Configuration ---
REPO_URL = "https://github.com/axatbhardwaj/bankai.git"
REPO_DIR_NAME = Path(Path(REPO_URL).stem)


# --- Helper Functions ---
def run_command(command, check=True):
    """Runs a shell command."""
    log.info(f"[dim]Executing: {command}[/dim]")
    try:
        process = subprocess.run(
            shlex.split(command),
            check=check,
            capture_output=True,
            text=True,
        )
        if process.stdout:
            log.info(process.stdout.strip())
        if process.stderr:
            log.warning(process.stderr.strip())
        return process
    except subprocess.CalledProcessError as e:
        log.error(f"Command '{command}' failed with exit code {e.returncode}.")
        if e.stdout:
            log.error(f"Stdout: {e.stdout.strip()}")
        if e.stderr:
            log.error(f"Stderr: {e.stderr.strip()}")
        return None
    except FileNotFoundError:
        log.error(f"Command not found for: '{command}'")
        return None


def check_prerequisites():
    """Checks for git and bash, attempts to install git if missing."""
    if shutil.which("bash") is None:
        log.error("Bash is required to run the target scripts. Please install it.")
        sys.exit(1)

    if shutil.which("git") is not None:
        return  # Git is installed

    log.error("Git is not installed. It is required to continue.")
    package_managers = {
        "pacman": "sudo pacman -Syu --noconfirm git",
        "apt-get": "sudo apt-get update && sudo apt-get install -y git",
        "dnf": "sudo dnf install -y git",
    }
    for pm, command in package_managers.items():
        if shutil.which(pm):
            log.info(f"Attempting to install git using {pm}...")
            if run_command(command):
                log.info("Git installed successfully.")
                return
            else:
                log.error(f"Failed to install git using {pm}.")
                sys.exit(1)

    log.error("Could not determine a package manager to install git automatically.")
    sys.exit(1)


def clone_or_update_repo():
    """Clones the repository or pulls the latest changes."""
    if REPO_DIR_NAME.is_dir():
        log.info(f"Directory '{REPO_DIR_NAME}' exists. Pulling latest changes...")
        try:
            os.chdir(REPO_DIR_NAME)
            if run_command("git pull"):
                log.info("Repository updated.")
            else:
                log.warning("Failed to pull updates. Using local version.")
        finally:
            os.chdir("..")
    else:
        log.info(f"Cloning repository '{REPO_URL}'...")
        if not run_command(f"git clone {REPO_URL}"):
            log.error(f"Failed to clone repository from {REPO_URL}.")
            sys.exit(1)
        log.info("Repository cloned successfully.")
        # After cloning, we need to be inside the repo dir for subsequent operations
        try:
            os.chdir(REPO_DIR_NAME)
        except FileNotFoundError:
            log.error(f"Failed to enter repository directory '{REPO_DIR_NAME}'.")
            sys.exit(1)


def detect_os():
    """Detects the OS from /etc/os-release."""
    os_release_file = Path("/etc/os-release")
    if not os_release_file.exists():
        log.warning("/etc/os-release not found. Cannot automatically detect OS.")
        return None

    with os_release_file.open() as f:
        os_release = dict(line.strip().split("=", 1) for line in f if "=" in line)

    os_id = os_release.get("ID", "").strip('"').lower()
    id_like = os_release.get("ID_LIKE", "").strip('"').lower().split()

    log.info(f"Detected OS ID: {os_id}, Family: {' '.join(id_like)}")

    if "cachyos" in os_id or "arch" in id_like:
        return "cachyos"
    if "debian" in id_like or "ubuntu" in id_like:
        return "kubuntu"
    if "fedora" in id_like or "nobara" in os_id:
        return "nobara"

    log.warning(
        f"Detected OS Family ('{id_like or os_id}') does not directly match known scripts."
    )
    return None


def select_os_manually():
    """Prompts the user to select an OS."""
    log.info("Please select the target operating system script:")
    choice = Prompt.ask(
        "Enter your choice",
        choices=["cachyos", "kubuntu", "nobara", "cancel"],
        default="cancel",
    )
    if choice == "cancel":
        log.info("Operation cancelled.")
        sys.exit(0)
    return choice


def setup_file_logging():
    """Sets up logging to a file."""
    file_handler = logging.FileHandler("bankai.log", mode="w")
    formatter = logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )
    file_handler.setFormatter(formatter)
    log.addHandler(file_handler)
    log.info("File logging initialized.")


def get_target_os(cli_arg):
    """Determines the target OS from CLI arg, detection, or manual selection."""
    if cli_arg:
        os_map = {
            "cachyos": "cachyos",
            "arch": "cachyos",
            "kubuntu": "kubuntu",
            "debian": "kubuntu",
            "ubuntu": "kubuntu",
            "nobara": "nobara",
            "fedora": "nobara",
        }
        normalized_arg = cli_arg.lower()
        if normalized_arg in os_map:
            log.info(f"Proceeding with specified OS: {os_map[normalized_arg]}")
            return os_map[normalized_arg]

        log.error(f"Invalid OS specified with --os: {cli_arg}.")
        return select_os_manually()

    detected = detect_os()
    if detected:
        log.info(f"Proceeding with detected OS: {detected}")
        return detected

    log.warning("Could not determine OS automatically.")
    return select_os_manually()


def main():
    """Main script logic."""
    setup_file_logging()
    parser = argparse.ArgumentParser(
        description="Bankai: Your personal setup assistant.",
        epilog="Arguments after '--' will be passed to the target OS script.",
    )
    parser.add_argument(
        "--os", help="Specify the target OS (cachyos, kubuntu, nobara)."
    )

    # Now we are inside the repo, we can parse arguments and run the main logic.
    try:
        separator_index = sys.argv.index("--")
        main_args = sys.argv[1:separator_index]
        script_args = sys.argv[separator_index + 1 :]
    except ValueError:
        main_args = sys.argv[1:]
        script_args = []

    args = parser.parse_args(main_args)
    final_os = get_target_os(args.os)

    try:
        # Dynamically import the OS-specific module
        os_module_name = f"os_scripts.{final_os}"
        os_module = importlib.import_module(os_module_name)
    except ImportError:
        log.error(f"Failed to load setup module for OS: '{final_os}'")
        log.error(f"Looked for module: '{os_module_name}.py'")
        sys.exit(1)

    # Get the steps from the OS module to initialize the TUI
    steps = getattr(os_module, "STEPS", [])
    if not steps:
        log.error("No steps defined in the OS setup script.")
        sys.exit(1)

    tui = TUI(script_name=final_os, total_steps=len(steps))
    log.addHandler(get_tui_logger(tui))
    tui.update_steps(steps)

    try:
        tui.start()
        # The main setup function in the OS script
        os_module.run_setup(tui, log)
        log.info(f"[bold green]{final_os} setup finished successfully.[/bold green]")
    except (Exception, KeyboardInterrupt):
        log.error("A critical error occurred.", exc_info=True)
        sys.exit(1)
    finally:
        if tui.live.is_started:
            tui.stop()

    log.info("Bankai script finished.")


if __name__ == "__main__":
    main()
