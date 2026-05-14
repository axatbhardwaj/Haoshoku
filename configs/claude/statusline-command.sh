#!/usr/bin/env bash
input=$(cat)

# ── parse JSON ──────────────────────────────────────────────────────────────
cwd=$(echo "$input"          | jq -r '.cwd // .workspace.current_dir // empty')
used=$(echo "$input"         | jq -r '.context_window.used_percentage // empty')
branch=$(echo "$input"       | jq -r '.worktree.branch // empty')
wt_name=$(echo "$input"      | jq -r '.worktree.name // empty')
wt_path=$(echo "$input"      | jq -r '.worktree.path // empty')
wt_orig=$(echo "$input"      | jq -r '.worktree.original_cwd // empty')
five_pct=$(echo "$input"     | jq -r '.rate_limits.five_hour.used_percentage // empty')
five_rst=$(echo "$input"     | jq -r '.rate_limits.five_hour.resets_at // empty')
week_pct=$(echo "$input"     | jq -r '.rate_limits.seven_day.used_percentage // empty')
week_rst=$(echo "$input"     | jq -r '.rate_limits.seven_day.resets_at // empty')
agent_name=$(echo "$input"   | jq -r '.agent.name // empty')
cost=$(echo "$input"         | jq -r '.cost.total_cost_usd // empty')
model_name=$(echo "$input"   | jq -r '.model.display_name // empty')
effort_level=$(echo "$input" | jq -r '.effort.level // empty')
thinking_on=$(echo "$input"  | jq -r '.thinking.enabled // false')
fast_on=$(echo "$input"      | jq -r '.fast_mode // false')

dir="${cwd:-$(pwd)}"
dir="${dir/#$HOME/\~}"  # collapse $HOME → ~ ; \~ escape prevents bash tilde-expansion in the replacement
user=$(whoami)
host=$(hostname -s)

