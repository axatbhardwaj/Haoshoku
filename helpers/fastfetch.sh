#this script if for fastfetch configuration

fastfetch --gen-config

cd $HOME/.config/fastfetch

rm config.jsonc

wget https://raw.githubusercontent.com/xerolinux/xero-layan-git/main/Configs/Home/.config/fastfetch/config.jsonc

echo "Fastfetch setup complete"