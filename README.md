![Haoshoku Logo](icons/Gemini_Generated_Image_kwrza7kwrza7kwrz.png)

# Haoshoku: Color of the Supreme King

**Quick Start:**
```bash
# Install via npm (v2.0.0+)
npm install -g haoshoku

# Or run directly with Bun
git clone https://github.com/axatbhardwaj/bankai.git
cd bankai
bun install
bun haoshoku.js
```

**Haoshoku** (formerly Bankai) is a modular, multi-distro Linux setup and configuration toolkit. It automates the installation of essential applications, developer tools, terminal configs, and user environment tweaks.

> [!NOTE]
> **Haoshoku** (referencing ["Supreme King Haki"](https://onepiece.fandom.com/wiki/Haki/Supreme_King_Haki) from *One Piece*) serves as an authoritative configuration manager, enforcing a strict and consistent environment setup across your Linux systems.

> [!IMPORTANT]
> **Rebranding & Migration**: This project was previously known as **Bankai** and was available on **PyPI** (Python). It has been renamed to **Haoshoku** and is now available on **NPM** (JavaScript/Bun).
>
> Please uninstall any old Python versions (`pipx uninstall bankai`) before installing the new version.

## Supported Distributions
- **CachyOS / Arch-based** (Primary support)
- **Debian Server** (New in v2.0.0)

## Features
- Automated installation of system packages and Flatpaks.
- Terminal and shell configuration (Fish, Starship, Fisher, etc.)
- IDEs, developer tools, and language managers (Rust, Node, Python, etc.)
- Optional gaming, Docker, and other productivity enhancements
- Modular config files for terminals (Kitty, Alacritty, Ghostty, Fastfetch)
- Git and SSH setup helper
- **OS Auto-detection**: Automatically detects your OS (CachyOS or Debian) and runs the appropriate setup.

## Usage
If installed globally via npm:
```bash
haoshoku
```

If running from source with Bun:
```bash
bun haoshoku.js
```

- The script will auto-detect your OS.
- You can specify the OS directly:
  ```bash
  haoshoku --os cachyos
  # or
  bun haoshoku.js --os debian-server
  ```

## For Developers (Contributing)

If you want to contribute or customize the scripts:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/axatbhardwaj/bankai.git
   cd bankai
   ```

2. **Install dependencies:**
   ```bash
   bun install
   ```

3. **Run locally:**
   ```bash
   bun haoshoku.js
   ```

- **Package lists** are in `common/`
- **Configuration templates** are in `configs/`
- **OS-specific logic** is in `src/os_scripts/`
- **Helpers** are in `src/helpers/`

## License
MIT (see repository) 