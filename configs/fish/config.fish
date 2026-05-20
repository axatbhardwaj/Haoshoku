source /usr/share/cachyos-fish-config/cachyos-config.fish

if status is-interactive
    starship init fish | source

    # Two zoxide bindings: Caelestia uses `--cmd cd` for smart cd, default init also gives `z`.
    command -v direnv >/dev/null 2>&1 && direnv hook fish | source
    command -v zoxide >/dev/null 2>&1 && zoxide init fish --cmd cd | source
    command -v zoxide >/dev/null 2>&1 && zoxide init fish | source

    command -v thefuck >/dev/null 2>&1 && thefuck --alias | source
    command -v pyenv >/dev/null 2>&1 && pyenv init - fish | source

    if test -d $HOME/anaconda3
        eval $HOME/anaconda3/bin/conda "shell.fish" "hook" $argv | source
    end
    if test -d /opt/miniconda3
        source /opt/miniconda3/etc/fish/conf.d/conda.fish
    end

    function cursor
        command cursor $argv >/dev/null 2>&1 &
    end

    function antigravity
        command antigravity --new-window $argv >/dev/null 2>&1 &
    end

    alias ls='eza --icons --group-directories-first -1'
    alias dog="zeditor"
    alias agy="antigravity"
    alias lss="ls -a -h"
    alias rmf="rm -r -f -v"
    alias ps="ps auxfh"
    alias tf="fuck"

    abbr lg 'lazygit'
    abbr gd 'git diff'
    abbr ga 'git add .'
    abbr gc 'git commit -am'
    abbr gl 'git log'
    abbr gs 'git status'
    abbr gst 'git stash'
    abbr gsp 'git stash pop'
    abbr gp 'git push'
    abbr gpl 'git pull'
    abbr gsw 'git switch'
    abbr gsm 'git switch main'
    abbr gb 'git branch'
    abbr gbd 'git branch -d'
    abbr gco 'git checkout'
    abbr gsh 'git show'

    abbr l 'ls'
    abbr ll 'ls -l'
    abbr la 'ls -a'
    abbr lla 'ls -la'

    cat ~/.local/state/caelestia/sequences.txt 2>/dev/null

    # OSC 133 prompt marker for foot terminal scroll-by-prompt.
    function mark_prompt_start --on-event fish_prompt
        echo -en "\e]133;A\e\\"
    end

    source ~/.config/caelestia/user-config.fish 2>/dev/null
end

set -gx CRYPTOGRAPHY_OPENSSL_NO_LEGACY 1

# Only add to PATH if the directory exists, so the template is portable across hosts.
test -d $HOME/.lmstudio/bin; and set -gx PATH $PATH $HOME/.lmstudio/bin
test -d $HOME/go/bin; and set -gx PATH $PATH $HOME/go/bin
test -d $HOME/.claude/tmp; and set -gx TMPDIR $HOME/.claude/tmp

test -s ~/.config/envman/load.fish; and source ~/.config/envman/load.fish

# Local-only secrets (gitignored, not synced by haoshoku). Keep API keys etc. out of this file.
test -s ~/.config/fish/secrets.fish; and source ~/.config/fish/secrets.fish
