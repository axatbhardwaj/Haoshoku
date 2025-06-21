import argparse
import logging
import os
import shlex
import subprocess
import sys
from pathlib import Path

from rich.logging import RichHandler
from rich.panel import Panel
from rich.prompt import Prompt
from rich.layout import Layout
from rich.console import Console
from rich.live import Live
from rich.text import Text

from os_scripts import cachyos, kubuntu, nobara


# --- Logger Setup ---
class UILoggingHandler(logging.Handler):
    """A logging handler that emits records to a rich Text renderable."""

    def __init__(self, text_log, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.text_log = text_log

    def emit(self, record):
        self.text_log.append(self.format(record) + "\n")


console = Console()
log = logging.getLogger("bankai")
log.setLevel(logging.INFO)
# We remove other handlers to avoid double printing to the console
log.propagate = False
log.handlers.clear()
# Add a standard RichHandler for debugging if needed, but keep it quiet for the UI
# log.addHandler(RichHandler())


# --- Configuration ---
REPO_URL = "https://github.com/axatbhardwaj/bankai.git"
REPO_DIR_NAME = Path(Path(REPO_URL).stem)  # 'bankai'


# --- Helper Functions ---
def run_command(command, cwd=None):
    """Runs a command and returns its status."""
    try:
        process = subprocess.run(
            shlex.split(command),
            check=True,
            capture_output=True,
            text=True,
            cwd=cwd,
        )
        return True
    except subprocess.CalledProcessError as e:
        log.warning(f"Command '{command}' failed: {e.stderr.strip()}")
        return False
    except FileNotFoundError:
        log.warning(f"Command not found for: '{command}'")
        return False


# --- Core Logic ---
def clone_or_update_repo():
    """Clones the repository or pulls the latest changes."""
    if REPO_DIR_NAME.is_dir():
        log.info(f"Directory '{REPO_DIR_NAME}' exists. Pulling latest changes...")
        if not run_command("git pull", cwd=REPO_DIR_NAME):
            log.warning("Failed to pull updates. Using local version.")
    else:
        log.info(f"Cloning repository '{REPO_URL}'...")
        if not run_command(f"git clone {REPO_URL}"):
            log.error(f"Failed to clone repository from {REPO_URL}.")
            sys.exit(1)
        log.info("[bold green]Repository cloned successfully.[/bold green]")


def detect_os():
    """Detects the OS from /etc/os-release."""
    os_release_file = Path("/etc/os-release")
    if not os_release_file.exists():
        return None

    with os_release_file.open() as f:
        os_release = dict(line.strip().split("=", 1) for line in f if "=" in line)

    os_id = os_release.get("ID", "").strip('"').lower()
    id_like = os_release.get("ID_LIKE", "").strip('"').lower().split()

    family_map = {
        "cachyos": "cachyos",
        "arch": "cachyos",
        "debian": "kubuntu",
        "ubuntu": "kubuntu",
        "fedora": "nobara",
        "nobara": "nobara",
    }

    if os_id in family_map:
        return family_map[os_id]
    for family in id_like:
        if family in family_map:
            return family_map[family]

    return None


def select_os_manually():
    """Prompts the user to select an OS using a rich panel."""
    log.info("Please select the target OS:")
    options = {
        "1": ("CachyOS", "cachyos"),
        "2": ("Kubuntu/Debian", "kubuntu"),
        "3": ("Fedora/Nobara", "nobara"),
    }

    panel_content = "\n".join(
        [f"[bold cyan]{key}[/bold cyan]: {text}" for key, (text, _) in options.items()]
    )
    log.info(
        Panel(
            panel_content,
            title="[bold green]Available Setups[/bold green]",
            border_style="blue",
        )
    )

    while True:
        try:
            choice = Prompt.ask(
                "Enter your choice", choices=["1", "2", "3"], show_choices=False
            )
            if choice in options:
                return options[choice][1]
        except (EOFError, KeyboardInterrupt):
            log.warning("\nOperation cancelled.")
            sys.exit(0)


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
        log.warning(f"Invalid OS '{cli_arg}' specified with --os.")

    detected_os = detect_os()
    if detected_os:
        log.info(f"Detected OS: {detected_os}. Proceeding with this selection.")
        return detected_os

    log.warning("Could not determine OS automatically.")
    return select_os_manually()


def main():
    """Main script logic."""
    ui_log = Text()
    log.addHandler(UILoggingHandler(ui_log))

    main_panel = Panel(
        ui_log, title="[bold yellow]Log[/bold yellow]", border_style="blue"
    )
    footer_panel = Panel("[italic]In progress...[/italic]", style="dim")

    layout = Layout()
    layout.split_column(
        Layout(
            Panel("[bold green]Bankai: Your Personal Setup Assistant[/bold green]"),
            name="header",
            size=3,
        ),
        Layout(main_panel, name="main", ratio=1),
        Layout(footer_panel, name="footer", size=3),
    )

    with Live(layout, screen=True, redirect_stderr=False, refresh_per_second=4) as live:
        try:
            parser = argparse.ArgumentParser(
                description="Bankai: Your personal setup assistant.",
                epilog="Arguments after '--' will be passed to the target OS script.",
            )
            parser.add_argument(
                "--os", help="Specify the target OS (cachyos, kubuntu, nobara)."
            )

            # Split arguments for the main script and for the target script
            try:
                separator_index = sys.argv.index("--")
                main_args = sys.argv[1:separator_index]
                script_args = sys.argv[separator_index + 1 :]
            except ValueError:
                main_args = sys.argv[1:]
                script_args = []

            args = parser.parse_args(main_args)

            clone_or_update_repo()

            try:
                os.chdir(REPO_DIR_NAME)
            except FileNotFoundError:
                log.error(f"Failed to enter repository directory '{REPO_DIR_NAME}'.")
                raise

            final_os = get_target_os(args.os)

            script_map = {
                "cachyos": cachyos.main,
                "kubuntu": kubuntu.main,
                "nobara": nobara.main,
            }
            target_script_func = script_map.get(final_os)

            if not target_script_func:
                log.error(f"Internal error: No script found for OS '{final_os}'.")
                raise RuntimeError(f"Invalid OS selected: {final_os}")

            log.info(f"Executing setup for {final_os}...")

            # Pass the remaining arguments to the script function if it accepts them
            # For now, we call it without arguments.
            target_script_func()

            footer_panel.renderable = Text(
                "✅ Setup complete.", style="bold green", justify="center"
            )

        except Exception as e:
            log.error(f"An error occurred: {e}", exc_info=True)
            footer_panel.renderable = Text(
                f"❌ Setup failed. Check logs for details.",
                style="bold red",
                justify="center",
            )


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log.error(f"An unexpected error occurred: {e}")
        sys.exit(1)
