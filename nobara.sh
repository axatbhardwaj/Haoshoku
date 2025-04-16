#!/bin/bash
# Nobara Linux Setup Script (Arch Style)
# ======================================
# This script automates the setup of applications and configurations 
# on Nobara Linux, similar in structure to an Arch setup script.

set -e  # Exit on error

# --- Variables & Helper Functions ---
CURRENT_DIR=$(pwd)
APPLIST_FILE="$CURRENT_DIR/common/dnf_applist.txt"
FLATPAKLIST_FILE="$CURRENT_DIR/common/flatpacks.txt"
FISH_CONFIG_DIR="$HOME/.config/fish"
FASTFETCH_CONFIG_DIR="$HOME/.config/fastfetch"
KITTY_CONFIG_DIR="$HOME/.config/kitty"
ALACRITTY_CONFIG_DIR="$HOME/.config/alacritty"
GHOSTTY_CONFIG_DIR="$HOME/.config/ghostty"
SPICETIFY_CONFIG_DIR="$HOME/.config/spicetify"

print_info() {
    echo "INFO: $1"
}

print_warning() {
    echo "WARNING: $1"
}

print_error() {
    echo "ERROR: $1" >&2
    exit 1
}

# Function to check if a command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# Ensure the script is run with bash
if [ -z "$BASH_VERSION" ]; then
    echo "Please run this script with bash."
    exit 1
fi

# --- Initial System Setup & Core Tools ---
print_info "Updating system packages..."
sudo dnf update -y

print_info "Installing essential packages (curl, wget, git)..."
sudo dnf install -y curl wget git

print_info "Installing Development Tools group..."
sudo dnf groupinstall -y "Development Tools" # Equiv. to base-devel

print_info "Installing Rust via rustup..."
if ! command_exists rustc; then
    curl https://sh.rustup.rs -sSf | sh -s -- -y --profile default --default-toolchain stable
    source "$HOME/.cargo/env" # Source for the current script session
    print_info "Rust installed. Please source ~/.cargo/env in your shell or restart."
else
    print_info "Rust (rustc) already installed."
fi

print_info "Installing uv package manager..."
if ! command_exists uv; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
    source "$HOME/.cargo/env" # Ensure PATH includes ~/.cargo/bin for uv
    print_info "uv installed. Please source ~/.cargo/env in your shell or restart."
else
    print_info "uv already installed."
fi

