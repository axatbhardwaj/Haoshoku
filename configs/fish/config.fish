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

    # Commands to run in interactive sessions can go here
end

set -gx CRYPTOGRAPHY_OPENSSL_NO_LEGACY 1
# Added by LM Studio CLI (lms)
set -gx PATH $PATH /home/xzat/.lmstudio/bin
