import logging
import os
import re
import shlex
import shutil
import stat
import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING

from rich.prompt import Confirm

if TYPE_CHECKING:
    from bankai.tui import TUI

# --- Logger and Global Setup ---
# log is now passed in from bankai.py
CURRENT_DIR = Path.cwd()

# --- Constants ---
STEPS = [
    "Base Dependencies",
    "AUR Helper (paru)",
    "Development Tools",
    "System Packages (pacman)",
    "Nerd Fonts",
    "Gaming Packages",
    "Flatpak Packages",
    "Fish Shell",
    "Git Configuration",
    "Terminal Setup",
    "KDE Tweaks",
    "MPV (uosc)",
    "System Services",
    "Fastfetch",
]


# URLs
RUSTUP_URL = "https://sh.rustup.rs"
PARU_AUR_URL = "https://aur.archlinux.org/paru.git"
UV_INSTALL_URL = "https://astral.sh/uv/install.sh"
FOUNDRY_INSTALL_URL = "https://foundry.paradigm.xyz"
UOSC_INSTALL_URL = (
    "https://raw.githubusercontent.com/tomasklaen/uosc/HEAD/installers/unix.sh"
)

# Paths
HOME = Path.home()
CARGO_HOME = HOME / ".cargo"
PARU_BUILD_DIR = Path("/tmp/paru")
STARSHIP_CONFIG_PATH = HOME / ".config" / "starship.toml"
FISH_CONFIG_DIR = HOME / ".config" / "fish"
PYENV_ROOT = HOME / ".pyenv"
GHOSTTY_CONFIG_DIR = HOME / ".config" / "ghostty"
FASTFETCH_CONFIG_DIR = HOME / ".config" / "fastfetch"

# Relative paths from project root
COMMON_DIR = CURRENT_DIR / "common"
CONFIGS_DIR = CURRENT_DIR / "configs"
HELPERS_DIR = CURRENT_DIR / "helpers"

PARU_APPLIST_PATH = COMMON_DIR / "paru_applist.txt"
FLATPAK_APPLIST_PATH = COMMON_DIR / "flatpacks_arch.txt"
CUSTOM_FISH_CONFIG_PATH = CONFIGS_DIR / "fish" / "config.fish"
CUSTOM_GHOSTTY_CONFIG_PATH = CONFIGS_DIR / "ghostty" / "config"
CUSTOM_FASTFETCH_CONFIG_PATH = CONFIGS_DIR / "fastfetch" / "config.jsonc"


# --- Helper Functions ---
def strip_ansi(text):
    """Removes ANSI escape sequences from a string."""
    ansi_escape = re.compile(r"(\x9B|\x1B\[)[0-?]*[ -/]*[@-~]")
    return ansi_escape.sub("", text)


def refresh_sudo(tui: "TUI"):
    """Refreshes the sudo timestamp, prompting for a password if needed."""
    tui.log_output("Checking sudo access. You may be prompted for your password.")
    try:
        # We need to run this interactively, so we pause the TUI
        tui.live.stop()
        subprocess.run(["sudo", "-v"], check=True)
        tui.live.start(refresh=True)
        tui.log_output("Sudo access confirmed.")
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        tui.live.start(refresh=True)
        tui.log_output("[bold red]Failed to acquire sudo privileges.[/bold red]")
        return False


def run_command(command, tui: "TUI", cwd=None, check=True):
    """Runs a shell command and streams its output to the TUI."""
    tui.log_output(f"[dim]Executing: {command}[/dim]")

    use_shell = "|" in command or "source" in command or "&&" in command

    try:
        process = subprocess.Popen(
            command if use_shell else shlex.split(command),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            cwd=cwd,
            shell=use_shell,
            bufsize=1,
            errors="replace",
        )

        with process.stdout:
            for line in iter(process.stdout.readline, ""):
                tui.log_output(strip_ansi(line.strip()))

        returncode = process.wait()

        if check and returncode != 0:
            tui.log_output(
                f"[yellow]Warning: Command '{command}' exited with code {returncode}[/yellow]"
            )
            return False
        return True

    except FileNotFoundError:
        tui.log_output(
            f"[bold red]Error: Command not found for: '{command}'[/bold red]"
        )
        return False
    except Exception as e:
        tui.log_output(f"[bold red]An unexpected error occurred: {e}[/bold red]")
        return False


