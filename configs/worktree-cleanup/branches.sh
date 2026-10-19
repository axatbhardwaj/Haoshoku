#!/usr/bin/env bash
# Delete only old local refs whose commits are all reachable from remotes.
PLAN_BRANCH=()  # repo|branch|recorded tip
DONE_BRANCH=()

plan_branches() {
  local repo=$1 base checked ref tip stamp branch unpushed now
  repo=$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir) || return
  base=$(git -C "$repo" symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null) || return 0
  # Without a known remote default, we cannot prove the default is protected.
  [[ -n "$base" ]] || return 0
  base=${base#refs/remotes/origin/}
  checked=$(git -C "$repo" worktree list --porcelain) || return
  now=$(date +%s)
  while IFS=$'\t' read -r ref tip stamp; do
    branch=${ref#refs/heads/}
    [[ "$branch" == "$base" || "$branch" == *'|'* ]] && continue
    grep -Fxq "branch $ref" <<< "$checked" && continue
    (( now - stamp >= STALE_DAYS * 86400 )) || continue
    unpushed=$(git -C "$repo" rev-list "$tip" --not --remotes) || continue
    [[ -z "$unpushed" ]] || continue
    PLAN_BRANCH+=("$repo|$branch|$tip")
  done < <(git -C "$repo" for-each-ref --format='%(refname)%09%(objectname)%09%(committerdate:unix)' refs/heads/)
}

apply_branches() {
  local entry repo branch tip checked unpushed out
  for entry in "${PLAN_BRANCH[@]}"; do
    IFS='|' read -r repo branch tip <<< "$entry"
    checked=$(git -C "$repo" worktree list --porcelain) || {
      ERRORS+=("$repo|$branch|cannot recheck worktrees"); continue;
    }
    grep -Fxq "branch refs/heads/$branch" <<< "$checked" && continue
    unpushed=$(git -C "$repo" rev-list "$tip" --not --remotes) || {
      ERRORS+=("$repo|$branch|cannot recheck remote reachability"); continue;
    }
    [[ -z "$unpushed" ]] || continue
    if out=$(git -C "$repo" update-ref -d "refs/heads/$branch" "$tip" 2>&1); then
      DONE_BRANCH+=("$repo|$branch|$tip")
    else
      ERRORS+=("$repo|$branch|${out//$'\n'/ }")
    fi
  done
}
