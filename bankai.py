import argparse
import logging
import os
import shlex
import shutil
import stat
import subprocess
import sys
from pathlib import Path
import importlib.resources

from rich.console import Console
from rich.logging import RichHandler
from rich.prompt import Prompt

# --- Logger Setup ---
log = logging.getLogger("bankai")
log.setLevel(logging.INFO)
log.propagate = False
console = Console()
log.addHandler(
    RichHandler(
        console=console,
        rich_tracebacks=True,
        show_path=False,
        show_level=False,
        show_time=False,
        markup=True,
    )
)

# --- Configuration ---
# REPO_URL = "https://github.com/axatbhardwaj/bankai.git"
# REPO_DIR_NAME = Path(Path(REPO_URL).stem)


# --- Helper Functions ---
def run_command(command, check=True):
    """Runs a shell command."""
    log.info(f"[dim]Executing: {command}[/dim]")
    try:
        process = subprocess.run(
            shlex.split(command),
            check=check,
            capture_output=not sys.stdout.isatty(),
            text=True,
        )
        if process.stdout:
            log.info(process.stdout.strip())
        if process.stderr:
            log.warning(process.stderr.strip())
        return process
    except subprocess.CalledProcessError as e:
        log.error(f"Command '{command}' failed with exit code {e.returncode}.")
        log.error(f"Stdout: {e.stdout}")
        log.error(f"Stderr: {e.stderr}")
        return None
    except FileNotFoundError:
        log.error(f"Command not found for: '{command}'")
        return None


def check_prerequisites():
    """Checks for bash."""
    if shutil.which("bash") is None:
        log.error("Bash is required to run the target scripts. Please install it.")
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
    parser = argparse.ArgumentParser(
        description="Bankai: Your personal setup assistant.",
        epilog="Arguments after '--' will be passed to the target OS script.",
    )
    parser.add_argument(
        "--os", help="Specify the target OS (cachyos, kubuntu, nobara)."
    )

    try:
        separator_index = sys.argv.index("--")
        main_args = sys.argv[1:separator_index]
        script_args = sys.argv[separator_index + 1 :]
    except ValueError:
        main_args = sys.argv[1:]
        script_args = []

    args = parser.parse_args(main_args)

    check_prerequisites()
    # No longer cloning repo, scripts are packaged.
    # clone_or_update_repo()

    final_os = get_target_os(args.os)
    target_script_name = f"{final_os}.py"

    try:
        target_script_path = (
            importlib.resources.files("os_scripts") / target_script_name
        )
    except (ModuleNotFoundError, AttributeError):
        log.error(
            f"Could not locate the 'os_scripts' package. Is the project installed correctly?"
        )
        sys.exit(1)

    if not target_script_path.is_file():
        log.error(f"Target script '{target_script_name}' not found in the repository.")
        sys.exit(1)

    log.info(f"Executing {target_script_name} with arguments: {script_args}")

    try:
        result = subprocess.run(
            [sys.executable, str(target_script_path), *script_args], check=False
        )
        if result.returncode == 0:
            log.info(
                f"[bold green]{target_script_name} executed successfully.[/bold green]"
            )
        else:
            log.error(f"{target_script_name} finished with errors.")
    except Exception as e:
        log.error(f"An unexpected error occurred while running the script: {e}")
        sys.exit(1)

    log.info("Bankai script finished.")


if __name__ == "__main__":
    main()
