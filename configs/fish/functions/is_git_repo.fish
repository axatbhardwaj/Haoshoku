function is_git_repo --description 'Return 0 inside a git worktree (and cd to the repo root if in a subdir), 1 otherwise.'
    if test -d .git
        return 0
    end
    set -l git_root (git rev-parse --show-toplevel 2>/dev/null)
    if test -n "$git_root"
        cd $git_root
        return 0
    end
    return 1
end
