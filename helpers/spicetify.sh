#!/bin/bash

#this file is for configuring spiceify

#make sure spicetify-cli is installed
if ! command -v spicetify &> /dev/null
then
    echo "Spicetify not found. Installing Spicetify..."
    paru -S spicetify-cli --noconfirm
fi

#permission fix
sudo chmod a+wr /opt/spotify
sudo chmod a+wr /opt/spotify/Apps -R

#pref path
spicetify config pref_path $HOME/.config/spotify/prefs

#backup
spicetify backup
#installing spicetify-themes

echo "Installing Spicetify Themes..."

git clone --depth=1 https://github.com/spicetify/spicetify-themes.git

cd spicetify-themes
cp -r * ~/.config/spicetify/Themes

#choosing theme
spicetify config current_theme sleek
spicetify config color_scheme deeper

#apply theme
spicetify backup apply

echo "Spicetify setup complete"