# Fallback: if Claude Code didn't pipe a branch (only does so inside an actual worktree),
# ask git directly. Detached HEAD becomes empty → branch line stays hidden.
if [ -z "$branch" ]; then
  branch=$(git -C "${cwd:-$(pwd)}" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
  [ "$branch" = "HEAD" ] && branch=""
fi

# ── Deep Ocean truecolor palette ─────────────────────────────────────────────
C_RESET=$'\033[0m'
C_DIM=$'\033[38;2;125;138;166m'     # secondary  #7d8aa6 — labels, units, time tails
C_GRAY=$'\033[38;2;160;170;196m'    # secondary+ #a0aac4 — user@host
C_FG=$'\033[38;2;186;190;216m'      # white/fg   #babed8 — directory
C_CYAN=$'\033[38;2;137;221;255m'    # cyan       #89DDFF — branch
C_MAGENTA=$'\033[38;2;199;146;234m' # magenta    #C792EA — worktree, agent
C_YELLOW=$'\033[38;2;255;203;107m'  # yellow     #FFCB6B — cost, warn band
C_GREEN=$'\033[38;2;195;232;141m'   # green      #C3E88D — rl healthy
C_BLUE=$'\033[38;2;130;170;255m'    # blue       #82AAFF — ctx healthy
C_RED=$'\033[38;2;240;113;120m'     # red        #f07178 — critical band

# Cool gradient for `max` effort — green → cyan → purple, Dracula palette
C_RAIN1=$'\033[38;2;80;250;123m'    # vivid green  #50FA7B
C_RAIN2=$'\033[38;2;139;233;253m'   # vivid cyan   #8BE9FD
C_RAIN3=$'\033[38;2;189;147;249m'   # vivid purple #BD93F9

# ── helper: format seconds as XD:YH / XH:YM / XM (drop trailing zero parts) ─
fmt_diff() {
  local diff=$1
  local d=$((diff/86400))
  local h=$(( (diff%86400)/3600 ))
  local m=$(( (diff%3600)/60 ))
  if   [ "$d" -gt 0 ]; then
    if [ "$h" -gt 0 ]; then printf "%dD:%dH" "$d" "$h"
    else                    printf "%dD"     "$d"
    fi
  elif [ "$h" -gt 0 ]; then
    if [ "$m" -gt 0 ]; then printf "%dH:%dM" "$h" "$m"
    else                    printf "%dH"     "$h"
    fi
  else
    printf "%dM" "$m"
  fi
}

# ── threshold colors (applied to the number only — not labels or time tails)
ctx_color() {
  local pct
  pct=$(printf '%.0f' "${1:-0}")
  if   [ "$pct" -gt 95 ]; then printf '%s' "$C_RED"
  elif [ "$pct" -gt 80 ]; then printf '%s' "$C_YELLOW"
  else                          printf '%s' "$C_BLUE"
  fi
}

rl_color() {
  local pct
  pct=$(printf '%.0f' "${1:-0}")
  if   [ "$pct" -gt 80 ]; then printf '%s' "$C_RED"
  elif [ "$pct" -gt 50 ]; then printf '%s' "$C_YELLOW"
  else                          printf '%s' "$C_GREEN"
  fi
}

SEP="  "  # double-space between metric sections; emojis act as anchors

# ── helper: icon for the active agent (matched by base name, plugin: stripped)
agent_icon() {
  local name="${1##*:}"
  case "$name" in
    # general user agents
    developer)                             printf '💻' ;;
    architect)                             printf '🏛️' ;;
    adversarial-analyst)                   printf '⚔️' ;;
    quality-reviewer)                      printf '🔍' ;;
    sandbox-executor)                      printf '🧪' ;;

    # built-in agents
    general-purpose)                       printf '🤖' ;;
    Explore|explore)                       printf '🔎' ;;
    Plan|plan)                             printf '🧭' ;;
    claude-code-guide)                     printf '📚' ;;
    statusline-setup)                      printf '📊' ;;

    # plugin agents (pr-review-toolkit, feature-dev, codex, hookify, plugin-dev, skill-creator)
    code-reviewer)                         printf '🔍' ;;
    code-simplifier)                       printf '✂️' ;;
    code-architect)                        printf '🏗️' ;;
    code-explorer)                         printf '🧭' ;;
    comment-analyzer|conversation-analyzer) printf '💬' ;;
    pr-test-analyzer)                      printf '🧪' ;;
    silent-failure-hunter)                 printf '🕵️' ;;
    type-design-analyzer)                  printf '🏷️' ;;
    codex-rescue)                          printf '🆘' ;;
    agent-creator)                         printf '🛠️' ;;
    plugin-validator)                      printf '✅' ;;
    skill-reviewer)                        printf '🔍' ;;
    agent-sdk-verifier-py|agent-sdk-verifier-ts) printf '✅' ;;
    analyzer)                              printf '📊' ;;
    comparator)                            printf '⚖️' ;;
    grader)                                printf '🎓' ;;

    # default
    *)                                     printf '🤖' ;;
  esac
}

# ─────────────────────────────────────────────────────────────────────────────
# LINE 1 — identity + location
# Format: user@host (model)  📁 dir
# ─────────────────────────────────────────────────────────────────────────────
line_id="${C_GRAY}${user}@${host}${C_RESET}"
[ -n "$model_name" ] && line_id="${line_id} ${C_DIM}(${model_name})${C_RESET}"
line_id="${line_id}  ${C_FG}📁 ${dir}${C_RESET}"

# ─────────────────────────────────────────────────────────────────────────────
# LINE 2 — git branch (skipped when not in git)
# ─────────────────────────────────────────────────────────────────────────────
line_branch=""
[ -n "$branch" ] && line_branch="${C_CYAN}🌿 ${branch}${C_RESET}"

# ─────────────────────────────────────────────────────────────────────────────
# LINE 3 — git worktree (skipped when not in a worktree)
# ─────────────────────────────────────────────────────────────────────────────
line_wt=""
if [ -n "$wt_name" ] && [ -n "$wt_path" ] && [ -n "$wt_orig" ] && [ "$wt_path" != "$wt_orig" ]; then
  line_wt="${C_MAGENTA}🌳 ${wt_name}${C_RESET}"
fi

