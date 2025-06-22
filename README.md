# Bankai Linux Setup (inspired by the anime "Bleach")

**Quick Start:**
```bash
pipx install bankai
bankai
```

Bankai is a modular, multi-distro Linux setup and configuration toolkit. It automates the installation of essential applications, developer tools, terminal configs, and user environment tweaks for several popular Linux distributions.

## Supported Distributions
- **CachyOS / Arch-based**
- **Kubuntu / Debian / Ubuntu**
- **Nobara / Fedora**

> [!NOTE]
> The current release is primarily focused on and tested with Arch-based distributions like CachyOS. , the plan for other distributions is to have them working as well, but it's not a priority. and does not work in this release.

## Features
- Automated installation of system packages and Flatpaks.
- Terminal and shell configuration (Fish, Starship, Fisher, etc.)
- IDEs, developer tools, and language managers (Rust, Node, Python, etc.)
- Optional gaming, Docker, and other productivity enhancements
- Modular config files for terminals (Kitty, Alacritty, Ghostty, Fastfetch)
- Git and SSH setup helper

## Usage
After installation, simply run the main command:
```bash
bankai
```
- The script will auto-detect your OS or prompt you to select one.
- You can specify the OS directly:
  ```bash
  bankai --os cachyos   # or kubuntu, nobara
  ```
- Any extra arguments will be passed to the OS-specific script by adding `--` before them:
  ```bash
  bankai --os cachyos -- --some-arg
  ```
- Follow the prompts for optional installs (gaming, Docker, Fish shell, etc.).

## Notes
- `pipx` is the recommended tool for installing command-line applications like Bankai, as it isolates them in their own environments. You can install it via `pip install pipx`.
- Some steps will require `sudo` privileges. The script will prompt you for your password when needed.
- A system restart or re-login is recommended for all changes to take effect.

## For Developers (Contributing)

If you want to contribute or customize the scripts, you can clone the repository:
```bash
git clone https://github.com/axatbhardwaj/bankai.git
cd bankai
# Recommended: create a virtual environment
python -m venv .venv
source .venv/bin/activate
# Install in editable mode
pip install -e .
# Now you can run your local version
bankai
```

- **Package lists** are in `common/`
- **Configuration templates** are in `configs/`
- **OS-specific logic** is in `os_scripts/`


## License
MIT (see repository) 