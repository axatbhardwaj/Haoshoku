#!/usr/bin/env bash
# Delete only old local refs whose commits are all reachable from remotes.
PLAN_BRANCH=()  # repo|branch|recorded tip
DONE_BRANCH=()

# Detached HEADs can still own a branch during rebase or bisect.
checked_branches() {
  local common=$1 gd state branch
  git -C "$common" worktree list --porcelain || return 1
  for gd in "$common" "$common"/worktrees/*; do
    [[ -d "$gd" ]] || continue
    for state in rebase-merge/head-name rebase-apply/head-name BISECT_START; do
      [[ -f "$gd/$state" ]] || continue
      IFS= read -r branch < "$gd/$state" || continue
      [[ -n "$branch" ]] || continue
      branch=${branch#refs/heads/}
      printf 'branch refs/heads/%s\n' "$branch"
    done
  done
}

stale_branch() {
  local repo=$1 branch=$2 tip=$3 stamp selector updated
  stamp=$(git -C "$repo" show -s --format=%ct "$tip") || return 1
  selector=$(git -C "$repo" reflog show -1 --format=%gD --date=unix "refs/heads/$branch") || return 1
  if [[ "$selector" =~ @\{([0-9]+)\} ]]; then
    updated=${BASH_REMATCH[1]}
    (( updated > stamp )) && stamp=$updated
  fi
  (( $(date +%s) - stamp >= STALE_DAYS * 86400 ))
}

plan_branches() {
  local repo=$1 base checked ref tip branch unpushed
  repo=$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir) || return
  base=$(git -C "$repo" symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null) || return 0
  # Without a known remote default, we cannot prove the default is protected.
  [[ -n "$base" ]] || return 0
  base=${base#refs/remotes/origin/}
  checked=$(checked_branches "$repo") || return
  while IFS=$'\t' read -r ref tip; do
    branch=${ref#refs/heads/}
    [[ "$branch" == "$base" || "$branch" == *'|'* ]] && continue
    grep -Fxq "branch $ref" <<< "$checked" && continue
    stale_branch "$repo" "$branch" "$tip" || continue
    unpushed=$(git -C "$repo" rev-list "$tip" --not --remotes) || continue
    [[ -z "$unpushed" ]] || continue
    PLAN_BRANCH+=("$repo|$branch|$tip")
  done < <(git -C "$repo" for-each-ref --format='%(refname)%09%(objectname)' refs/heads/)
}

apply_branches() {
  local entry repo branch tip checked unpushed out current
  for entry in "${PLAN_BRANCH[@]}"; do
    IFS='|' read -r repo branch tip <<< "$entry"
    checked=$(checked_branches "$repo") || {
      ERRORS+=("$repo|$branch|cannot recheck worktrees"); continue;
    }
    grep -Fxq "branch refs/heads/$branch" <<< "$checked" && continue
    unpushed=$(git -C "$repo" rev-list "$tip" --not --remotes) || {
      ERRORS+=("$repo|$branch|cannot recheck remote reachability"); continue;
    }
    [[ -z "$unpushed" ]] || continue
    stale_branch "$repo" "$branch" "$tip" || continue
    if out=$(git -C "$repo" update-ref -d "refs/heads/$branch" "$tip" 2>&1); then
      DONE_BRANCH+=("$repo|$branch|$tip")
    elif current=$(git -C "$repo" for-each-ref --format='%(objectname)' "refs/heads/$branch") && [[ "$current" != "$tip" ]]; then
      PLAN_KEEP+=("$repo|$branch|branch moved since planning; kept")
    else
      ERRORS+=("$repo|$branch|${out//$'\n'/ }")
    fi
  done
}