# --- Application Installation Function ---
install_apps() {
    print_info "--- Starting Application Installation Phase ---"

    # --- Flatpak Setup ---
    print_info "Ensuring Flatpak (user) and Flathub are configured..."
    if ! command_exists flatpak; then
        print_info "Flatpak command not found, installing system-wide..."
        sudo dnf install -y flatpak
    fi
    print_info "Adding Flathub repository for current user..."
    flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
    print_info "Updating user Flatpak applications..."
    flatpak update --user -y

    # --- Process DNF dnf_applist.txt ---
    print_info "Processing DNF package list from $APPLIST_FILE..."
    if [ ! -f "$APPLIST_FILE" ]; then
        print_warning "$APPLIST_FILE not found! Skipping DNF installations from list."
        declare -g -a dnf_packages=() # Ensure array is declared even if file missing
    else
        # Read DNF packages from dnf_applist.txt
        mapfile -t dnf_packages_raw < <(grep -vE '^#|^$' "$APPLIST_FILE" || true) # Read non-empty, non-comment lines
        # Make global and clean up whitespace (though mapfile shouldn't add much)
        declare -g -a dnf_packages=() 
        for pkg in "${dnf_packages_raw[@]}"; do
            dnf_packages+=($(echo $pkg)) # Simple whitespace cleaning
        done
        
        # Install DNF packages
        if [ ${#dnf_packages[@]} -gt 0 ]; then
            print_info "Installing DNF packages: ${dnf_packages[*]}"
            sudo dnf install -y "${dnf_packages[@]}" || print_warning "Failed to install some DNF packages."
        else
            print_info "No DNF packages specified in $APPLIST_FILE."
        fi
    fi

    # --- Process Flatpak flatpacks.txt ---
    print_info "Processing Flatpak package list from $FLATPAKLIST_FILE..."
    if [ ! -f "$FLATPAKLIST_FILE" ]; then
        print_warning "$FLATPAKLIST_FILE not found! Skipping Flatpak installations from list."
        declare -g -a flatpak_packages=() # Ensure array is declared even if file missing
    else
         # Read Flatpak IDs from flatpacks.txt
        mapfile -t flatpak_packages_raw < <(grep -vE '^#|^$' "$FLATPAKLIST_FILE" || true)
        # Make global and clean up
        declare -g -a flatpak_packages=()
        for pkg_id in "${flatpak_packages_raw[@]}"; do
            flatpak_packages+=($(echo $pkg_id))
        done
        
        # Install Flatpak packages for the user
        if [ ${#flatpak_packages[@]} -gt 0 ]; then
            print_info "Installing Flatpak packages for user: ${flatpak_packages[*]}"
            flatpak install --user -y flathub "${flatpak_packages[@]}" || print_warning "Failed to install some Flatpak packages."
        else
            print_info "No Flatpak packages specified in $FLATPAKLIST_FILE."
        fi
    fi

    print_info "--- Application Installation Phase Complete ---"
}

# --- Execute Application Installation ---
install_apps # Call the function


# --- Specific Installers & Repo Setups (Triggered by DNF list) ---

# Setup Vivaldi repo if requested in DNF list
if [[ " ${dnf_packages[@]} " =~ " vivaldi-stable " ]]; then
    print_info "Setting up Vivaldi repository..."
    if ! dnf list installed vivaldi-stable &> /dev/null; then
        sudo dnf config-manager --add-repo https://repo.vivaldi.com/archive/vivaldi-fedora.repo
        # Installation should have happened during main DNF install phase
        print_info "Vivaldi repository added. Package should be installed."
    else
        print_info "Vivaldi already installed."
    fi
else
     print_info "Vivaldi not listed in DNF package list ($APPLIST_FILE). Skipping repo setup."
fi

# Docker repository setup (triggered if docker-ce* is in DNF list)
# Check if any package starting with docker-ce was in the dnf_packages list
docker_requested=false
for pkg in "${dnf_packages[@]}"; do
    if [[ "$pkg" == docker-ce* ]]; then
        docker_requested=true
        break
    fi
done

if $docker_requested; then
    print_info "Setting up Docker repository (if needed)..."
    if ! command_exists docker; then
        if ! dnf repolist | grep -q docker-ce-stable; then
             sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
        fi
        print_info "Docker repository added/exists. Packages should be installed via DNF list."
        # Setup services after install
        if command_exists docker; then
            print_info "Enabling and starting Docker service after installation..."
            sudo systemctl enable docker
            sudo systemctl start docker
            if ! groups $USER | grep -q '\bdocker\b'; then
                 sudo usermod -aG docker $USER
                 print_warning "Added user $USER to docker group. Log out and log back in required."
            fi
        else
            print_warning "Docker command still not found after repo setup and DNF install attempt."
        fi
    else
        print_info "Docker already installed. Configuration handled in Docker Enablement section later."
    fi
else
     print_info "Docker not listed in DNF package list ($APPLIST_FILE). Skipping repo setup."
fi

# --- Manual Installers (Prompt user) ---

# Foundry
if ! command_exists foundryup; then
    read -p "Install Foundry toolchain (foundryup)? (y/n): " install_foundry
    if [[ "$install_foundry" =~ ^[Yy]$ ]]; then
        print_info "Installing Foundry..."
        curl -L https://foundry.paradigm.xyz | bash
        print_info "Foundry installed. You might need to restart your shell or source profile."
    fi
else
    print_info "Foundry (foundryup) already installed."
fi

# NVM (Node Version Manager)
if ! command_exists nvm; then
    read -p "Install NVM (Node Version Manager)? (y/n): " install_nvm
    if [[ "$install_nvm" =~ ^[Yy]$ ]]; then
        print_info "Installing NVM..."
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash 
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        print_info "NVM installed. Fish config integration requires 'bass' plugin."
    fi
else
    print_info "NVM command already exists. Skipping installation prompt."
fi

# Miniconda
if ! command_exists conda; then
    read -p "Install Miniconda? (y/n): " install_miniconda
    if [[ "$install_miniconda" =~ ^[Yy]$ ]]; then
        print_info "Installing Miniconda..."
        wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -O ~/miniconda.sh
        bash ~/miniconda.sh -b -p $HOME/miniconda3
        rm ~/miniconda.sh
        print_info "Miniconda installed. Fish config initialization will be added."
    fi
else
    print_info "Conda command already exists. Skipping Miniconda installation prompt."
fi

# Bun
if ! command_exists bun; then
    read -p "Install Bun? (y/n): " install_bun
    if [[ "$install_bun" =~ ^[Yy]$ ]]; then
        print_info "Installing Bun..."
        curl -fsSL https://bun.sh/install | bash
        export BUN_INSTALL="$HOME/.bun" # Ensure BUN_INSTALL is set
        print_info "Bun installed. Fish config will attempt to add path."
    fi
else
    print_info "Bun command already exists. Skipping installation prompt."
    export BUN_INSTALL="$HOME/.bun"
fi

# Spicetify CLI & Marketplace
if ! command_exists spicetify; then
    read -p "Install Spicetify CLI and Marketplace? (y/n): " install_spicetify
    if [[ "$install_spicetify" =~ ^[Yy]$ ]]; then
        print_info "Installing Spicetify CLI & Marketplace..."
        curl -fsSL https://raw.githubusercontent.com/spicetify/spicetify-cli/master/install.sh | sh
        if command_exists spicetify; then
             mkdir -p "$SPICETIFY_CONFIG_DIR/Themes"
             curl -fsSL https://raw.githubusercontent.com/spicetify/spicetify-marketplace/main/resources/install.sh | sh -s -- -c "$SPICETIFY_CONFIG_DIR/Themes"
        else
            print_warning "Spicetify CLI installation failed. Cannot install Marketplace."
        fi
    fi
else
    print_info "Spicetify command already exists. Ensuring Marketplace is installed (if Spicetify dir exists)..."
    if [ -d "$SPICETIFY_CONFIG_DIR" ] && ! [ -d "$SPICETIFY_CONFIG_DIR/Themes/marketplace" ]; then
         mkdir -p "$SPICETIFY_CONFIG_DIR/Themes"
         curl -fsSL https://raw.githubusercontent.com/spicetify/spicetify-marketplace/main/resources/install.sh | sh -s -- -c "$SPICETIFY_CONFIG_DIR/Themes"
    fi
fi

# NoiseTorch Reminder (always show if thinking about manual installs)
print_info "Reminder: NoiseTorch requires manual download and installation from its website/GitHub."

# --- Fonts --- 
print_info "Checking for Nerd Fonts..."
print_info "You can search for Nerd Fonts using 'dnf search nerd-font'"
read -p "Do you want to install font-manager (Flatpak) to help manage fonts? (y/n): " install_font_manager
if [[ "$install_font_manager" =~ ^[Yy]$ ]]; then
    print_info "Installing Font Manager Flatpak..."
    flatpak install --user -y flathub org.gnome.FontManager || print_warning "Failed to install Font Manager."
fi

# --- Gaming --- 
print_info "Configuring Gaming related items..."
read -p "Do you want to install ProtonUp-Qt (Flatpak) to manage Proton-GE versions? (y/n): " install_protonup
if [[ "$install_protonup" =~ ^[Yy]$ ]]; then
    print_info "Installing ProtonUp-Qt Flatpak..."
    flatpak install --user -y flathub net.davidotek.pupgui2 || print_warning "Failed to install ProtonUp-Qt."
fi
print_info "Nobara Linux comes with many gaming optimizations pre-installed."


# --- Grub Configuration --- 
read -p "Do you use BTRFS and want to install/enable grub-btrfs service? (y/n): " configure_grub_btrfs
if [[ "$configure_grub_btrfs" =~ ^[Yy]$ ]]; then
    print_info "Installing grub-btrfs..."
    sudo dnf install -y grub-btrfs || print_warning "Failed to install grub-btrfs."
    if command_exists grub-btrfsd; then 
        print_info "Enabling grub-btrfsd service..."
        sudo systemctl enable grub-btrfsd
    fi
fi
# Check grub config path (UEFI is more common now)
GRUB_CFG_PATH_EFI="/boot/efi/EFI/fedora/grub.cfg"
GRUB_CFG_PATH_BIOS="/boot/grub2/grub.cfg"
GRUB_CFG_PATH=""
if [ -f "$GRUB_CFG_PATH_EFI" ]; then
    GRUB_CFG_PATH="$GRUB_CFG_PATH_EFI"
elif [ -f "$GRUB_CFG_PATH_BIOS" ]; then
    GRUB_CFG_PATH="$GRUB_CFG_PATH_BIOS"
fi
if [ -n "$GRUB_CFG_PATH" ]; then
    print_info "It is recommended to run 'sudo grub2-mkconfig -o $GRUB_CFG_PATH' after kernel updates if needed."
else
    print_warning "Could not determine GRUB config path. Manual check needed."
fi


# --- Fish Shell Configuration ---
print_info "Configuring Fish shell..."
if ! command_exists fish; then
    print_warning "Fish shell not found. Please add 'fish' to your DNF list ($APPLIST_FILE)."
else
    # Set Fish as default shell
    read -p "Do you want to set Fish as your default shell? (y/n): " set_fish_default
    if [[ "$set_fish_default" =~ ^[Yy]$ ]]; then
        print_info "Setting Fish as default shell..."
        chsh -s $(which fish) || print_warning "Failed to set Fish as default shell."
    fi

    # Install Fisher if not installed
    if [ ! -f "$HOME/.config/fish/functions/fisher.fish" ]; then
         print_info "Installing Fisher package manager for Fish..."
         fish -c "curl -sL https://git.io/fisher | source && fisher install jorgebucaran/fisher"
    else
         print_info "Fisher already installed."
    fi

    # Install and configure Tide prompt
    read -p "Do you want to install and automatically configure the Tide prompt for Fish? (y/n): " configure_tide
    if [[ "$configure_tide" =~ ^[Yy]$ ]]; then
        print_info "Installing Tide prompt..."
        fish -c "fisher install IlanCosman/tide" || print_warning "Failed to install Tide."
        print_info "Configuring Tide prompt automatically (Lean style)..."
        fish -c "tide configure --auto --style=Lean --prompt_colors='True color' --show_time='24-hour format' --lean_prompt_height='Two lines' --prompt_connection=Solid --prompt_connection_andor_frame_color=Lightest --prompt_spacing=Sparse --icons='Many icons' --transient=Yes" || print_warning "Failed to auto-configure Tide."
    fi

    # Copy custom config.fish
    print_info "Copying custom fish configuration..."
    mkdir -p "$FISH_CONFIG_DIR/conf.d" # Ensure conf.d exists too
    if [ -f "$CURRENT_DIR/configs/fish/config.fish" ]; then
        cp "$CURRENT_DIR/configs/fish/config.fish" "$FISH_CONFIG_DIR/config.fish"

        # Add initializers to config.fish if tools were installed/exist
        # Conda (check after prompt)
        if command_exists conda; then
            CONDA_PATH=$(dirname $(dirname $(which conda))) 
            FISH_CONDA_INIT_PATH="$CONDA_PATH/etc/fish/conf.d/conda.fish"
            if [ -f "$FISH_CONDA_INIT_PATH" ] && ! grep -q "conda.fish" "$FISH_CONFIG_DIR/config.fish"; then
                print_info "Adding Conda initialization to fish config..."
                echo -e "\n# Initialize Conda\nsource $FISH_CONDA_INIT_PATH" >> "$FISH_CONFIG_DIR/config.fish"
            fi
        fi
        # Bun (check after prompt)
        if command_exists bun; then
            BUN_PATH="$HOME/.bun/bin" 
            if [ -d "$BUN_PATH" ] && ! grep -q "fish_add_path $BUN_PATH" "$FISH_CONFIG_DIR/config.fish"; then
                print_info "Adding Bun path to fish config..."
                echo -e "\n# Add Bun to PATH\nfish_add_path $BUN_PATH" >> "$FISH_CONFIG_DIR/config.fish"
            fi
        fi
         # Starship, Zoxide, TheFuck (Check if installed via DNF list)
        if command_exists starship && [[ " ${dnf_packages[@]} " =~ " starship " ]] && ! grep -q "starship init fish" "$FISH_CONFIG_DIR/config.fish"; then
             echo -e "\n# Initialize Starship\nstarship init fish | source" >> "$FISH_CONFIG_DIR/config.fish"
        fi
         if command_exists zoxide && [[ " ${dnf_packages[@]} " =~ " zoxide " ]] && ! grep -q "zoxide init fish" "$FISH_CONFIG_DIR/config.fish"; then
             echo -e "\n# Initialize Zoxide\nzoxide init fish | source" >> "$FISH_CONFIG_DIR/config.fish"
         fi
         if command_exists thefuck && [[ " ${dnf_packages[@]} " =~ " thefuck " ]] && ! grep -q "thefuck --alias" "$FISH_CONFIG_DIR/config.fish"; then
             echo -e "\n# Initialize TheFuck alias\nthefuck --alias | source" >> "$FISH_CONFIG_DIR/config.fish"
        fi
    else
        print_warning "Custom fish config file not found at $CURRENT_DIR/configs/fish/config.fish"
    fi
fi

# --- Git Configuration ---
read -p "Do you want to configure Git user profiles and SSH keys? (y/n): " git_config
if [[ "$git_config" =~ ^[Yy]$ ]]; then
    GIT_HELPER="$CURRENT_DIR/helpers/configure_git.sh"
    if [ -f "$GIT_HELPER" ]; then
        print_info "Running Git configuration script..."
        chmod +x "$GIT_HELPER"
        bash -c "$GIT_HELPER"
    else
        print_warning "Git helper script not found at $GIT_HELPER"
    fi
fi

# --- Terminal Configuration ---

# Kitty
# Check if command exists (assuming installed via DNF list)
if command_exists kitty; then
     print_info "Configuring Kitty terminal..."
     KITTY_HELPER="$CURRENT_DIR/helpers/kitty.sh"
     if [ -f "$KITTY_HELPER" ]; then
         chmod +x "$KITTY_HELPER"
         bash -c "$KITTY_HELPER $CURRENT_DIR"
     else
          print_warning "Kitty helper script not found at $KITTY_HELPER. Copying config manually if possible."
          mkdir -p "$KITTY_CONFIG_DIR"
          if [ -f "$CURRENT_DIR/configs/kitty/kitty.conf" ]; then
               cp -f "$CURRENT_DIR/configs/kitty/kitty.conf" "$KITTY_CONFIG_DIR/kitty.conf"
          else
               print_warning "Kitty config file not found at $CURRENT_DIR/configs/kitty/kitty.conf"
          fi
     fi
fi

# Alacritty
# Check if command exists (assuming installed via DNF list)
if command_exists alacritty; then
    print_info "Configuring Alacritty terminal..."
    ALACRITTY_HELPER="$CURRENT_DIR/helpers/alacritty.sh"
    if [ -f "$ALACRITTY_HELPER" ]; then
         chmod +x "$ALACRITTY_HELPER"
         bash -c "$ALACRITTY_HELPER $CURRENT_DIR"
    else
         print_warning "Alacritty helper script not found at $ALACRITTY_HELPER. Copying config manually if possible."
          mkdir -p "$ALACRITTY_CONFIG_DIR"
          if [ -f "$CURRENT_DIR/configs/alacritty/alacritty.toml" ]; then
               cp -f "$CURRENT_DIR/configs/alacritty/alacritty.toml" "$ALACRITTY_CONFIG_DIR/alacritty.toml"
          elif [ -f "$CURRENT_DIR/configs/alacritty/alacritty.yml" ]; then
               cp -f "$CURRENT_DIR/configs/alacritty/alacritty.yml" "$ALACRITTY_CONFIG_DIR/alacritty.yml"
          else
               print_warning "Alacritty config file (toml or yml) not found in $CURRENT_DIR/configs/alacritty/"
          fi
    fi
fi

# Ghostty
if command_exists ghostty; then # Ghostty likely not flatpak, check command
    print_info "Configuring Ghostty terminal..."
    mkdir -p "$GHOSTTY_CONFIG_DIR"
    if [ -f "$CURRENT_DIR/configs/ghostty/config" ]; then
        cp -f "$CURRENT_DIR/configs/ghostty/config" "$GHOSTTY_CONFIG_DIR/config"
    else
        print_warning "Ghostty config file not found at $CURRENT_DIR/configs/ghostty/config"
    fi
fi


# --- Uosc for MPV --- 
if [[ " ${flatpak_packages[@]} " =~ " io.mpv.Mpv " ]] || command_exists mpv; then
    read -p "Do you want to install the uosc UI for MPV? (y/n): " install_uosc
    if [[ "$install_uosc" =~ ^[Yy]$ ]]; then
        print_info "Installing uosc for MPV..."
        # Need to check if MPV is flatpak or native for install path
        MPV_CONFIG_DIR="$HOME/.config/mpv"
        if [[ " ${flatpak_packages[@]} " =~ " io.mpv.Mpv " ]]; then
            # Flatpak config path might differ or require override
            MPV_CONFIG_DIR="$HOME/.var/app/io.mpv.Mpv/config/mpv"
             print_warning "MPV installed via Flatpak. uosc installer might need manual adjustments for path: $MPV_CONFIG_DIR"
             # Try to create path just in case
             mkdir -p "$MPV_CONFIG_DIR"
        fi
        # Run installer - may need adjustment for Flatpak
        bash -c "$(curl -fsSL https://raw.githubusercontent.com/tomasklaen/uosc/HEAD/installers/unix.sh)" || print_warning "uosc installation script failed. Manual installation might be required."
    fi
fi

# --- Bluetooth --- 
read -p "Do you want to enable the Bluetooth service? (y/n): " enable_bluetooth
if [[ "$enable_bluetooth" =~ ^[Yy]$ ]]; then
    print_info "Enabling and starting Bluetooth service..."
    sudo systemctl enable --now bluetooth.service || print_warning "Failed to enable/start Bluetooth service."
fi

# --- Docker Enablement --- 
if command_exists docker; then
     read -p "Docker is installed. Do you want to ensure the Docker service is enabled and started? (y/n): " enable_docker
     if [[ "$enable_docker" =~ ^[Yy]$ ]]; then
         print_info "Ensuring Docker service is enabled and started..."
         sudo systemctl enable docker
         sudo systemctl start docker
         if ! groups $USER | grep -q '\bdocker\b'; then
              print_warning "User $USER not in docker group. Run 'sudo usermod -aG docker $USER' and log out/in."
         else
             print_info "User $USER is already in the docker group."
         fi
     fi
fi

# --- Fastfetch Configuration ---
if command_exists fastfetch; then
    print_info "Configuring Fastfetch..."
    FASTFETCH_HELPER="$CURRENT_DIR/helpers/fastfetch.sh"
    if [ -f "$FASTFETCH_HELPER" ]; then
        chmod +x "$FASTFETCH_HELPER"
        bash -c "$FASTFETCH_HELPER $CURRENT_DIR"
    else
        print_warning "Fastfetch helper script not found at $FASTFETCH_HELPER. Copying config manually if possible."
         mkdir -p "$FASTFETCH_CONFIG_DIR"
         if [ -f "$CURRENT_DIR/configs/fastfetch/config.jsonc" ]; then
              cp "$CURRENT_DIR/configs/fastfetch/config.jsonc" "$FASTFETCH_CONFIG_DIR/config.jsonc"
         else
              print_warning "Fastfetch config file not found at $CURRENT_DIR/configs/fastfetch/config.jsonc"
              print_info "Consider running 'fastfetch --gen-config' to create a default one."
         fi
    fi
fi

####------------------------------- Installing NVM -------------------------------####

# Install NVM
if ! command_exists nvm; then
    print_info "Installing NVM..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm


# --- Final Steps ---
print_info "Nobara Linux setup script completed."
print_warning "Please review any warnings above."
print_warning "Ensure your common/dnf_applist.txt (for DNF) and common/flatpacks.txt (for Flatpak) contain the desired packages."
print_warning "A system restart or logging out and back in is recommended for all changes to take effect (PATH, groups, services, etc.)."
print_warning "Remember to add SSH keys to GitHub if configured."

exit 0 