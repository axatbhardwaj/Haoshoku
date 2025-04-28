source /usr/share/cachyos-fish-config/cachyos-config.fish
function is_git_repo
    if test -d .git
        return 0
    else
        set git_root (git rev-parse --show-toplevel 2>/dev/null)
        if test -n "$git_root"
            cd $git_root   # Change directory to the root of the Git repository
            return 0
        else
            return 1
        end
    end
end

if status is-interactive
    if is_git_repo
        sleep 0.25
        onefetch
    else
        sleep 0.25
        fastfetch
    end
    zoxide init fish | source
    thefuck --alias | source
    starship init fish | source
    pyenv init - fish | source

    # Initialize Conda
    if test -d $HOME/anaconda3
        eval $HOME/anaconda3/bin/conda "shell.fish" "hook" $argv | source
    end

    # Initialize Miniconda
    if test -d /opt/miniconda3
        source /opt/miniconda3/etc/fish/conf.d/conda.fish
    end

    #===========================================
    # Functions Section
    #===========================================
    function cursor
        command cursor $argv > /dev/null 2>&1 &
    end
    
    # ===================================
    # Aliases Section
    # ===================================
    # Development
    alias dog="cursor"
    

    # File operations
    alias lss="ls -a -h"
    alias rmf="rm -r -f -v"
    
    # System commands
    alias ps="ps auxfh"
    alias tf="fuck"
    
    # Commands to run in interactive sessions can go here
end

set -gx CRYPTOGRAPHY_OPENSSL_NO_LEGACY 1
# Added by LM Studio CLI (lms)
set -gx PATH $PATH /home/xzat/.lmstudio/bin
