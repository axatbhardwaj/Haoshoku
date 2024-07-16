# !/bin/bash
# This file is used to setup Manjro for my setup
# the commands for verbose and redundant for better calrity

set -e  # Exit on error

current_dir=$(pwd)

#pacman updates & installing rust up
sudo pacman -Syyu base-devel --noconfirm

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

####------------------------------------------------------ installng software ------------------------------------------------------####

apps=(
    
    # install Fish
    "fish"
    #installing vs-code and vscode insiders
    "visual-studio-code-bin"
    #installing Brave
    "brave-bin"
    #installing floorp
    "floorp-bin"
    #installing zip
    "zip"
    #installing Kitty
    "kitty"
    #installing signal
    "signal-desktop"
    #installing thunderbird
    "thunderbird"
    #installing noisetorch
    "noisetorch-bin"
    #installing github-cli
    "github-cli"
    #installing nvm
    "nvm"
    #installing flatpak
    "flatpak"
    #installing bitwarden
    "bitwarden"
    #installing spotify
    'spotify'
    #installing kde-partitionmanger
    "partitionmanager"
    #installing inotify
    "inotify-tools"
    #intsalling grub-btrfs
    "grub-btrfs"
    #installing webcord
    "webcord"
    #installing teams-for-linux
    "teams-for-linux"
    #installing discord screen-audio
    "discord-screenaudio"
    #installing onlyoffice
    "onlyoffice-bin"
    #insalling miniconda
    "miniconda3"
    #installing kvantum
    "kvantum"
    #installing zoxide
    "zoxide"
    #installing ticktick
    "ticktick"
    #installing telegram
    "telegram-desktop"
    #installing spicetify
    "spicetify-cli"
    #install ente-auth
    "ente-auth-bin"
    #installing qbittorrent
    "qbittorrent"
    #installing onefetch
    "onefetch"
    #installing webapp-manager
    "webapp-manager"
    #installing btop
    "btop"
    #installing nvtop
    "nvtop"
    #installing skype
    "skypeforlinux-bin"
    #installing wmctrl
    "wmctrl"
    #installing notion-app
    "notion-app-electron"
    #installing chatgpt-desktop
    "chatgpt-desktop-bin"
    #instlaling whatsdesk
    "whatsdesk-bin"
    #install fastfetch
    "fastfetch"
    #installing expect
    "expect"
    #installing vesktop
    "vencord-desktop-git"
    #installing timeshift
    "timeshift"
)

# Function to install applications
install_apps() {
    for app in "${apps[@]}"; do
        paru -S "$app" --noconfirm
    done
}

install_apps

#installing foundry
curl -L https://foundry.paradigm.xyz | bash

#installing nerd-fonts
sudo pacman -S $(pacman -Sgq nerd-fonts) --noconfirm

#gaming related congigurations
# Ask if to enable gaming

read -p "Do you want to enable gaming? (y/n): " game_on

if [ "$game_on" == "y" ]; then
    paru -S cachyos-gaming-meta protonup-rs-bin --noconfirm
fi

#####-------------------------------------- Grub fixes ------------------------------------------------#####

sudo grub-mkconfig -o /boot/grub/grub.cfg
sudo systemctl enable grub-btrfsd


#updating system
paru -Syyu --noconfirm

####---------------------------------------------configuring fish ------------------------------------------------------####

# Make Fish the default shell
chsh -s $(which fish)

# Install Fisher
fish -c "curl -sL https://git.io/fisher | source && fisher install jorgebucaran/fisher"

#installing and configuring tide
fish -c "fisher install IlanCosman/tide"

#configuring tide prmpt
fish -c "tide configure --auto --style=Lean --prompt_colors='True color' --show_time='24-hour format' --lean_prompt_height='Two lines' --prompt_connection=Solid --prompt_connection_andor_frame_color=Lightest --prompt_spacing=Sparse --icons='Many icons' --transient=Yes"


# Set aliases
fish -c 'alias dog "code"; funcsave dog;'
fish -c 'alias lss "ls -a -h"; funcsave lss;'
fish -c 'alias rmf "rm -r -f -v"; funcsave rmf;'
fish -c 'alias ps "ps auxfh"; funcsave ps;'
fish -c 'alias lss "ls -a -h"; funcsave lss;'
fish -c 'alias rmf "rm -r -f -v"; funcsave rmf;'
fish -c 'alias ps "ps auxfh"; funcsave ps;'
fish -c 'function cursor; command cursor $argv > /dev/null 2>&1 &; end; funcsave cursor'

