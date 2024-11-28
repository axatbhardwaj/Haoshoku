# !/bin/bash


#########---------------------------------------- installing fastanime ------------------------------------####
fish -c 'uv tool install "fastanime[standard]"'

#installing completions
mkdir -p $HOME/temps/fastanime
cd $HOME/temps/fastanime
wget "https://github.com/Benexl/FastAnime/blob/e668f9326a822f15a593afa0e261ef53f58ff1b7/completions/fastanime.fish"
fish -c "mv fastanime.fish ~/.config/fish/completions"

####---------------------------------configuring MPV ------------------------------------####
#installing uosc
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/tomasklaen/uosc/HEAD/installers/unix.sh)"