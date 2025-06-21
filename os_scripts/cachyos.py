import logging
import subprocess
import sys
from pathlib import Path
import shutil
import os

from .utils import run_command, command_exists

log = logging.getLogger("bankai")


def install_paru():
    """Installs paru AUR helper if not present."""
    if command_exists("paru"):
        log.info("Paru is already installed.")
        return
    log.info("Installing paru...")
    run_command(
        "git clone https://aur.archlinux.org/paru.git /tmp/paru && "
        "cd /tmp/paru && "
        "makepkg -si --noconfirm"
    )


def install_packages_from_file(file_path):
    """Installs packages using paru from a text file."""
    packages_file = Path(file_path)
    if not packages_file.is_file():
        log.warning(f"Package file not found at {packages_file}")
        return

    with open(packages_file, "r") as f:
        packages = [
            line.strip() for line in f if line.strip() and not line.startswith("#")
        ]

    if packages:
        log.info(f"Installing packages: {', '.join(packages)}")
        run_command(f"paru -S --noconfirm --sudoloop {' '.join(packages)}")


def install_flatpaks_from_file(file_path):
    """Installs flatpaks from a text file."""
    flatpaks_file = Path(file_path)
    if not flatpaks_file.is_file():
        log.warning(f"Flatpak list not found at {flatpaks_file}")
        return

    run_command(
        "flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo"
    )

    with open(flatpaks_file, "r") as f:
        flatpaks = [
            line.strip() for line in f if line.strip() and not line.startswith("#")
        ]

    if flatpaks:
        log.info(f"Installing flatpaks: {', '.join(flatpaks)}")
        run_command(f"flatpak install --user -y flathub {' '.join(flatpaks)}")


def setup_fish_shell():
    """Installs and configures fish shell."""
    log.info("Setting up fish shell...")
    if not command_exists("fish"):
        run_command("paru -S fish --noconfirm")

    # Set fish as default shell
    fish_path = shutil.which("fish")
    if not fish_path:
        log.error("Could not find the fish executable after attempting to install.")
        return

    try:
        user = os.getlogin()
        log.info(f"Setting Fish as the default shell for user {user}...")
        command = f"sudo chsh -s {fish_path} {user}"
        if not run_command(command):
            log.warning(
                "Failed to set Fish as default shell. It might require manual intervention."
            )
    except Exception as e:
        log.error(f"An unexpected error occurred while setting fish shell: {e}")

    # Install fisher and plugins
    fisher_plugins = [
        "jorgebucaran/fisher",
        "meaningful-ooo/sponge",
        "jorgebucaran/nvm.fish",
        "franciscolourenco/done",
        "joseluisq/gitnow@2.12.0",
    ]
    for plugin in fisher_plugins:
        run_command(f'fish -c "fisher install {plugin}"')


def main():
    """Main execution for cachyos setup."""
    log.info("Starting CachyOS setup...")

    # System update and base-devel
    run_command("sudo pacman -Syu base-devel --noconfirm")

    # Install paru
    install_paru()

    # Install packages
    install_packages_from_file("common/paru_applist.txt")

    # Install flatpaks
    install_flatpaks_from_file("common/flatpacks_arch.txt")

    # Setup fish
    setup_fish_shell()

    log.info("CachyOS setup finished.")


if __name__ == "__main__":
    main()
