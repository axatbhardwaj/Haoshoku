#!/bin/bash
# This file is used to setup Manjro for my setup
#the commands for verbose and redundant for better calrity 

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
# Install Fastfetch
"fastfetch-git"
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
#installing timeshift
"timeshift"
#installing timeshift-autosnap
"timeshift-autosnap"
#installing inotify
"inotify-tools"
#intsalling grub-btrfs
"grub-btrfs"
#installing grub-customizer
"grub-customizer"
#installing webcord
"webcord"
#installing teams-for-linux
"teams-for-linux"
#installing discord screen-audio
"discord-screenaudio"
#installing onlyoffice
"onlyoffice-bin"
#installing cursor
"cursor-appimage"
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
#installing klever Notes
"klevernotes-git"
#installing anytype
"anytype-bin"
#installing spicetify 
"spicetify-cli"
#install ente-auth
"ente-auth-bin"
#installing armcord
"armcord-bin"
#installing qbittorrent
"qbittorrent"
#installing onefetch
"onefetch"
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



# Install Fisher extensions
fish -c "fisher install IlanCosman/tide"
fish -c "fisher install jorgebucaran/nvm.fish"
fish -c "fisher install jorgebucaran/replay.fish"
fish -c "fisher install franciscolourenco/done"
fish -c "fisher install gazorby/fish-abbreviation-tips"
fish -c "fisher install meaningful-ooo/sponge"

#configuring tide prmpt 
fish -c "tide configure --auto --style=Lean --prompt_colors='True color' --show_time='24-hour format' --lean_prompt_height='Two lines' --prompt_connection=Solid --prompt_connection_andor_frame_color=Darkest --prompt_spacing=Sparse --icons='Many icons' --transient=Yes"

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
cat <<EOF >> ~/.config/fish/config.fish
function is_git_repo
    if test -d .git
        return 0
    else
        set git_root (git rev-parse --show-toplevel 2>/dev/null)
        if test $status -eq 0
            return 0
        end
    end
    return 1
end

if status is-interactive
    if is_git_repo
        onefetch
    else
        fastfetch
    end
    zoxide init fish | source
    source /opt/miniconda3/etc/fish/conf.d/conda.fish
    # Commands to run in interactive sessions can go here
end

fish_add_path -a /home/axat/.foundry/bin

# bun
set --export BUN_INSTALL "$HOME/.bun"
set --export PATH $BUN_INSTALL/bin $PATH

EOF

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
# Configure Kitty terminal

#check if kitty folder exists
if [ ! -d ~/.config/kitty ]; then
    mkdir -p ~/.config/kitty
fi
#copy config file
cp -f "$current_dir/configs/kitty/kitty.conf" ~/.config/kitty/kitty.conf

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

sudo firewall-cmd --permanent --zone=public --add-service=kdeconnect
sudo firewall-cmd --reload


####--------------------------------- Spicetify config ------------------------------------####
#allowing spicetify to write to /opt/spotify
sudo chmod a+wr /opt/spotify
sudo chmod a+wr /opt/spotify/Apps -R

#making sure that the spicetify folder exists
if [ ! -d ~/.config/spicetify ]; then
    mkdir -p ~/.config/spicetify
fi

#mkaing sure spotify folder exists
if [ ! -d ~/.config/spotify ]; then
    mkdir -p ~/.config/spotify
fi

#copying spicetify config
cp -f "$current_dir/configs/spicetify/config-xpui.ini" ~/.config/spicetify/config-xpui.ini

#chaging prefs_path in spicetify config
cd ~/.config/spotify/

#savinf spotify-prefs-path to restore later
SPOTIFY_PREF_PATH=$(pwd)

#changing prefs_path
replace_string_in_file() {
    local file="$HOME/.config/spicetify/config-xpui.ini"
    local search="~/.config/spotify/prefs"
    local replace="$SPOTIFY_PREF_PATH/prefs"
    
    if [ -f "$file" ]; then
        sed -i "s|$search|$replace|g" "$file"
    else
        echo "File $file does not exist."
    fi
}

#if pref file is not present in SPOTIFY_PREF_PATH then create it
if [ ! -f "$SPOTIFY_PREF_PATH/prefs" ]; then
    touch "$SPOTIFY_PREF_PATH/prefs"
fi

replace_string_in_file


#running spicetify
spicetify backup apply 

#cloing spicetify-themes
git clone --depth=1 https://github.com/spicetify/spicetify-themes.git 

# copying spiceify-themes

cd spicetify-themes
cp -r * ~/.config/spicetify/Themes

#selecting theme
spicetify config current_theme Sleek

#selecting color scheme
spicetify config color_scheme deeper

#apply changes
spicetify apply

echo "Spicetify configured !"


#promt for gameing 
# Ask if to enable gaming
read -p "Do you want to enable gaming ? (y/n): " game_on

if [ "$game_on" == "y" ]; then
    gaming_apps=(
        "steam"
        "lutris"
        "protonup-rs-bin"
        "protontricks"
        "gamemode"
        "plasma-gamemode-git"
        "goverlay"
        "nvtop"
        "btop"
        "nvidia-settings"
        "nvdock-git"
        "linux-zen"
        "linux-zen-headers"
    )
    
    for app in "${gaming_apps[@]}"; do
        paru -S "$app" --noconfirm
    done

    # Update system before installing linux-zen
    paru -Syyu --noconfirm

    # Making grub entry for linux-zen
    sudo grub-mkconfig -o /boot/grub/grub.cfg

    echo "Games-configurations completed!
    launch steam and lutris then run:
    protonup-rs -q 
    "
fi


#ask if to enable bluetooth
read -p "Do you want to enable bluetooth ? (y/n): " bt_on

if [ "$bt_on"="y" ]; then
    #enable bluetooth
    sudo systemctl enable bluetooth
    sudo systemctl start bluetooth
    echo "Bluetooth enabled !"
fi

####------------------------------------configure Kde force blur ------------------------------------####
# Configure KDE Force Blur

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


echo "installation complete! Restart your terminal"

echo "Kvantum theme name is OCEAN link is present in script"
#https://store.kde.org/p/1427568/