def run_interactive_command(command, tui: "TUI", cwd=None):
    """Runs an interactive shell command by pausing the TUI."""
    tui.log_output(f"[dim]Running interactive command: {command}[/dim]")
    tui.live.stop()
    try:
        result = subprocess.run(command, shell=True, check=False, cwd=cwd)
        tui.live.start(refresh=True)
        if result.returncode != 0:
            tui.log_output(
                f"[yellow]Warning: Command '{command}' exited with code {result.returncode}[/yellow]"
            )
            return False
        return True
    except Exception as e:
        tui.live.start(refresh=True)
        tui.log_output(
            f"[bold red]An error occurred during interactive command: {e}[/bold red]"
        )
        return False


def command_exists(command):
    """Checks if a command exists in the system's PATH."""
    return shutil.which(command) is not None


def prompt_user(tui: "TUI", prompt, default=False):
    """Asks the user a yes/no question within the TUI context."""
    tui.live.stop()
    try:
        response = Confirm.ask(prompt, default=default)
    except KeyboardInterrupt:
        tui.live.start(refresh=True)
        tui.log_output("\n[yellow]Operation cancelled by user.[/yellow]")
        raise
    tui.live.start(refresh=True)
    return response


# --- Installation Functions ---
def install_base_dependencies(tui: "TUI"):
    """Installs base-devel and Rust."""
    tui.log_output("Updating system and installing base-devel...")
    run_command("sudo pacman -Syu base-devel --noconfirm", tui)

    tui.log_output("Installing Rust via rustup...")
    run_command(f"curl {RUSTUP_URL} -sSf | sh -s -- -y", tui)
    os.environ["PATH"] += f":{CARGO_HOME}/bin"

    if command_exists("pyenv"):
        tui.log_output("Configuring Pyenv for Fish...")
        run_command(
            f'fish -c "set -Ux PYENV_ROOT {PYENV_ROOT}; fish_add_path {PYENV_ROOT}/bin"',
            tui,
        )


def install_aur_helper(tui: "TUI"):
    """Installs Paru AUR helper if not present."""
    if command_exists("paru"):
        tui.log_output("Paru is already installed.")
        return
    tui.log_output("Installing paru...")
    run_interactive_command(
        (
            f"git clone {PARU_AUR_URL} {PARU_BUILD_DIR} && "
            f"cd {PARU_BUILD_DIR} && "
            "makepkg -si"
        ),
        tui,
    )


def install_dev_tools(tui: "TUI"):
    """Installs development tools like uv and Foundry."""
    if not command_exists("uv"):
        tui.log_output("Installing uv...")
        run_command(f"curl -LsSf {UV_INSTALL_URL} | sh", tui)
    else:
        tui.log_output("uv already installed.")

    if not command_exists("foundryup"):
        tui.log_output("Installing Foundry...")
        run_command(f"curl -L {FOUNDRY_INSTALL_URL} | bash", tui)
    else:
        tui.log_output("Foundry (foundryup) already installed.")


def install_packages_from_file(tui: "TUI", file_path, installer_cmd):
    """Installs packages from a text file using a specified command."""
    packages_file = Path(file_path)
    if not packages_file.is_file():
        tui.log_output(
            f"[yellow]Warning: Package file not found at {packages_file}[/yellow]"
        )
        return

    packages = [
        line.strip()
        for line in packages_file.read_text().splitlines()
        if line.strip() and not line.startswith("#")
    ]
    if packages:
        tui.log_output(f"Installing {len(packages)} packages...")
        # Use --batchinstall for non-interactive scripting
        run_command(f"{installer_cmd} --batchinstall {' '.join(packages)}", tui)


