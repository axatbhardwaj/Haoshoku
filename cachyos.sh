#!/bin/bash
# This file is used to setup Manjro for my setup
# the commands for verbose and redundant for better calrity

set -e  # Exit on error

current_dir=$(pwd)
FLATPAKLIST_FILE="$current_dir/common/flatpacks_arch.txt"
TIMEOUT_SECONDS=15 # Default timeout for prompts

# --- Helper Functions ---
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

# Function to prompt user with timeout
prompt_with_timeout() {
    local prompt="$1"
    local default="$2"
    local timeout="$3"

    if [ -z "$timeout" ]; then
        timeout=$TIMEOUT_SECONDS
    fi

    read -t "$timeout" -p "$prompt (y/n) [default: $default]: " response || true

    if [ -z "$response" ]; then
        response="$default"
    fi

    [[ "$response" =~ ^[Yy]$ ]]
}
# --- End Helper Functions ---

# Function to print info messages
print_info() {
    echo "[INFO] $1"
}

#pacman updates & installing rust up
sudo pacman -Syu base-devel --noconfirm

curl https://sh.rustup.rs -sSf | sh -s -- -y --profile default --default-toolchain stable
source $HOME/.cargo/env


# Install Paru if not already installed
if ! command_exists paru;
then
    print_info "Paru not found. Installing Paru..."
    git clone https://aur.archlinux.org/paru.git /tmp/paru
    cd /tmp/paru
    makepkg -si --noconfirm
    cd "$current_dir" # Return to original directory
else
    print_info "Paru already installed."
fi


####------------------------------------------------------- installing uv --------------------------------------------------------####
#installing uv
if ! command_exists uv; then
    print_info "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    source "$HOME/.cargo/env"
    print_info "uv installed. Please source ~/.cargo/env or restart."
else
    print_info "uv already installed."
fi

####------------------------------------------------------ installng software ------------------------------------------------------####

