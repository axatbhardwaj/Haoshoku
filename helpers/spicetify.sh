#!/bin/bash
current_dir=$(pwd)

# Giving folder permission
sudo chmod a+wr /opt/spotify
sudo chmod a+wr /opt/spotify/Apps -R

# Creating Extensions folder if it doesn't exist
if [ ! -d $HOME/.config/spicetify/Extensions ]; then
    echo "Creating Extensions folder"
    mkdir -p $HOME/.config/spicetify/Extensions
fi

#if .config/spotify doesn't exist, create it
if [ ! -d $HOME/.config/spotify ]; then
    echo "Creating .config/spotify folder"
    mkdir -p $HOME/.config/spotify
    touch $HOME/.config/spotify/prefs
fi

cp $current_dir/../configs/spicetify/config-xpui.ini $HOME/.config/spicetify/

# Define the expect script to handle the "Press any key to continue" prompt
expect_script=$(cat <<'EOF'
#!/usr/bin/expect -f

set timeout -1

spawn bash -c "curl -fsSL https://raw.githubusercontent.com/nimsandu/spicetify-bloom/main/install/install.sh | bash"
expect {
    "Press any key to continue or Ctrl+C to cancel" {
        send "\r"
        exp_continue
    }
}
EOF
)

cp $current_dir/../configs/spicetify/fullAppDisplayMod.js $HOME/.config/spicetify/Extensions/
spicetify config extensions fullAppDisplayMod.js

# Run the expect script
echo "$expect_script" | expect

# Lyrics extension for spicetify
spicetify config custom_apps lyrics-plus

# Apply the bloom theme
spicetify apply
