import logging
import subprocess
import sys
from pathlib import Path

log = logging.getLogger("bankai")


def run_command(command, check=True):
    """A wrapper to run shell commands."""
    try:
        subprocess.run(command, check=check, shell=True, text=True)
    except subprocess.CalledProcessError as e:
        log.warning(f"Command failed: {e}")
    except FileNotFoundError:
        log.warning(f"Command not found: {command}")


def command_exists(command):
    """Check if a command exists."""
    return (
        subprocess.run(
            f"command -v {command}", shell=True, capture_output=True
        ).returncode
        == 0
    )


def initial_setup():
    """Performs initial system updates and upgrades."""
    log.info("Performing initial system setup...")
    run_command("sudo apt update")
    run_command("sudo apt upgrade -y")
    run_command("sudo ubuntu-drivers autoinstall")
    run_command("sudo apt install -y curl wget git")


def install_packages_from_file(file_path, installer):
    """Installs packages from a file using the specified installer."""
    packages_file = Path(file_path)
    if not packages_file.is_file():
        log.warning(f"Package file not found at {packages_file}")
        return

    with open(packages_file, "r") as f:
        packages = [
            line.strip() for line in f if line.strip() and not line.startswith("#")
        ]

    if not packages:
        return

    log.info(f"Installing packages via {installer}: {', '.join(packages)}")
    if installer == "apt":
        run_command(f"sudo apt install -y {' '.join(packages)}")
    elif installer == "flatpak":
        run_command(
            "sudo flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo"
        )
        run_command(f"flatpak install -y flathub {' '.join(packages)}")
    elif installer == "snap":
        for pkg in packages:
            run_command(f"sudo snap install {pkg}")


def setup_brave():
    """Installs Brave Browser."""
    if not command_exists("brave-browser"):
        log.info("Installing Brave Browser...")
        run_command("curl -fsS https://dl.brave.com/install.sh | sh")
    else:
        log.info("Brave Browser already installed.")


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


def setup_docker():
    """Installs and configures Docker."""
    if not command_exists("docker"):
        log.info("Setting up Docker...")
        run_command(
            """
            sudo install -m 0755 -d /etc/apt/keyrings
            curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
            sudo chmod a+r /etc/apt/keyrings/docker.gpg
            echo \\
              "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \\
              $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \\
              sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
            sudo apt update
            sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
            sudo systemctl enable docker
            sudo systemctl start docker
            sudo usermod -aG docker $USER
            """
        )
        log.warning("User added to docker group. You may need to log out and back in.")
    else:
        log.info("Docker already installed.")


def main():
    """Main execution for Kubuntu setup."""
    log.info("Starting Kubuntu setup...")

    initial_setup()

    # Install applications from lists
    install_packages_from_file("common/apt_applist.txt", "apt")
    install_packages_from_file("common/flatpacks.txt", "flatpak")
    install_packages_from_file("common/snap_applist.txt", "snap")

    # Install specific applications
    setup_brave()
    setup_rust()
    setup_uv()
    setup_docker()

    log.info("Kubuntu setup finished.")


if __name__ == "__main__":
    main()
