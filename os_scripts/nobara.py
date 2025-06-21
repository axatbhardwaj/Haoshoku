import logging
import subprocess
from pathlib import Path

from .utils import run_command, command_exists

log = logging.getLogger("bankai")


def initial_setup():
    """Performs initial system updates and installs essential packages."""
    log.info("Updating system packages...")
    run_command("sudo dnf update -y")
    log.info("Installing essential packages (curl, wget, git)...")
    run_command("sudo dnf install -y curl wget git")


def install_packages_from_file(file_path):
    """Installs packages from a file using dnf."""
    packages_file = Path(file_path)
    if not packages_file.is_file():
        log.warning(f"Package file not found at {packages_file}")
        return []

    with open(packages_file, "r") as f:
        packages = [
            line.strip() for line in f if line.strip() and not line.startswith("#")
        ]

    if packages:
        log.info(f"Installing DNF packages: {', '.join(packages)}")
        run_command(f"sudo dnf install -y {' '.join(packages)}")
    return packages


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


def setup_rust():
    """Installs Rust."""
    if not command_exists("rustc"):
        log.info("Installing Rust...")
        run_command("curl https://sh.rustup.rs -sSf | sh -s -- -y")
    else:
        log.info("Rust already installed.")


def setup_uv():
    """Installs the 'uv' Python package manager."""
    if not command_exists("uv"):
        log.info("Installing uv...")
        run_command("curl -LsSf https://astral.sh/uv/install.sh | sh")
    else:
        log.info("uv already installed.")


def setup_docker(dnf_packages):
    """Installs and configures Docker if requested."""
    docker_requested = any(p.startswith("docker-ce") for p in dnf_packages)
    if not docker_requested:
        log.info("Docker not in DNF list, skipping setup.")
        return

    if not command_exists("docker"):
        log.info("Setting up Docker repository...")
        if (
            subprocess.run(
                "dnf repolist | grep -q docker-ce-stable", shell=True
            ).returncode
            != 0
        ):
            run_command(
                "sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo"
            )

        # The package should have been installed via the list, now configure it.
        if command_exists("docker"):
            log.info("Configuring Docker service...")
            run_command("sudo systemctl enable --now docker")
            run_command("sudo usermod -aG docker $USER")
            log.warning(
                "User added to docker group. You may need to log out and back in."
            )
    else:
        log.info("Docker already installed.")


def main():
    """Main execution for Nobara setup."""
    log.info("Starting Nobara Linux setup...")

    initial_setup()
    setup_rust()
    setup_uv()

    dnf_packages = install_packages_from_file("common/dnf_applist.txt")
    install_flatpaks_from_file("common/flatpacks.txt")

    setup_docker(dnf_packages)

    log.info("Nobara Linux setup finished.")


if __name__ == "__main__":
    main()