# --- Configuration Functions ---
def configure_fish_shell(tui: "TUI"):
    """Installs and configures the Fish shell and plugins."""
    if not command_exists("fish"):
        tui.log_output("Installing Fish shell...")
        run_command("paru -S fish --noconfirm", tui)

    if prompt_user(tui, "Set Fish as the default shell?", default=True):
        fish_path = shutil.which("fish")
        if fish_path:
            tui.log_output("Setting Fish as the default shell...")
            # This is interactive, so we need to handle it specially
            run_interactive_command(f"chsh -s {fish_path}", tui)
        else:
            tui.log_output("[yellow]Warning: Could not find fish executable.[/yellow]")

    tui.log_output("Installing Fisher and plugins...")
    fisher_plugins = [
        "jorgebucaran/fisher",
        "meaningful-ooo/sponge",
        "jorgebucaran/nvm.fish",
        "franciscolourenco/done",
        "joseluisq/gitnow@2.12.0",
    ]
    for plugin in fisher_plugins:
        run_command(f'fish -c "fisher install {plugin}"', tui, check=False)

    if command_exists("starship"):
        tui.log_output("Configuring Starship prompt...")
        run_command(
            f"starship preset nerd-font-symbols -o {STARSHIP_CONFIG_PATH}",
            tui,
            check=False,
        )

    FISH_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    if CUSTOM_FISH_CONFIG_PATH.is_file():
        shutil.copy(CUSTOM_FISH_CONFIG_PATH, FISH_CONFIG_DIR / "config.fish")
        tui.log_output("Copied custom fish config.")


def configure_terminals(tui: "TUI"):
    """Configures Kitty, Ghostty, and Alacritty."""
    for script_name in ["kitty.sh", "alacritty.sh"]:
        script_path = HELPERS_DIR / script_name
        if script_path.is_file():
            tui.log_output(f"Running {script_name}...")
            st = script_path.stat()
            script_path.chmod(st.st_mode | stat.S_IEXEC)
            run_command(f"bash {script_path} {str(CURRENT_DIR)}", tui)
        else:
            tui.log_output(f"Helper script not found: {script_path}")

    tui.log_output("Configuring Ghostty terminal...")
    GHOSTTY_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    if CUSTOM_GHOSTTY_CONFIG_PATH.is_file():
        shutil.copy(CUSTOM_GHOSTTY_CONFIG_PATH, GHOSTTY_CONFIG_DIR / "config")
        tui.log_output("Copied custom Ghostty config.")


def enable_services(tui: "TUI"):
    """Prompts to enable and configure system services like Bluetooth and Docker."""
    if prompt_user(tui, "Enable Bluetooth?", default=False):
        tui.log_output("Enabling Bluetooth service...")
        run_command("sudo systemctl enable --now bluetooth", tui, check=False)

    if command_exists("docker") and prompt_user(tui, "Enable Docker?", default=True):
        tui.log_output("Enabling and starting Docker service...")
        run_command("sudo systemctl enable --now docker", tui, check=False)
        user = os.getlogin()
        run_command(f"sudo usermod -aG docker {user}", tui, check=False)
        tui.log_output(
            f"[yellow]User {user} added to docker group. Please log out and back in.[/yellow]"
        )


def configure_fastfetch(tui: "TUI"):
    """Configures Fastfetch by copying the configuration file."""
    if not command_exists("fastfetch"):
        tui.log_output(
            "[yellow]Warning: Fastfetch command not found. Skipping configuration.[/yellow]"
        )
        return

    tui.log_output("Configuring Fastfetch...")
    FASTFETCH_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    if CUSTOM_FASTFETCH_CONFIG_PATH.is_file():
        shutil.copy(CUSTOM_FASTFETCH_CONFIG_PATH, FASTFETCH_CONFIG_DIR / "config.jsonc")
        tui.log_output("Fastfetch user config updated.")
    else:
        tui.log_output(
            f"[yellow]Warning: Custom Fastfetch config not found at {CUSTOM_FASTFETCH_CONFIG_PATH}[/yellow]"
        )


