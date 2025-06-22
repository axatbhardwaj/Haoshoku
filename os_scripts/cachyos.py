import logging
import os
import re
import shlex
import shutil
import stat
import subprocess
import sys
from pathlib import Path

from rich.prompt import Confirm, Prompt
from rich.text import Text

# --- Logger and Global Setup ---
log = logging.getLogger("bankai")
CURRENT_DIR = Path.cwd()

# --- Constants ---
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
KITTY_CONFIG_DIR = HOME / ".config" / "kitty"
ALACRITTY_CONFIG_DIR = HOME / ".config" / "alacritty"

# Relative paths from project root
COMMON_DIR = CURRENT_DIR / "common"
CONFIGS_DIR = CURRENT_DIR / "configs"
HELPERS_DIR = CURRENT_DIR / "helpers"

PARU_APPLIST_PATH = COMMON_DIR / "paru_applist.txt"
FLATPAK_APPLIST_PATH = COMMON_DIR / "flatpacks_arch.txt"
CUSTOM_FISH_CONFIG_PATH = CONFIGS_DIR / "fish" / "config.fish"
CUSTOM_GHOSTTY_CONFIG_PATH = CONFIGS_DIR / "ghostty" / "config"
CUSTOM_FASTFETCH_CONFIG_PATH = CONFIGS_DIR / "fastfetch" / "config.jsonc"
CUSTOM_KITTY_CONFIG_PATH = CONFIGS_DIR / "kitty" / "kitty.conf"
CUSTOM_ALACRITTY_CONFIG_PATH = CONFIGS_DIR / "alacritty" / "alacritty.toml"


# --- Helper Functions ---
def strip_ansi(text):
    """Removes ANSI escape sequences from a string."""
    ansi_escape = re.compile(r"(\x9B|\x1B\[)[0-?]*[ -/]*[@-~]")
    return ansi_escape.sub("", text)


def refresh_sudo():
    """Refreshes the sudo timestamp, prompting for a password if needed."""
    log.info("Checking sudo access. You may be prompted for your password.")
    try:
        subprocess.run(["sudo", "-v"], check=True)
        log.info("Sudo access confirmed.")
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        log.error("Failed to acquire sudo privileges.")
        return False


def run_command(command, cwd=None, check=True):
    """Runs a shell command, streaming its output or running it interactively."""
    log.info(Text.from_markup(f"[dim]Executing: {command}[/dim]"))

    interactive_markers = ["sudo", "chsh", "makepkg -si", "ssh-add", "configure_git.py"]
    is_interactive = any(marker in command for marker in interactive_markers)

    try:
        if is_interactive and "sudo -v" not in command:
            # For interactive commands, run without redirecting I/O to allow prompts.
            result = subprocess.run(command, cwd=cwd, shell=True, check=check)
            return result.returncode == 0

        # For non-interactive commands, stream output.
        use_shell = "|" in command or "source" in command or "&&" in command

        if use_shell:
            cmd_to_run = command
        else:
            cmd_to_run = shlex.split(command)
            # Use stdbuf to force line-buffering for better TUI updates.
            if shutil.which("stdbuf"):
                cmd_to_run = ["stdbuf", "-oL"] + cmd_to_run

        process = subprocess.Popen(
            cmd_to_run,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            cwd=cwd,
            shell=use_shell,
            bufsize=1,  # Line-buffered
            errors="replace",
        )

        with process.stdout:
            for line in iter(process.stdout.readline, ""):
                log.info(strip_ansi(line.strip()))

        returncode = process.wait()

        if check and returncode != 0:
            log.warning(f"Command '{command}' exited with code {returncode}")
            return False
        return True

    except subprocess.CalledProcessError as e:
        log.warning(
            f"Interactive command '{command}' failed with exit code {e.returncode}."
        )
        return False
    except FileNotFoundError:
        log.error(f"Command not found for: '{command}'")
        return False
    except Exception as e:
        log.error(f"An unexpected error occurred while running '{command}': {e}")
        return False


def command_exists(command):
    """Checks if a command exists in the system's PATH."""
    return shutil.which(command) is not None


def prompt_user(prompt, default=False):
    """Asks the user a yes/no question, handling Ctrl+C gracefully."""
    try:
        return Confirm.ask(prompt, default=default)
    except KeyboardInterrupt:
        log.warning("\nOperation cancelled by user.")
        sys.exit(1)