install_apps() {
    # Define the path to apps.txt
    APPS_FILE="$current_dir/common/paru_applist.txt"

    # Check if apps file exists
    if [ ! -f "$APPS_FILE" ]; then
        print_warning "$APPS_FILE not found! Skipping installation from list."
        return
    fi

    print_info "Reading app list from $APPS_FILE..."
    # Read the list of apps from apps.txt, ignoring comments and empty lines
    mapfile -t apps < <(grep -vE '^#|^$' "$APPS_FILE" || true)

    if [ ${#apps[@]} -eq 0 ]; then
        print_info "No apps found in $APPS_FILE to install."
        return
    fi

    # Install all apps in parallel using paru
    print_info "Installing apps via Paru: ${apps[*]}"
    paru -S --noconfirm --sudoloop "${apps[@]}" || print_warning "Failed to install some packages via Paru."
}

# install_apps

#####-------------------------------------------installing flatpak packages-------------------------------------------####
# --- Flatpak Setup ---
print_info "Ensuring Flatpak is configured..."
if ! command_exists flatpak; then
    print_info "Flatpak not found, installing..."
    paru -S flatpak --noconfirm || print_error "Failed to install flatpak."
fi

print_info "Adding Flathub remote..."
# Add for the system (--system) or just the user (--user)
# Using --user here as packages are installed with --user
flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo || print_warning "Failed to add Flathub remote for user."

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
        # Trim whitespace
        pkg_id_trimmed=$(echo "$pkg_id" | xargs)
        if [ -n "$pkg_id_trimmed" ]; then
            flatpak_packages+=("$pkg_id_trimmed")
        fi
    done

    # Install Flatpak packages for the user
    if [ ${#flatpak_packages[@]} -gt 0 ]; then
        print_info "Installing Flatpak packages for user: ${flatpak_packages[*]}"
        flatpak install --user -y flathub "${flatpak_packages[@]}" || print_warning "Failed to install some Flatpak packages."
    else
        print_info "No Flatpak packages specified in $FLATPAKLIST_FILE."
    fi
fi

# installing cursor
if ! command_exists cursor; then
    print_info "Installing Cursor IDE..."
    curl -fsSL https://raw.githubusercontent.com/watzon/cursor-linux-installer/main/install.sh | bash
    print_info "Cursor IDE installed successfully."
else
    print_info "Cursor IDE already installed."
fi


#installing foundry
if ! command_exists foundryup; then
    print_info "Installing Foundry..."
    curl -L https://foundry.paradigm.xyz | bash
    # It's usually good practice to source the profile or restart the shell after this
    print_info "Foundry installed. You might need to restart your shell or source profile."
else
    print_info "Foundry (foundryup) already installed."
fi

#installing nerd-fonts
print_info "Installing Nerd Fonts..."
sudo pacman -S $(pacman -Sgq nerd-fonts) --noconfirm || print_warning "Failed to install some Nerd Fonts."

#gaming related congigurations
# Ask if to enable gaming

if prompt_with_timeout "Do you want to enable gaming?" "n"; then
    print_info "Enabling gaming configuration..."
    paru -S cachyos-gaming-meta cachyos-gaming-applications protonup-rs-bin --noconfirm || print_warning "Failed to install some gaming packages."
else
    print_info "Skipping gaming configuration."
fi


####---------------------------------------------configuring fish ------------------------------------------------------####

# Make Fish the default shell
print_info "Checking if Fish shell is installed..."
if ! command_exists fish; then
    print_info "Fish shell not found. Installing..."
    paru -S fish --noconfirm || print_error "Failed to install Fish shell."
fi

if prompt_with_timeout "Set Fish as the default shell?" "y"; then
    print_info "Setting Fish as the default shell..."
    chsh -s $(which fish) || print_warning "Failed to set Fish as default shell for user $USER."
else
    print_info "Skipping setting Fish as default shell."
fi


# Install Fisher
print_info "Installing Fisher package manager..."
fish -c "curl -sL https://git.io/fisher | source && fisher install jorgebucaran/fisher"

#fish extensions
print_info "Installing Fish extensions via Fisher..."
fish -c "fisher install meaningful-ooo/sponge" || print_warning "Failed to install sponge"
fish -c "fisher install jorgebucaran/nvm.fish" || print_warning "Failed to install nvm.fish"
fish -c "fisher install franciscolourenco/done" || print_warning "Failed to install done"
fish -c "fisher install joseluisq/gitnow@2.12.0" || print_warning "Failed to install gitnow"

#configuring starship prompt
if command_exists starship; then
    print_info "Configuring Starship prompt..."
    starship preset nerd-font-symbols -o ~/.config/starship.toml || print_warning "Failed to configure Starship."
else
    print_warning "Starship command not found. Cannot configure prompt."
fi

####------------------------------------------------------configuring-fish ------------------------------------------------------####

# Configure Fish shell
print_info "Configuring Fish shell with custom config..."
#making sure that the fish folder exists
FISH_CONFIG_DIR="$HOME/.config/fish"
if [ ! -d "$FISH_CONFIG_DIR" ]; then
    print_info "Creating Fish config directory: $FISH_CONFIG_DIR"
    mkdir -p "$FISH_CONFIG_DIR"
fi

CUSTOM_FISH_CONFIG="$current_dir/configs/fish/config.fish"
if [ -f "$CUSTOM_FISH_CONFIG" ]; then
    cp "$CUSTOM_FISH_CONFIG" "$FISH_CONFIG_DIR/config.fish"
    print_info "Copied custom config.fish to $FISH_CONFIG_DIR"
else
    print_warning "Custom config.fish not found at $CUSTOM_FISH_CONFIG"
fi

####--------------------------------------------------- Setting Pyenv fish --------------------------------------------------####
print_info "Configuring Pyenv for Fish..."
# Check if Pyenv is installed before attempting configuration
if command_exists pyenv; then
  fish -c "set -Ux PYENV_ROOT $HOME/.pyenv; fish_add_path $PYENV_ROOT/bin"
  print_info "Pyenv configured for Fish."
else
  print_warning "Pyenv command not found. Skipping Pyenv Fish configuration."
fi

####------------------------------------------------------ git config ------------------------------------------------------####
# ask if git configuration is required
if prompt_with_timeout "Do you want to configure git?" "y"; then
    GIT_HELPER="$current_dir/helpers/configure_git.sh"
    if [ -f "$GIT_HELPER" ]; then
        print_info "Running Git configuration script..."
        chmod +x "$GIT_HELPER"
        bash -c "$GIT_HELPER" || print_warning "Git configuration script failed."
    else
        print_warning "Git helper script not found at $GIT_HELPER"
    fi
else
    print_info "Skipping Git configuration."
fi

####---------------------------------configuring kitty terminal ------------------------------------####

# use the kitty.sh script to configure kitty
KITTY_HELPER="$current_dir/helpers/kitty.sh"
if [ -f "$KITTY_HELPER" ]; then
    print_info "Running Kitty configuration script..."
    chmod +x "$KITTY_HELPER"
    bash -c "$KITTY_HELPER $current_dir" || print_warning "Kitty configuration script failed."
else
    print_warning "Kitty helper script not found at $KITTY_HELPER"
fi


####---------------------------------configuring ghostty ------------------------------------####
print_info "Configuring Ghostty terminal..."
GHOSTTY_CONFIG_DIR="$HOME/.config/ghostty"
CUSTOM_GHOSTTY_CONFIG="$current_dir/configs/ghostty/config"

#making sure that the ghostty folder exists in the config folder
if [ ! -d "$GHOSTTY_CONFIG_DIR" ]; then
    print_info "Creating Ghostty config directory: $GHOSTTY_CONFIG_DIR"
    mkdir -p "$GHOSTTY_CONFIG_DIR"
fi

if [ -f "$CUSTOM_GHOSTTY_CONFIG" ]; then
    cp "$CUSTOM_GHOSTTY_CONFIG" "$GHOSTTY_CONFIG_DIR/config"
    print_info "Copied custom Ghostty config to $GHOSTTY_CONFIG_DIR"
else
    print_warning "Custom Ghostty config not found at $CUSTOM_GHOSTTY_CONFIG"
fi

###########---------------------------------configuring alacritty ------------------------------------####
#use the alacritty.sh script to configure alacritty
ALACRITTY_HELPER="$current_dir/helpers/alacritty.sh"
if [ -f "$ALACRITTY_HELPER" ]; then
    print_info "Running Alacritty configuration script..."
    chmod +x "$ALACRITTY_HELPER"
    bash -c "$ALACRITTY_HELPER $current_dir" || print_warning "Alacritty configuration script failed."
else
    print_warning "Alacritty helper script not found at $ALACRITTY_HELPER"
fi

####---------------------------KDE-connect fix----------------------------------####
print_info "Applying KDE Connect fix..."
if pgrep -x "kdeconnectd" > /dev/null
then
    print_info "Stopping existing kdeconnectd process..."
    killall kdeconnectd || true
fi

#making sure that the kdeconnect folder exists
KDECONNECT_CONFIG_DIR="$HOME/.config/kdeconnect"
if [ -d "$KDECONNECT_CONFIG_DIR" ]; then
    print_info "Backing up existing KDE Connect config..."
    mv "$KDECONNECT_CONFIG_DIR" "$HOME/.config/kdeconnect.bak"
fi

print_info "Configuring firewall rules for KDE Connect..."
sudo iptables -I INPUT -p tcp --dport 1714:1764 -j ACCEPT || print_warning "Failed to add TCP iptables rule."
sudo iptables -I INPUT -p udp --dport 1714:1764 -j ACCEPT || print_warning "Failed to add UDP iptables rule."

# Check if ufw exists and is active before trying to use it
if command_exists ufw && sudo ufw status | grep -q 'Status: active'; then
    print_info "Configuring ufw rules for KDE Connect..."
    sudo ufw allow 1714:1764/udp || print_warning "Failed to allow UDP ports in ufw."
    sudo ufw allow 1714:1764/tcp || print_warning "Failed to allow TCP ports in ufw."
    sudo ufw reload || print_warning "Failed to reload ufw."
else
    print_info "ufw not found or inactive, skipping ufw configuration."
fi

#####---------------------------------installing uosc ------------------------------------####
#installing uosc
print_info "Installing uosc (MPV OSC)..."
bash -c "$(curl -fsSL https://raw.githubusercontent.com/tomasklaen/uosc/HEAD/installers/unix.sh)" || print_warning "Failed to install uosc."

####---------------------------------configuring bluetooth ------------------------------------####

#ask if to enable bluetooth
if prompt_with_timeout "Do you want to enable bluetooth ?" "n"; then
    print_info "Enabling Bluetooth service..."
    sudo systemctl enable bluetooth || print_warning "Failed to enable Bluetooth service."
    sudo systemctl start bluetooth || print_warning "Failed to start Bluetooth service."
    print_info "Bluetooth enabled!"
else
    print_info "Skipping Bluetooth configuration."
fi

#######------------------------------------Enabling Docker-------------------------#####
# Ask if user wants to enable Docker
if command_exists docker && prompt_with_timeout "Do you want to enable Docker?" "y"; then
    print_info "Enabling and starting Docker service..."
    sudo systemctl enable docker || print_warning "Failed to enable Docker service."
    sudo systemctl start docker || print_warning "Failed to start Docker service."

    # Check if user is in the docker group
    if ! groups $USER | grep -q 'docker'; then
        print_info "Adding user $USER to the docker group..."
        sudo usermod -aG docker $USER || print_warning "Failed to add user to docker group."
        print_warning "User $USER added to docker group. Please log out and log back in for this change to take effect."
    else
        print_info "User $USER is already in the docker group."
    fi

    # Setting permissions for Docker socket (use group permissions instead of 666)
    # sudo chmod 666 /var/run/docker.sock # Less secure
    # Instead, rely on the docker group membership added above.
    # If socket issues persist, investigate group permissions/socket ownership.
    print_info "Docker has been enabled and started!"
else
    if ! command_exists docker; then
        print_warning "Docker command not found. Skipping Docker enablement."
    else
        print_info "Skipping Docker enablement."
    fi
fi

####------------------------------------------------------------------ configuring fastfetch ------------------------------------------------------####
# Configure Fastfetch
FASTFETCH_HELPER="$current_dir/helpers/fastfetch.sh"
if command_exists fastfetch; then
    print_info "Configuring Fastfetch..."
    if [ -f "$FASTFETCH_HELPER" ]; then
        chmod +x "$FASTFETCH_HELPER"
        bash -c "$FASTFETCH_HELPER $current_dir" || print_warning "Fastfetch configuration script failed."
    else
        print_warning "Fastfetch helper script not found at $FASTFETCH_HELPER."
        # Optional: Add manual config copy here if helper is missing
        # FASTFETCH_CONFIG_DIR="$HOME/.config/fastfetch"
        # CUSTOM_FASTFETCH_CONFIG="$current_dir/configs/fastfetch/config.jsonc"
        # mkdir -p "$FASTFETCH_CONFIG_DIR"
        # if [ -f "$CUSTOM_FASTFETCH_CONFIG" ]; then
        #     cp "$CUSTOM_FASTFETCH_CONFIG" "$FASTFETCH_CONFIG_DIR/config.jsonc"
        # fi
    fi
else
    print_warning "Fastfetch command not found. Skipping configuration."
fi


####------------------------------------configure Kde force blur ------------------------------------####
# Configure KDE Force Blur

#prompt if this is kde environment or not if yes then execute the following commands
if prompt_with_timeout "Is this a KDE Plasma environment?" "n"; then
    print_info "Installing prerequisites for KDE Force Blur..."
    paru -S base-devel git extra-cmake-modules qt6-tools --noconfirm || print_error "Failed to install prerequisites for Force Blur."

    print_info "Cloning and building KDE Force Blur..."
    cd /tmp # Build in a temporary directory
    if [ -d "kwin-effects-forceblur" ]; then
        print_warning "Removing existing kwin-effects-forceblur directory in /tmp..."
        rm -rf kwin-effects-forceblur
    fi
    git clone https://github.com/taj-ny/kwin-effects-forceblur || print_error "Failed to clone Force Blur repository."
    cd kwin-effects-forceblur
    mkdir build
    cd build
    cmake ../ -DCMAKE_INSTALL_PREFIX=/usr || print_error "CMake configuration failed for Force Blur."
    make || print_error "Build failed for Force Blur."
    sudo make install || print_error "Installation failed for Force Blur."
    cd "$current_dir" # Return to original directory

    print_info "Force Blur Installed successfully!"
    print_info "Enable it from System Settings > Workspace Behavior > Desktop Effects > Force Blur"
    print_info "Configure Force Blur and set 'Enable blur all except matching'"
    print_info "Recommended Kvantum theme: OCEAN (link in script)"
    #https://store.kde.org/p/1427568/

else
    print_info "Skipping KDE Force Blur installation."
fi

print_info "Installation complete! Restart your terminal or log out/in for all changes."

exit 0 # Explicitly exit with success
