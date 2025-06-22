import configparser
import logging
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path

from rich.console import Console
from rich.logging import RichHandler
from rich.prompt import Confirm, Prompt
from rich.text import Text

# --- Logger and Global Setup ---
log = logging.getLogger("bankai.git_config")
console = Console()
log.setLevel(logging.INFO)
log.propagate = False
log.addHandler(
    RichHandler(
        console=console,
        rich_tracebacks=True,
        show_path=False,
        show_level=False,
        show_time=False,
    )
)


# --- Helper Functions ---
def run_command(command, check=True):
    """Runs a shell command interactively, as this script requires user input."""
    log.info(f"[dim]Executing: {command}[/dim]")
    try:
        # These commands may need interactive prompts (e.g., ssh-add passphrase)
        subprocess.run(command, shell=True, check=check)
    except subprocess.CalledProcessError as e:
        log.error(f"Command '{command}' failed with exit code {e.returncode}.")
    except FileNotFoundError:
        log.error(f"Command not found for: '{command}'")


def start_ssh_agent():
    """Starts ssh-agent and sets the environment variables for the current process."""
    log.info("Starting ssh-agent...")
    try:
        result = subprocess.run(
            ["ssh-agent", "-s"], capture_output=True, text=True, check=True
        )
        # Parse the output of ssh-agent -s to set environment variables
        find_vars = re.compile(r"(\S+)=([^;]+);")
        for line in result.stdout.strip().split("\n"):
            match = find_vars.search(line)
            if match:
                key, value = match.groups()
                os.environ[key] = value
        # Log the agent PID for confirmation
        if "Agent pid" in result.stdout:
            log.info(result.stdout.strip().split("\n")[-1])
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        log.error(
            f"Could not start ssh-agent. Please ensure it's installed. Error: {e}"
        )
        sys.exit(1)


def prompt_user(prompt_text, default=False):
    """Asks the user a yes/no question, handling Ctrl+C gracefully."""
    try:
        return Confirm.ask(prompt_text, default=default)
    except KeyboardInterrupt:
        log.warning("\nOperation cancelled by user.")
        sys.exit(1)


# --- Main Logic ---
def create_profile(profile_type: str, ssh_dir: Path):
    """Creates a complete Git profile: directory, .gitconfig, and SSH key."""
    log.info(f"--- Setting up {profile_type.capitalize()} Git profile ---")
    profile_dir = Path.home() / profile_type
    profile_dir.mkdir(exist_ok=True)

    email = Prompt.ask(f"Enter {profile_type} email")
    username = Prompt.ask(f"Enter {profile_type} username")
    github_user = Prompt.ask(f"Enter GitHub username for {profile_type}")

    key_path = ssh_dir / f"{profile_type}_key"
    gitconfig_path = profile_dir / f".gitconfig.{profile_type}"

    # Use configparser for a structured approach
    config = configparser.ConfigParser()
    config["user"] = {
        "email": email,
        "name": username,
        "signingkey": str(key_path),
    }
    config["github"] = {"user": f'"{github_user}"'}
    config["commit"] = {"gpgsign": "true"}
    config["gpg"] = {"format": "ssh"}
    config["core"] = {"sshCommand": f'"ssh -i {key_path}"'}

    with gitconfig_path.open("w") as f:
        config.write(f)
    log.info(f"Created {gitconfig_path}")

    log.info(f"Generating SSH key for {profile_type}...")
    run_command(f'ssh-keygen -t ed25519 -C "{email}" -f {key_path} -N "" -q')

    log.info(f"Adding {profile_type} SSH key to agent...")
    run_command(f"ssh-add {key_path}")


def main():
    """Main execution flow for the Git configuration script."""
    log.info("Configuring Git...")
    ssh_dir = Path.home() / ".ssh"
    ssh_dir.mkdir(mode=0o700, exist_ok=True)

    # Start SSH agent
    start_ssh_agent()

    work_profile_created = False
    if prompt_user("Do you want to create a work Git profile?", default=True):
        create_profile("work", ssh_dir)
        work_profile_created = True

    create_profile("personal", ssh_dir)

    # Use configparser for the global gitconfig as well
    global_config = configparser.ConfigParser()
    global_config['includeIf "gitdir:~/personal/"'] = {
        "path": "~/personal/.gitconfig.personal"
    }
    if work_profile_created:
        global_config['includeIf "gitdir:~/work/"'] = {"path": "~/work/.gitconfig.work"}

    global_gitconfig_path = Path.home() / ".gitconfig"
    with global_gitconfig_path.open("w") as f:
        global_config.write(f)
    log.info(f"Created global git config at {global_gitconfig_path}")
    log.info(
        Text.from_markup(
            "[bold yellow]ACTION REQUIRED:[/bold yellow] Copy the contents of the .pub files in ~/.ssh and add them to your GitHub accounts."
        )
    )


if __name__ == "__main__":
    main()