####------------------------------------------------------configuring-fish ------------------------------------------------------####

# Configure Fish shell
#copy config.fish from config folder to ~/.config/fish

#making sure that the fish folder exists
if [ ! -d ~/.config/fish ]; then
    mkdir -p ~/.config/fish
fi

cp "$current_dir/configs/fish/config.fish" $HOME/.config/fish/config.fish


####------------------------------------------------------ git config ------------------------------------------------------####


### configuring git

# Function to prompt for user input
prompt_user() {
    read -p "$1: " user_input
    echo "$user_input"
}

# Function to generate Ed25519 SSH key
generate_ed25519_key() {
    ssh-keygen -t ed25519 -C "$1" -f "$2"
}

# Function to add SSH key to agent
add_ssh_to_agent() {
    ssh-add $1
}

# Start SSH agent
eval "$(ssh-agent -s)"

# Prompt for work profile creation
read -p "Do you want to create a work profile? (y/n): " create_work_profile

if [ "$create_work_profile" = "y" ]; then
    # Creating directory for work git
    mkdir -p ~/work
    cd ~/work
    
    # Prompt for work-related information
    work_email=$(prompt_user "Enter work email")
    work_username=$(prompt_user "Enter work username")
    github_username=$(prompt_user "Enter GitHub username for work")
    
    # Generate .gitconfig.work
    cat <<EOF > ~/work/.gitconfig.work
[user]
email = $work_email
name = $work_username

[github]
user = "$github_username"

[core]
sshCommand = "ssh -i ~/.ssh/work_key"
EOF
    
    # Generate Ed25519 SSH key for work
    generate_ed25519_key "$work_email" ~/.ssh/work_key
    
    # Add SSH key to agent
    add_ssh_to_agent ~/.ssh/work_key
fi

# Creating directory for personal git
mkdir -p ~/personal
cd ~/personal

# Prompt for personal-related information
personal_email=$(prompt_user "Enter personal email")
personal_username=$(prompt_user "Enter personal username")
github_username=$(prompt_user "Enter GitHub username for personal")

# Generate .gitconfig.personal
cat <<EOF > ~/personal/.gitconfig.personal
[user]
email = $personal_email
name = $personal_username

[github]
user = "$github_username"

[core]
sshCommand = "ssh -i ~/.ssh/personal_key"
EOF

# Generate Ed25519 SSH key for personal
generate_ed25519_key "$personal_email" ~/.ssh/personal_key

# Add SSH key to agent
add_ssh_to_agent ~/.ssh/personal_key

# Configure global gitconfig
cat <<EOF > ~/.gitconfig
[includeIf "gitdir:~/personal/"]
    path = ~/personal/.gitconfig.personal

EOF

if [ "$create_work_profile" = "y" ]; then
    cat <<EOF >> ~/.gitconfig
[includeIf "gitdir:~/work/"]
    path = ~/work/.gitconfig.work

EOF
fi

echo "CAT the .pub files and add the contents to Github.com in their respective accounts"

####---------------------------------configuring kitty terminal ------------------------------------####

# use the kitty.sh script to configure kitty

#give the script executable permissions
chmod +x "$current_dir/helpers/kitty.sh"

bash -c "$current_dir/helpers/kitty.sh $current_dir"

#######---------------------------------configuring spicetify ------------------------------------#######
#use the spicetify.sh script to configure spicetify

#give the script executable permissions
chmod +x "$current_dir/helpers/spicetify.sh"

bash -c "$current_dir/helpers/spicetify.sh $current_dir"

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

####---------------------------------configuring bluetooth ------------------------------------####

#ask if to enable bluetooth
read -p "Do you want to enable bluetooth ? (y/n): " bt_on

if [ "$bt_on"="y" ]; then
    #enable bluetooth
    sudo systemctl enable bluetooth
    sudo systemctl start bluetooth
    echo "Bluetooth enabled !"
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
    paru -S base-devel git extra-cmake-modules qt6-tools
    
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