# --- Installation Functions ---
def install_base_dependencies():
    """Installs base-devel and Rust."""
    log.info("Updating system and installing base-devel...")
    run_command("sudo pacman -Syu base-devel --noconfirm")

    log.info("Installing Rust via rustup...")
    run_command(f"curl {RUSTUP_URL} -sSf | sh -s -- -y")
    os.environ["PATH"] += f":{CARGO_HOME}/bin"

    if command_exists("pyenv"):
        log.info("Configuring Pyenv for Fish...")
        run_command(
            f'fish -c "set -Ux PYENV_ROOT {PYENV_ROOT}; fish_add_path {PYENV_ROOT}/bin"'
        )


def install_aur_helper():
    """Installs Paru AUR helper if not present."""
    if command_exists("paru"):
        log.info("Paru is already installed.")
        return
    log.info("Installing paru...")
    run_command(
        f"git clone {PARU_AUR_URL} {PARU_BUILD_DIR} && "
        f"cd {PARU_BUILD_DIR} && "
        "makepkg -si --noconfirm",
        check=False,
    )


def install_dev_tools():
    """Installs development tools like uv and Foundry."""
    if not command_exists("uv"):
        log.info("Installing uv...")
        run_command(f"curl -LsSf {UV_INSTALL_URL} | sh")
    else:
        log.info("uv already installed.")

    if not command_exists("foundryup"):
        log.info("Installing Foundry...")
        run_command(f"curl -L {FOUNDRY_INSTALL_URL} | bash")
    else:
        log.info("Foundry (foundryup) already installed.")


def install_packages_from_file(file_path, installer_cmd):
    """Installs packages from a text file using a specified command."""
    packages_file = Path(file_path)
    if not packages_file.is_file():
        log.warning(f"Package file not found at {packages_file}")
        return

    packages = [
        line.strip()
        for line in packages_file.read_text().splitlines()
        if line.strip() and not line.startswith("#")
    ]
    if packages:
        log.info(f"Installing {len(packages)} packages...")
        run_command(f"{installer_cmd} {' '.join(packages)}")


# --- Configuration Functions ---
def configure_fish_shell():
    """Installs and configures the Fish shell and plugins."""
    if not command_exists("fish"):
        log.info("Installing Fish shell...")
        run_command("paru -S fish --noconfirm")

    if prompt_user("Set Fish as the default shell?", default=True):
        fish_path = shutil.which("fish")
        if fish_path:
            log.info("Setting Fish as the default shell...")
            run_command(f"chsh -s {fish_path}", check=False)
        else:
            log.warning("Could not find fish executable.")

    log.info("Installing Fisher and plugins...")
    fisher_plugins = [
        "jorgebucaran/fisher",
        "meaningful-ooo/sponge",
        "jorgebucaran/nvm.fish",
        "franciscolourenco/done",
        "joseluisq/gitnow@2.12.0",
    ]
    for plugin in fisher_plugins:
        run_command(f'fish -c "fisher install {plugin}"', check=False)

    if command_exists("starship"):
        log.info("Configuring Starship prompt...")
        run_command(
            f"starship preset nerd-font-symbols -o {STARSHIP_CONFIG_PATH}", check=False
        )

    FISH_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    if CUSTOM_FISH_CONFIG_PATH.is_file():
        shutil.copy(CUSTOM_FISH_CONFIG_PATH, FISH_CONFIG_DIR / "config.fish")
        log.info("Copied custom fish config.")


def configure_terminals():
    """Configures Kitty, Ghostty, and Alacritty."""
    log.info("Configuring Kitty terminal...")
    KITTY_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    if CUSTOM_KITTY_CONFIG_PATH.is_file():
        shutil.copy(CUSTOM_KITTY_CONFIG_PATH, KITTY_CONFIG_DIR / "kitty.conf")
        log.info("Copied custom Kitty config.")
    else:
        log.warning(f"Custom Kitty config not found at {CUSTOM_KITTY_CONFIG_PATH}")

    log.info("Configuring Alacritty terminal...")
    ALACRITTY_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    if CUSTOM_ALACRITTY_CONFIG_PATH.is_file():
        shutil.copy(
            CUSTOM_ALACRITTY_CONFIG_PATH, ALACRITTY_CONFIG_DIR / "alacritty.toml"
        )
        log.info("Copied custom Alacritty config.")
    else:
        log.warning(
            f"Custom Alacritty config not found at {CUSTOM_ALACRITTY_CONFIG_PATH}"
        )

    log.info("Configuring Ghostty terminal...")
    GHOSTTY_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    if CUSTOM_GHOSTTY_CONFIG_PATH.is_file():
        shutil.copy(CUSTOM_GHOSTTY_CONFIG_PATH, GHOSTTY_CONFIG_DIR / "config")
        log.info("Copied custom Ghostty config.")