# ─────────────────────────────────────────────────────────────────────────────
# LINE 4 — session metrics (three-tone: dim label + bright number + dim tail)
# Format: 🤖 agent  💰 $X.XX  🧠 N%  ⌛ N%/XH:YM  📅 N%/XD:YH
# Time tails stay dim — they're informational, not alarmable
# ─────────────────────────────────────────────────────────────────────────────
line_metrics=""

if [ -n "$agent_name" ]; then
  agent_disp="${agent_name##*:}"
  line_metrics="${C_MAGENTA}$(agent_icon "$agent_name") ${agent_disp}${C_RESET}"
fi

# Reasoning effort — fast_mode wins (effort is moot when thinking is bypassed),
# otherwise show the effort ladder, color-coded by tier
if [ "$fast_on" = "true" ]; then
  [ -n "$line_metrics" ] && line_metrics="${line_metrics}${SEP}"
  line_metrics="${line_metrics}${C_YELLOW}⚡ fast${C_RESET}"
elif [ -n "$effort_level" ] && [ "$thinking_on" = "true" ]; then
  case "$effort_level" in
    low)    eff_render="${C_DIM}low${C_RESET}" ;;
    medium) eff_render="${C_BLUE}medium${C_RESET}" ;;
    high)   eff_render="${C_GREEN}high${C_RESET}" ;;
    xhigh)  eff_render="${C_MAGENTA}xhigh${C_RESET}" ;;
    max)    eff_render="${C_RAIN1}m${C_RAIN2}a${C_RAIN3}x${C_RESET}" ;;
    *)      eff_render="${C_FG}${effort_level}${C_RESET}" ;;
  esac
  [ -n "$line_metrics" ] && line_metrics="${line_metrics}${SEP}"
  line_metrics="${line_metrics}${C_DIM}💭 ${eff_render}"
fi

if [ -n "$cost" ] && [ "$cost" != "0" ] && [ "$cost" != "0.0" ]; then
  cost_fmt=$(printf '%.2f' "$cost")
  if [ "$cost_fmt" != "0.00" ]; then
    [ -n "$line_metrics" ] && line_metrics="${line_metrics}${SEP}"
    line_metrics="${line_metrics}${C_YELLOW}💰 \$${cost_fmt}${C_RESET}"
  fi
fi

if [ -n "$used" ]; then
  pct_rounded=$(printf '%.0f' "$used")
  ctx_col=$(ctx_color "$used")
  [ -n "$line_metrics" ] && line_metrics="${line_metrics}${SEP}"
  line_metrics="${line_metrics}${C_DIM}🧠 ${ctx_col}${pct_rounded}${C_DIM}%${C_RESET}"
fi

now=$(date +%s)

if [ -n "$five_pct" ] && [ -n "$five_rst" ]; then
  diff=$(( five_rst - now ))
  [ "$diff" -lt 0 ] && diff=0
  five_col=$(rl_color "$five_pct")
  [ -n "$line_metrics" ] && line_metrics="${line_metrics}${SEP}"
  line_metrics="${line_metrics}${C_DIM}⌛ ${five_col}$(printf '%.0f' "$five_pct")${C_DIM}%/$(fmt_diff "$diff")${C_RESET}"
fi

if [ -n "$week_pct" ] && [ -n "$week_rst" ]; then
  diff=$(( week_rst - now ))
  [ "$diff" -lt 0 ] && diff=0
  week_col=$(rl_color "$week_pct")
  [ -n "$line_metrics" ] && line_metrics="${line_metrics}${SEP}"
  line_metrics="${line_metrics}${C_DIM}📅 ${week_col}$(printf '%.0f' "$week_pct")${C_DIM}%/$(fmt_diff "$diff")${C_RESET}"
fi

# ── output (skip empty lines, no trailing newline) ──────────────────────────
printf '%s' "$line_id"
[ -n "$line_branch" ]  && printf '\n%s' "$line_branch"
[ -n "$line_wt" ]      && printf '\n%s' "$line_wt"
[ -n "$line_metrics" ] && printf '\n%s' "$line_metrics"
