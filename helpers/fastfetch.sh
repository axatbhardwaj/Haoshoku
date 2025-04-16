# !/bin/bash

# This script is for fastfetch configuration

# Take the current directory as argument
current_dir=$1

# Ensure the target directory exists
mkdir -p "$HOME/.config/fastfetch"

# Force copy the config file, overwriting if it exists
cp -f "$current_dir/configs/fastfetch/config.jsonc" "$HOME/.config/fastfetch/config.jsonc"

echo "Fastfetch user config updated."