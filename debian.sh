#!/bin/bash
# Debian/Kubuntu Setup Script
# ==========================
# This script automates the setup of applications and configurations 
# on Debian/Kubuntu, following a similar structure to the Nobara setup script.

set -e  # Exit on error

# --- Variables & Helper Functions ---
CURRENT_DIR=$(pwd)
APPLIST_FILE="$CURRENT_DIR/common/apt_applist.txt"
FLATPAKLIST_FILE="$CURRENT_DIR/common/flatpacks.txt"
SNAPLIST_FILE="$CURRENT_DIR/common/snap_applist.txt"
FISH_CONFIG_DIR="$HOME/.config/fish"
FASTFETCH_CONFIG_DIR="$HOME/.config/fastfetch"
KITTY_CONFIG_DIR="$HOME/.config/kitty"
ALACRITTY_CONFIG_DIR="$HOME/.config/alacritty"
GHOSTTY_CONFIG_DIR="$HOME/.config/ghostty"
SPICETIFY_CONFIG_DIR="$HOME/.config/spicetify"
TIMEOUT_SECONDS=15

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

# Ensure the script is run with bash
if [ -z "$BASH_VERSION" ]; then
    echo "Please run this script with bash."
    exit 1
fi

# Cache sudo credentials for the entire script
print_info "Caching sudo credentials..."
sudo -v
# Keep-alive: update existing sudo time stamp if set, otherwise do nothing.
while true; do sudo -n true; sleep 60; kill -0 "$$" || exit; done 2>/dev/null &

# --- Initial System Setup & Core Tools ---
print_info "Updating system packages..."
sudo apt update
sudo apt upgrade -y

print_info "Installing Grub Customizer..."
sudo add-apt-repository ppa:danielrichter2007/grub-customizer -y
sudo apt update

print_info "Installing Dark Matter GRUB theme..."
if [ ! -d "darkmatter-grub-theme" ]; then
    git clone --depth 1 https://gitlab.com/VandalByte/darkmatter-grub-theme.git
    cd darkmatter-grub-theme
    sudo python3 darkmatter-theme.py --install
    cd ..
    rm -rf darkmatter-grub-theme
else
    print_warning "Dark Matter GRUB theme directory already exists. Skipping installation."
fi

print_info "Setting up Timeshift and automatic snapshots..."
sudo apt install -y git make timeshift

print_info "Installing timeshift-autosnap-apt..."
if [ ! -d "/home/$USER/timeshift-autosnap-apt" ]; then
    git clone https://github.com/wmutschl/timeshift-autosnap-apt.git "/home/$USER/timeshift-autosnap-apt"
    cd "/home/$USER/timeshift-autosnap-apt"
    sudo make install
    cd "$CURRENT_DIR"
else
    print_warning "timeshift-autosnap-apt directory already exists. Skipping installation."
fi

print_info "Installing grub-btrfs..."
if [ ! -d "/home/$USER/grub-btrfs" ]; then
    git clone https://github.com/Antynea/grub-btrfs.git "/home/$USER/grub-btrfs"
    cd "/home/$USER/grub-btrfs"
    sudo make install
    cd "$CURRENT_DIR"
else
    print_warning "grub-btrfs directory already exists. Skipping installation."
fi

print_info "Installing essential packages (curl, wget, git)..."
sudo apt install -y curl wget git

print_info "Installing Rust via rustup..."
if ! command_exists rustc; then
    curl https://sh.rustup.rs -sSf | sh -s -- -y --profile default --default-toolchain stable
    source "$HOME/.cargo/env"
    print_info "Rust installed. Please source ~/.cargo/env in your shell or restart."
else
    print_info "Rust (rustc) already installed."
fi

print_info "Installing uv package manager..."
if ! command_exists uv; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
    source "$HOME/.cargo/env"
    print_info "uv installed. Please source ~/.cargo/env in your shell or restart."
else
    print_info "uv already installed."
fi

