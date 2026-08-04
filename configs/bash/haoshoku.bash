# Haoshoku portable Bash additions. Omarchy's defaults load before this file.

command -v starship >/dev/null 2>&1 && eval "$(starship init bash)"
command -v direnv >/dev/null 2>&1 && eval "$(direnv hook bash)"
command -v zoxide >/dev/null 2>&1 && eval "$(zoxide init bash --cmd cd)"
command -v pyenv >/dev/null 2>&1 && eval "$(pyenv init - bash)"
command -v thefuck >/dev/null 2>&1 && eval "$(thefuck --alias)"

if [[ -x "$HOME/anaconda3/bin/conda" ]]; then
  eval "$("$HOME/anaconda3/bin/conda" shell.bash hook)"
elif [[ -x /opt/miniconda3/bin/conda ]]; then
  eval "$(/opt/miniconda3/bin/conda shell.bash hook)"
fi

cursor() { command cursor "$@" >/dev/null 2>&1 & }
antigravity() { command antigravity --new-window "$@" >/dev/null 2>&1 & }

alias ls='eza --icons --group-directories-first -1'
alias dog='zeditor'
alias agy='antigravity'
alias lss='ls -a -h'
alias ps='ps auxfh'
alias tf='fuck'

alias lg='lazygit'
alias gd='git diff'
alias ga='git add .'
alias gc='git commit -am'
alias gl='git log'
alias gs='git status'
alias gst='git stash'
alias gsp='git stash pop'
alias gp='git push'
alias gpl='git pull'
alias gsw='git switch'
alias gsm='git switch main'
alias gb='git branch'
alias gbd='git branch -d'
alias gco='git checkout'
alias gsh='git show'
alias l='ls'
alias ll='ls -l'
alias la='ls -a'
alias lla='ls -la'

for haoshoku_path in \
  "$HOME/.lmstudio/bin" \
  "$HOME/go/bin" \
  "$HOME/.cargo/bin" \
  "$HOME/.config/.foundry/bin"; do
  [[ -d "$haoshoku_path" ]] && PATH="$PATH:$haoshoku_path"
done
unset haoshoku_path
export PATH

[[ -d "$HOME/.claude/tmp" ]] && export TMPDIR="$HOME/.claude/tmp"
[[ -r "$HOME/.config/haoshoku/secrets.bash" ]] && source "$HOME/.config/haoshoku/secrets.bash"
