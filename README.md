# Bankai Linux Setup (inspired by the anime "Bleach")

**Quickest Start (no clone needed):**
```bash
curl -sSL https://raw.githubusercontent.com/axatbhardwaj/bankai/stable/bankai.sh | bash
```
- You can also pass arguments, e.g.:
  ```bash
  curl -sSL https://raw.githubusercontent.com/axatbhardwaj/bankai/stable/bankai.sh | bash --os kubuntu
  ```

Bankai is a modular, multi-distro Linux setup and configuration toolkit. It automates the installation of essential applications, developer tools, terminal configs, and user environment tweaks for several popular Linux distributions.

## Supported Distributions
- **CachyOS / Arch-based** (`cachyos.sh`)
- **Kubuntu / Debian / Ubuntu** (`kubuntu.sh`)
- **Nobara / Fedora** (`nobara.sh`)

## Features
- Automated installation of system packages, Flatpaks, and (where supported) Snaps
- Terminal and shell configuration (Fish, Starship, Fisher, etc.)
- IDEs, developer tools, and language managers (Rust, Node, Python, etc.)
- Optional gaming, Docker, and other productivity enhancements
- Modular config files for terminals (Kitty, Alacritty, Ghostty, Fastfetch)
- Git and SSH setup helper

## Directory Structure
```
configs/         # Terminal and shell config templates
common/          # Shared package lists (apt, dnf, paru, flatpak, snap)
helpers/         # Helper scripts for configuring terminals, git, etc.
icons/           # (Optional) Icon resources
bankai.sh        # Main entrypoint script (auto-detects or prompts for OS)
cachyos.sh       # Arch/CachyOS setup script
kubuntu.sh       # Kubuntu/Debian/Ubuntu setup script
nobara.sh        # Nobara/Fedora setup script
```

## Quick Start
1. **Clone the repository:**
   ```bash
   git clone https://github.com/axatbhardwaj/bankai.git
   cd bankai
   ```
2. **Run the main script:**
   ```bash
   ./bankai.sh
   ```
   - The script will auto-detect your OS or prompt you to select one.
   - You can specify the OS directly:
     ```bash
     ./bankai.sh --os cachyos   # or kubuntu, nobara
     ```
   - Any extra arguments will be passed to the OS-specific script.

3. **Follow prompts** for optional installs (gaming, Docker, Fish shell, etc.).

## Customization
- **Edit package lists:**
  - `common/paru_applist.txt` (CachyOS/Arch)
  - `common/apt_applist.txt` (Kubuntu/Debian/Ubuntu)
  - `common/dnf_applist.txt` (Nobara/Fedora)
  - `common/flatpacks.txt`, `common/flatpacks_arch.txt`, `common/snap_applist.txt`
- **Edit configs:**
  - Terminal and shell configs in `configs/`
- **Add/modify helper scripts:**
  - For custom terminal or git setup, see `helpers/`

## Notes
- Some steps require sudo privileges.
- The scripts are modular: you can run the OS-specific scripts directly if desired.
- Review and edit the package lists and configs to suit your needs before running.
- After running, a system restart or re-login is recommended for all changes to take effect.

## License
MIT (see repository) 