# --- Application Installation Function ---
install_apps() {
    print_info "--- Starting Application Installation Phase ---"

    # --- Flatpak Setup ---
    print_info "Ensuring Flatpak is configured..."
    if ! command_exists flatpak; then
        print_info "Flatpak not found, installing..."
        sudo apt install -y flatpak kde-config-flatpak
    fi
    
    sudo flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
    flatpak update -y

    # --- Snap Setup ---
    print_info "Ensuring Snap is configured..."
    if ! command_exists snap; then
        print_info "Snap not found, installing..."
        sudo apt install -y snapd
    fi
    sudo systemctl enable --now snapd.socket
    
    if [ ! -d "/snap" ]; then
        sudo mkdir -p /snap
    fi
    
    if [ ! -L "/snap/snap" ]; then
        sudo ln -s /var/lib/snapd/snap /snap/snap
    fi

    # --- Process Snap snap_applist.txt ---
    print_info "Processing Snap package list from $SNAPLIST_FILE..."
    if [ -f "$SNAPLIST_FILE" ]; then
        mapfile -t snap_packages < <(grep -vE '^#|^$' "$SNAPLIST_FILE" || true)
        if [ ${#snap_packages[@]} -gt 0 ]; then
            print_info "Installing Snap packages: ${snap_packages[*]}"
            for pkg in "${snap_packages[@]}"; do
                if [ "$pkg" = "ghostty" ]; then
                    sudo snap install ghostty --classic || print_warning "Failed to install Ghostty"
                else
                    sudo snap install $pkg || print_warning "Failed to install Snap package: $pkg"
                fi
            done
        fi
    else
        print_warning "$SNAPLIST_FILE not found! Skipping Snap installations."
    fi

    # --- Process APT apt_applist.txt ---
    print_info "Processing APT package list from $APPLIST_FILE..."
    if [ -f "$APPLIST_FILE" ]; then
        mapfile -t apt_packages < <(grep -vE '^#|^$' "$APPLIST_FILE" || true)
        if [ ${#apt_packages[@]} -gt 0 ]; then
            print_info "Installing APT packages: ${apt_packages[*]}"
            sudo apt install -y "${apt_packages[@]}" || print_warning "Failed to install some APT packages."
        fi
    else
        print_warning "$APPLIST_FILE not found! Skipping APT installations."
    fi

    # --- Process Flatpak flatpacks.txt ---
    print_info "Processing Flatpak package list from $FLATPAKLIST_FILE..."
    if [ -f "$FLATPAKLIST_FILE" ]; then
        mapfile -t flatpak_packages < <(grep -vE '^#|^$' "$FLATPAKLIST_FILE" || true)
        if [ ${#flatpak_packages[@]} -gt 0 ]; then
            print_info "Installing Flatpak packages: ${flatpak_packages[*]}"
            flatpak install -y flathub "${flatpak_packages[@]}" || print_warning "Failed to install some Flatpak packages."
        fi
    else
        print_warning "$FLATPAKLIST_FILE not found! Skipping Flatpak installations."
    fi

    print_info "--- Application Installation Phase Complete ---"
}

# --- Execute Application Installation ---
install_apps

# --- Installing Cursor ---
if ! command_exists cursor; then
    print_info "Installing Cursor IDE..."
    curl -fsSL https://raw.githubusercontent.com/watzon/cursor-linux-installer/main/install.sh | bash
    print_info "Cursor IDE installed successfully."
else
    print_info "Cursor IDE already installed."
fi

# --- Docker Setup ---
print_info "Setting up Docker repository..."
if ! command_exists docker; then
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg

    echo \
      "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
      sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    sudo apt update
    sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    sudo systemctl enable docker
    sudo systemctl start docker
    if ! groups $USER | grep -q '\bdocker\b'; then
        sudo usermod -aG docker $USER
        print_warning "Added user $USER to docker group. Log out and log back in required."
    fi
else
    print_info "Docker already installed."
fi

# --- Package Installations ---
if prompt_with_timeout "Install Kvantum Theme Manager?" "y"; then
    if ! command_exists kvantummanager; then
        print_info "Installing Kvantum Theme Manager..."
        sudo add-apt-repository ppa:papirus/papirus -y
        sudo apt update
        sudo apt install qt6-style-kvantum qt6-style-kvantum-themes -y
        print_info "Kvantum Theme Manager installed successfully."
    else
        print_info "Kvantum Theme Manager already installed."
    fi
fi

if prompt_with_timeout "Install Starship (custom shell prompt)?" "y"; then
    if ! command_exists starship; then
        print_info "Installing Starship..."
        curl -sS https://starship.rs/install.sh | sh -s -- --bin-dir /usr/local/bin
        print_info "Starship installed. Please add the following to your shell configuration:"
        echo 'eval "$(starship init bash)"  # For bash'
        echo 'starship init fish | source   # For fish'
        echo 'eval "$(starship init zsh)"   # For zsh'
    else
        print_info "Starship already installed."
    fi
fi

if prompt_with_timeout "Install Zoxide (smarter cd command)?" "y"; then
    if ! command_exists zoxide; then
        print_info "Installing Zoxide..."
        curl -sSfL https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh | sh
        print_info "Zoxide installed. Please add the following to your shell configuration:"
        echo 'eval "$(zoxide init bash)"  # For bash'
        echo 'eval "$(zoxide init fish)"  # For fish'
        echo 'eval "$(zoxide init zsh)"   # For zsh'
    else
        print_info "Zoxide already installed."
    fi
fi

if prompt_with_timeout "Install Pyenv (Python version manager)?" "y"; then
    if ! command_exists pyenv; then
        print_info "Installing Pyenv..."
        curl https://pyenv.run | bash
        print_info "Pyenv installed. Please add the following to your shell configuration:"
        echo 'export PYENV_ROOT="$HOME/.pyenv"'
        echo 'command -v pyenv >/dev/null || export PATH="$PYENV_ROOT/bin:$PATH"'
        echo 'eval "$(pyenv init -)"'
    else
        print_info "Pyenv already installed."
    fi
fi

if prompt_with_timeout "Install Foundry toolchain (foundryup)?" "y"; then
    if ! command_exists foundryup; then
        print_info "Installing Foundry..."
        curl -L https://foundry.paradigm.xyz | bash
        print_info "Foundry installed. You might need to restart your shell or source profile."
    else
        print_info "Foundry (foundryup) already installed."
    fi
fi

if prompt_with_timeout "Install NVM (Node Version Manager)?" "y"; then
    if ! command_exists nvm; then
        print_info "Installing NVM..."
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash 
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        print_info "NVM installed. Fish config integration requires 'bass' plugin."
    else
        print_info "NVM already installed."
    fi
fi

if prompt_with_timeout "Install Bun?" "y"; then
    if ! command_exists bun; then
        print_info "Installing Bun..."
        curl -fsSL https://bun.sh/install | bash
        export BUN_INSTALL="$HOME/.bun"
        print_info "Bun installed. Fish config will attempt to add path."
    else
        print_info "Bun already installed."
        export BUN_INSTALL="$HOME/.bun"
    fi
fi

# --- Fonts --- 
print_info "Checking for Nerd Fonts..."
print_info "You can search for Nerd Fonts using 'apt search fonts-nerd'"
if prompt_with_timeout "Install font-manager?" "y"; then
    print_info "Installing Font Manager..."
    sudo apt install -y font-manager || print_warning "Failed to install Font Manager."
fi

# --- Fish Shell Configuration ---
print_info "Configuring Fish shell..."
if ! command_exists fish; then
    print_info "Installing Fish shell..."
    sudo add-apt-repository ppa:fish-shell/release-4 -y
    sudo apt update
    sudo apt install -y fish || print_error "Failed to install Fish shell"
else
    print_info "Fish shell already installed."
fi

if prompt_with_timeout "Set Fish as default shell?" "y"; then
    print_info "Setting Fish as default shell..."
    chsh -s $(which fish) || print_warning "Failed to set Fish as default shell."
fi

# Install Fisher and plugins
print_info "Installing Fisher package manager and plugins..."
if [ ! -f "$HOME/.config/fish/functions/fisher.fish" ]; then
    fish -c "curl -sL https://git.io/fisher | source && fisher install jorgebucaran/fisher"
    # Install additional Fisher plugins
    fish -c "fisher install meaningful-ooo/sponge"
    fish -c "fisher install jorgebucaran/nvm.fish"
    fish -c "fisher install franciscolourenco/done"
    fish -c "fisher install joseluisq/gitnow@2.12.0"
else
    print_info "Fisher already installed."
fi

# Configure Starship prompt
if command_exists starship; then
    print_info "Configuring Starship prompt..."
    starship preset nerd-font-symbols -o ~/.config/starship.toml
fi

# Copy custom config.fish
print_info "Copying custom fish configuration..."
mkdir -p "$FISH_CONFIG_DIR/conf.d"
if [ -f "$CURRENT_DIR/configs/fish/config.fish" ]; then
    cp "$CURRENT_DIR/configs/fish/config.fish" "$FISH_CONFIG_DIR/config.fish"

    # Add initializers to config.fish if tools were installed/exist
    if command_exists conda; then
        CONDA_PATH=$(dirname $(dirname $(which conda))) 
        FISH_CONDA_INIT_PATH="$CONDA_PATH/etc/fish/conf.d/conda.fish"
        if [ -f "$FISH_CONDA_INIT_PATH" ] && ! grep -q "conda.fish" "$FISH_CONFIG_DIR/config.fish"; then
            echo -e "\n# Initialize Conda\nsource $FISH_CONDA_INIT_PATH" >> "$FISH_CONFIG_DIR/config.fish"
        fi
    fi

    if command_exists bun; then
        BUN_PATH="$HOME/.bun/bin" 
        if [ -d "$BUN_PATH" ] && ! grep -q "fish_add_path $BUN_PATH" "$FISH_CONFIG_DIR/config.fish"; then
            echo -e "\n# Add Bun to PATH\nfish_add_path $BUN_PATH" >> "$FISH_CONFIG_DIR/config.fish"
        fi
    fi

    for tool in starship zoxide thefuck; do
        if command_exists $tool && ! grep -q "$tool init fish" "$FISH_CONFIG_DIR/config.fish"; then
            case $tool in
                starship) echo -e "\n# Initialize Starship\nstarship init fish | source" >> "$FISH_CONFIG_DIR/config.fish" ;;
                zoxide) echo -e "\n# Initialize Zoxide\nzoxide init fish | source" >> "$FISH_CONFIG_DIR/config.fish" ;;
                thefuck) echo -e "\n# Initialize TheFuck alias\nthefuck --alias | source" >> "$FISH_CONFIG_DIR/config.fish" ;;
            esac
        fi
    done
else
    print_warning "Custom fish config file not found at $CURRENT_DIR/configs/fish/config.fish"
fi

if prompt_with_timeout "Install Conda (Python ENV manager)?" "y"; then
    if ! command_exists conda; then
        print_info "Installing Conda..."
        print_info "Downloading Anaconda installer..."
        cd ~/Downloads || mkdir -p ~/Downloads && cd ~/Downloads
        curl -O https://repo.anaconda.com/archive/Anaconda3-2024.10-1-Linux-x86_64.sh
        print_info "Running Anaconda installer in silent mode..."
        bash Anaconda3-2024.10-1-Linux-x86_64.sh -b -p $HOME/anaconda3
        print_info "Initializing Conda..."
        source ~/anaconda3/bin/activate
        conda init --all
        conda config --set auto_activate_base false
        print_info "Cleaning up installer..."
        rm -f Anaconda3-2024.10-1-Linux-x86_64.sh
        print_info "Conda installed and configured. Reloading shell to make conda command available..."
        exec fish
        cd - > /dev/null
    else
        print_info "Conda already installed."
    fi
fi

# --- Git Configuration ---
if prompt_with_timeout "Configure Git user profiles and SSH keys?" "y"; then
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
configure_terminal() {
    local terminal="$1"
    local config_dir="$2"
    local helper="$3"
    local config_files=("$4")
    
    if command_exists "$terminal"; then
        print_info "Configuring $terminal terminal..."
        if [ -f "$helper" ]; then
            chmod +x "$helper"
            bash -c "$helper $CURRENT_DIR"
        else
            print_warning "$terminal helper script not found at $helper. Copying config manually if possible."
            mkdir -p "$config_dir"
            for config in "${config_files[@]}"; do
                if [ -f "$config" ]; then
                    cp -f "$config" "$config_dir/$(basename "$config")"
                else
                    print_warning "$terminal config file not found at $config"
                fi
            done
        fi
    fi
}

# Install Ghostty if not present
if ! command_exists ghostty; then
    print_info "Installing Ghostty terminal..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/mkasberg/ghostty-ubuntu/HEAD/install.sh)" || print_error "Failed to install Ghostty"
    print_info "Ghostty installed successfully."
fi

configure_terminal "kitty" "$KITTY_CONFIG_DIR" "$CURRENT_DIR/helpers/kitty.sh" "$CURRENT_DIR/configs/kitty/kitty.conf"
configure_terminal "alacritty" "$ALACRITTY_CONFIG_DIR" "$CURRENT_DIR/helpers/alacritty.sh" "$CURRENT_DIR/configs/alacritty/alacritty.toml" "$CURRENT_DIR/configs/alacritty/alacritty.yml"
configure_terminal "ghostty" "$GHOSTTY_CONFIG_DIR" "" "$CURRENT_DIR/configs/ghostty/config"

# --- Docker Enablement --- 
if command_exists docker && prompt_with_timeout "Ensure Docker service is enabled and started?" "y"; then
    print_info "Ensuring Docker service is enabled and started..."
    sudo systemctl enable docker
    sudo systemctl start docker
    if ! groups $USER | grep -q '\bdocker\b'; then 
        print_info "Adding user $USER to the docker group..."
        sudo usermod -aG docker $USER
        print_warning "User $USER added to docker group. Please log out and log back in for this change to take effect."
    else
        print_info "User $USER is already in the docker group."
    fi
fi

# --- Fastfetch Configuration ---
if command_exists fastfetch; then
    print_info "Configuring Fastfetch..."
    FASTFETCH_HELPER="$CURRENT_DIR/helpers/fastfetch.sh"
    if [ -f "$FASTFETCH_HELPER" ]; then
        print_info "Setting up Fastfetch configuration..."
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

# --- Webapp Manager Installation ---
print_info "Installing Webapp Manager..."
if ! command_exists webapp-manager; then
    print_info "Downloading Webapp Manager..."
    mkdir -p ~/Downloads
    cd ~/Downloads
    wget http://packages.linuxmint.com/pool/main/w/webapp-manager/webapp-manager_1.1.5_all.deb || print_error "Failed to download Webapp Manager"
    
    print_info "Installing Webapp Manager..."
    sudo dpkg -i ./webapp-manager_1.1.5_all.deb || print_warning "Failed to install Webapp Manager package"
    sudo apt-get install -f || print_warning "Failed to install missing dependencies"
    
    print_info "Cleaning up..."
    rm -f webapp-manager_1.1.5_all.deb
    cd - > /dev/null
else
    print_info "Webapp Manager already installed."
fi

# --- KDE Force Blur Configuration ---
if prompt_with_timeout "Is this a KDE environment?" "n"; then

    
    print_info "Cloning and building KDE Force Blur..."
    if [ -d "kwin-effects-forceblur" ]; then
        print_warning "kwin-effects-forceblur directory already exists. Removing..."
        rm -rf kwin-effects-forceblur
    fi
    
    git clone https://github.com/taj-ny/kwin-effects-forceblur || print_error "Failed to clone repository"
    cd kwin-effects-forceblur || print_error "Failed to enter kwin-effects-forceblur directory"

    
    print_info "Building KDE Force Blur..."
    mkdir -p build
    cd build || print_error "Failed to enter build directory"
    cmake ../ -DCMAKE_INSTALL_PREFIX=/usr || print_error "CMake configuration failed"
    make || print_error "Build failed"
    sudo make install || print_error "Installation failed"
    
    cd "$CURRENT_DIR" || print_error "Failed to return to original directory"
    
    print_info "KDE Force Blur installed successfully!"
    print_info "To enable Force Blur:"
    print_info "1. Go to Settings > Desktop Effects"
    print_info "2. Find and enable 'Force Blur'"
    print_info "3. Configure Force Blur and set 'Enable blur all except matching'"
    print_info "4. Recommended Kvantum theme: OCEAN (https://store.kde.org/p/1427568/)"
fi

# --- ProtonUp Installation ---
if prompt_with_timeout "Install ProtonUp (Proton-GE installer)?" "y"; then
    if ! command_exists protonup-rs; then
        print_info "Installing ProtonUp..."
        
        # Clone the repository
        if [ -d "protonup-rs" ]; then
            print_warning "protonup-rs directory already exists. Removing..."
            rm -rf protonup-rs
        fi
        
        git clone https://github.com/DavidoTek/ProtonUp-rs.git protonup-rs || print_error "Failed to clone ProtonUp repository"
        cd protonup-rs || print_error "Failed to enter protonup-rs directory"
        
        # Build the project
        print_info "Building ProtonUp..."
        cargo build -p protonup-rs --release || print_error "Failed to build ProtonUp"
        
        # Install to /usr/local/bin
        print_info "Installing ProtonUp..."
        sudo mv ./target/release/protonup-rs /usr/local/bin/ || print_error "Failed to install ProtonUp"
        
        # Clean up
        cd "$CURRENT_DIR" || print_error "Failed to return to original directory"
        rm -rf protonup-rs
        
        print_info "ProtonUp installed successfully!"
        print_info "You can now use 'protonup-rs' to install Proton-GE versions."
    else
        print_info "ProtonUp already installed."
    fi
fi

# --- Final Steps ---
print_info "Debian/Kubuntu setup script completed."
print_warning "Please review any warnings above."
print_warning "Ensure your common/apt_applist.txt (for APT) and common/flatpacks.txt (for Flatpak) contain the desired packages."
print_warning "A system restart or logging out and back in is recommended for all changes to take effect (PATH, groups, services, etc.)."
print_warning "Remember to add SSH keys to GitHub if configured."
print_warning "Remember configure timeshift"

exit 0