def enable_services():
    """Prompts to enable and configure system services like Bluetooth and Docker."""
    if prompt_user("Enable Bluetooth?", default=False):
        log.info("Enabling Bluetooth service...")
        run_command("sudo systemctl enable --now bluetooth", check=False)

    if command_exists("docker") and prompt_user("Enable Docker?", default=True):
        log.info("Enabling and starting Docker service...")
        run_command("sudo systemctl enable --now docker", check=False)
        user = os.getlogin()
        run_command(f"sudo usermod -aG docker {user}", check=False)
        log.warning(f"User {user} added to docker group. Please log out and back in.")


def configure_fastfetch():
    """Configures Fastfetch by copying the configuration file."""
    if not command_exists("fastfetch"):
        log.warning("Fastfetch command not found. Skipping configuration.")
        return

    log.info("Configuring Fastfetch...")
    FASTFETCH_CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    if CUSTOM_FASTFETCH_CONFIG_PATH.is_file():
        shutil.copy(CUSTOM_FASTFETCH_CONFIG_PATH, FASTFETCH_CONFIG_DIR / "config.jsonc")
        log.info("Fastfetch user config updated.")
    else:
        log.warning(
            f"Custom Fastfetch config not found at {CUSTOM_FASTFETCH_CONFIG_PATH}"
        )


def configure_kde():
    """Applies KDE-specific tweaks and configurations."""
    log.info("Applying KDE Connect fix...")
    run_command("sudo iptables -I INPUT -p tcp --dport 1714:1764 -j ACCEPT")
    run_command("sudo iptables -I INPUT -p udp --dport 1714:1764 -j ACCEPT")
    if command_exists("ufw"):
        run_command("sudo ufw allow 1714:1764/udp")
        run_command("sudo ufw allow 1714:1764/tcp")
        run_command("sudo ufw reload")

    if prompt_user("Install KDE Force Blur effect (requires build)?", default=False):
        log.info("Installing prerequisites for KDE Force Blur...")
        run_command("paru -S base-devel git extra-cmake-modules qt6-tools --noconfirm")
        log.info("Cloning and building KDE Force Blur...")
        run_command(
            "cd /tmp && "
            "git clone https://github.com/taj-ny/kwin-effects-forceblur && "
            "cd kwin-effects-forceblur && "
            "mkdir build && cd build && "
            "cmake ../ -DCMAKE_INSTALL_PREFIX=/usr && "
            "make && sudo make install",
            check=False,
        )


# --- Main Execution ---
def main():
    """Main execution flow for the CachyOS setup script."""
    install_base_dependencies()
    install_aur_helper()
    install_dev_tools()

    log.info("Preparing for package installation...")
    if not refresh_sudo():
        log.error("Sudo authentication failed. Skipping sudo-dependent installations.")
    else:
        log.info("Installing packages from file lists...")
        install_packages_from_file(
            PARU_APPLIST_PATH,
            "paru -S --noconfirm --sudoloop --batchinstall",
        )

        log.info("Installing Nerd Fonts...")
        run_command("sudo pacman -S $(pacman -Sgq nerd-fonts) --noconfirm", check=False)

        if prompt_user("Enable gaming configuration?", default=False):
            run_command(
                "paru -S cachyos-gaming-meta cachyos-gaming-applications protonup-rs-bin --noconfirm"
            )
    # These don't require sudo, so they can run regardless.
    install_packages_from_file(
        FLATPAK_APPLIST_PATH,
        "flatpak install --user -y flathub",
    )

    configure_fish_shell()

    if prompt_user("Configure git?", default=True):
        script_path = HELPERS_DIR / "configure_git.py"
        if script_path.is_file():
            run_command(f"python3 {script_path}")
        else:
            log.warning(f"Helper script not found: {script_path}")

    configure_terminals()
    configure_kde()

    log.info("Installing uosc for MPV...")
    run_command(f"curl -fsSL {UOSC_INSTALL_URL} | bash")

    enable_services()
    configure_fastfetch()

    log.info(
        Text.from_markup(
            "[bold green]CachyOS setup finished. Please restart your terminal or log out.[/bold green]"
        )
    )


if __name__ == "__main__":
    # When running the script directly, configure a basic logger.
    from rich.console import Console
    from rich.logging import RichHandler

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
    main()