def configure_kde(tui: "TUI"):
    """Applies KDE-specific tweaks and configurations."""
    tui.log_output("Applying KDE Connect fix...")
    run_command("sudo iptables -I INPUT -p tcp --dport 1714:1764 -j ACCEPT", tui)
    run_command("sudo iptables -I INPUT -p udp --dport 1714:1764 -j ACCEPT", tui)
    if command_exists("ufw"):
        run_command("sudo ufw allow 1714:1764/udp", tui)
        run_command("sudo ufw allow 1714:1764/tcp", tui)
        run_command("sudo ufw reload", tui)

    if prompt_user(
        tui, "Install KDE Force Blur effect (requires build)?", default=False
    ):
        tui.log_output("Installing prerequisites for KDE Force Blur...")
        run_command(
            "paru -S base-devel git extra-cmake-modules qt6-tools --noconfirm", tui
        )
        tui.log_output("Cloning and building KDE Force Blur...")
        run_command(
            "cd /tmp && "
            "git clone https://github.com/taj-ny/kwin-effects-forceblur && "
            "cd kwin-effects-forceblur && "
            "mkdir build && cd build && "
            "cmake ../ -DCMAKE_INSTALL_PREFIX=/usr && "
            "make && sudo make install",
            tui,
            check=False,
        )


# --- Main Execution ---
def run_setup(tui: "TUI", log: "logging.Logger"):
    """Main execution flow for the CachyOS setup script."""
    with tui.task("Installing base dependencies..."):
        install_base_dependencies(tui)

    with tui.task("Installing AUR helper..."):
        install_aur_helper(tui)

    with tui.task("Installing development tools..."):
        install_dev_tools(tui)

    tui.log_output("Preparing for package installation...")
    if not refresh_sudo(tui):
        tui.log_output(
            "[bold red]Sudo authentication failed. Skipping sudo-dependent installations.[/bold red]"
        )
    else:
        with tui.task("Installing system packages..."):
            # This is now handled interactively to prevent getting stuck
            packages_file = Path(PARU_APPLIST_PATH)
            if not packages_file.is_file():
                tui.log_output(
                    f"[yellow]Warning: Package file not found at {packages_file}[/yellow]"
                )
            else:
                packages = [
                    line.strip()
                    for line in packages_file.read_text().splitlines()
                    if line.strip() and not line.startswith("#")
                ]
                if packages:
                    tui.log_output(
                        f"Handing over to paru to install {len(packages)} packages..."
                    )
                    command = f"paru -S --sudoloop {' '.join(packages)}"
                    run_interactive_command(command, tui)

        with tui.task("Installing Nerd Fonts..."):
            run_command(
                "sudo pacman -S $(pacman -Sgq nerd-fonts) --noconfirm", tui, check=False
            )

        if prompt_user(tui, "Enable gaming configuration?", default=False):
            with tui.task("Installing gaming packages..."):
                run_command(
                    "paru -S cachyos-gaming-meta cachyos-gaming-applications protonup-rs-bin --noconfirm",
                    tui,
                )
        else:
            # Advance progress bar even if skipped
            tui.skip_task("Install gaming packages")

    with tui.task("Installing Flatpak packages..."):
        # These don't require sudo, so they can run regardless.
        install_packages_from_file(
            tui,
            FLATPAK_APPLIST_PATH,
            "flatpak install --user -y flathub",
        )

    with tui.task("Configuring Fish shell..."):
        configure_fish_shell(tui)

    if prompt_user(tui, "Configure git?", default=True):
        with tui.task("Configuring git..."):
            script_path = HELPERS_DIR / "configure_git.py"
            if script_path.is_file():
                run_interactive_command(f"python3 {script_path}", tui)
            else:
                tui.log_output(
                    f"[yellow]Warning: Helper script not found: {script_path}[/yellow]"
                )
    else:
        tui.skip_task("Configure git")

    with tui.task("Configuring terminals..."):
        configure_terminals(tui)

    with tui.task("Configuring KDE..."):
        configure_kde(tui)

    with tui.task("Installing uosc for MPV..."):
        run_command(f'bash -c "$(curl -fsSL {UOSC_INSTALL_URL})"', tui)

    with tui.task("Enabling system services..."):
        enable_services(tui)

    with tui.task("Configuring Fastfetch..."):
        configure_fastfetch(tui)

    tui.log_output(
        "[bold green]CachyOS setup finished. Please restart your terminal or log out.[/bold green]"
    )
