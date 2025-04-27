# !/bin/bash
# This file is used to setup Manjro for my setup
# the commands for verbose and redundant for better calrity

set -e  # Exit on error

current_dir=$(pwd)

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to print info messages
print_info() {
    echo "[INFO] $1"
}

#pacman updates & installing rust up
sudo pacman -Syu base-devel --noconfirm

curl https://sh.rustup.rs -sSf | sh -s -- -y --profile default --default-toolchain stable
source $HOME/.cargo/env


# Install Paru if not already installed
if ! command -v paru &> /dev/null
then
    echo "Paru not found. Installing Paru..."
    git clone https://aur.archlinux.org/paru.git /tmp/paru
    cd /tmp/paru
    makepkg -si --noconfirm
fi


####------------------------------------------------------- installing uv --------------------------------------------------------####
#installing uv
curl -LsSf https://astral.sh/uv/install.sh | sh

####------------------------------------------------------ installng software ------------------------------------------------------####

install_apps() {
    # Define the path to apps.txt
    APPS_FILE="$current_dir/common/paru_applist.txt"
    
    # Read the list of apps from apps.txt
    mapfile -t apps < "$APPS_FILE"
    
    # Install all apps in parallel using paru
    paru -S --noconfirm --sudoloop "${apps[@]}"
}

install_apps

# installing cursor
if ! command_exists cursor; then
    print_info "Installing Cursor IDE..."
    curl -fsSL https://raw.githubusercontent.com/watzon/cursor-linux-installer/main/install.sh | bash
    print_info "Cursor IDE installed successfully."
else
    print_info "Cursor IDE already installed."
fi


#installing foundry
curl -L https://foundry.paradigm.xyz | bash

#installing nerd-fonts
sudo pacman -S $(pacman -Sgq nerd-fonts) --noconfirm

#gaming related congigurations
# Ask if to enable gaming

read -p "Do you want to enable gaming? (y/n): " game_on

if [ "$game_on" == "y" ]; then
    paru -S cachyos-gaming-meta cachyos-gaming-applications protonup-rs-bin --noconfirm
fi


####---------------------------------------------configuring fish ------------------------------------------------------####

# Make Fish the default shell
chsh -s $(which fish)

# Install Fisher
fish -c "curl -sL https://git.io/fisher | source && fisher install jorgebucaran/fisher"

#fish extensions
fisher install meaningful-ooo/sponge
fisher install jorgebucaran/nvm.fish
fisher install franciscolourenco/done
fisher install joseluisq/gitnow@2.12.0

#configuring starship prompt
starship preset nerd-font-symbols -o ~/.config/starship.toml

####------------------------------------------------------configuring-fish ------------------------------------------------------####

# Configure Fish shell
#copy config.fish from config folder to ~/.config/fish

#making sure that the fish folder exists
if [ ! -d ~/.config/fish ]; then
    mkdir -p ~/.config/fish
fi

cp "$current_dir/configs/fish/config.fish" $HOME/.config/fish/config.fish

####--------------------------------------------------- Setting Pyenv fish --------------------------------------------------####
  set -Ux PYENV_ROOT $HOME/.pyenv
  fish_add_path $PYENV_ROOT/bin

####------------------------------------------------------ git config ------------------------------------------------------####
# ask if git configuration is required
read -p "Do you want to configure git? (y/n): " git_config


# if yes then run the configure_git.sh script
if [ "$git_config" = "y" ]; then
    #give the script executable permissions
    chmod +x "$current_dir/helpers/configure_git.sh"
    #use the configure_git.sh script to configure git
    
    bash -c "$current_dir/helpers/configure_git.sh"
fi

####---------------------------------configuring kitty terminal ------------------------------------####

# use the kitty.sh script to configure kitty

#give the script executable permissions
chmod +x "$current_dir/helpers/kitty.sh"

bash -c "$current_dir/helpers/kitty.sh $current_dir"


####---------------------------------configuring ghostty ------------------------------------####

#making sure that the ghostty folder exists in the config folder
if [ ! -d ~/.config/ghostty ]; then
    mkdir -p ~/.config/ghostty
fi
cp "$current_dir/configs/ghostty/config" $HOME/.config/ghostty/config

###########---------------------------------configuring alacritty ------------------------------------####
#use the alacritty.sh script to configure alacritty

#give the script executable permissions
chmod +x "$current_dir/helpers/alacritty.sh"

bash -c "$current_dir/helpers/alacritty.sh $current_dir"

####---------------------------KDE-connect fix----------------------------------####
if pgrep -x "kdeconnectd" > /dev/null
then
    killall kdeconnectd || true
fi

#making sure that the kdeconnect folder exists
if [ ! -d ~/.config/kdeconnect ]; then
    mkdir -p ~/.config/kdeconnect
fi

mv ~/.config/kdeconnect ~/.config/kdeconnect.bak

sudo iptables -I INPUT -p tcp --dport 1714:1764 -j ACCEPT
sudo iptables -I INPUT -p udp --dport 1714:1764 -j ACCEPT

sudo ufw allow 1714:1764/udp
sudo ufw allow 1714:1764/tcp
sudo ufw reload

#####---------------------------------installing uosc ------------------------------------####
#installing uosc
bash -c "$(curl -fsSL https://raw.githubusercontent.com/tomasklaen/uosc/HEAD/installers/unix.sh)"

####---------------------------------configuring bluetooth ------------------------------------####

#ask if to enable bluetooth
read -p "Do you want to enable bluetooth ? (y/n): " bt_on

if [ "$bt_on"="y" ]; then
    #enable bluetooth
    sudo systemctl enable bluetooth
    sudo systemctl start bluetooth
    echo "Bluetooth enabled !"
fi

#######------------------------------------Enabling Docker-------------------------#####
# Ask if user wants to enable Docker
read -p "Do you want to enable Docker? (y/n): " docker_on

if [ "$docker_on" = "y" ]; then
    # Enable and start Docker
    sudo systemctl enable docker
    sudo systemctl start docker

    # Set permissions for Docker socket
    sudo chmod 666 /var/run/docker.sock
    echo "Docker has been enabled and started!"
fi

####------------------------------------------------------------------ configuring fastfetch ------------------------------------------------------####
# Configure Fastfetch

#use the fastfetch.sh script to configure fastfetch

#give the script executable permissions
chmod +x "$current_dir/helpers/fastfetch.sh"

bash -c "$current_dir/helpers/fastfetch.sh $current_dir"

####------------------------------------configure Kde force blur ------------------------------------####
# Configure KDE Force Blur

#prompt if this is kde environment or not if yes then execute the following commands
read -p "Is this a KDE environment? (y/n): " kde_env

if [ "$kde_env" = "y" ]; then
    paru -S base-devel git extra-cmake-modules qt6-tools --noconfirm
    
    git clone https://github.com/taj-ny/kwin-effects-forceblur
    cd kwin-effects-forceblur
    mkdir build
    cd build
    cmake ../ -DCMAKE_INSTALL_PREFIX=/usr
    make
    sudo make install
    
    echo "Force blur Installed!"
    echo "Enable it from settings > desktop effects > force blur"
    echo "configure force blurr and set enable blur all except matching"
    echo "Kvantum theme name is OCEAN link is present in script"
    #https://store.kde.org/p/1427568/
    
fi

echo "installation complete! Restart your terminal"
