function fish_greeting
    if test -r ~/.local/share/caelestia/assets/ascii.txt
        # Defer to Caelestia's branded ASCII when present.
        set_color brblack
        cat ~/.local/share/caelestia/assets/ascii.txt 2>/dev/null
        set_color normal
    end
    if is_git_repo
        sleep 0.25
        command -v onefetch >/dev/null 2>&1 && onefetch
    else
        sleep 0.25
        command -v fastfetch >/dev/null 2>&1 && fastfetch --key-padding-left 5
    end
end
