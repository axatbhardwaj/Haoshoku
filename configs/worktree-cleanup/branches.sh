#!/usr/bin/env bash
# Delete only old local refs whose commits are all reachable from remotes.
PLAN_BRANCH=()  # repo|branch|recorded tip
DONE_BRANCH=()

git_operation() {
  local gd=$1 state
  for state in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_START BISECT_LOG sequencer index.lock HEAD.lock; do
    [[ -e "$gd/$state" || -L "$gd/$state" ]] && return 0
  done
  return 1
}

worktree_operation() {
  local gd
  gd=$(git -C "$1" rev-parse --absolute-git-dir 2>/dev/null) || return 0
  git_operation "$gd"
}

checked_branches() {
  local common=$1 gd
  git -C "$common" worktree list --porcelain || return 1
  for gd in "$common" "$common"/worktrees/*; do
    [[ -d "$gd" ]] || continue
    if git_operation "$gd"; then
      # Operations can own refs via update-refs, sequencer OIDs or bisect state.
      # Hold every branch in this repo rather than guessing those file formats.
      git -C "$common" for-each-ref --format='branch %(refname)' refs/heads/
      return
    fi
  done
}

stale_branch() {
  local repo=$1 branch=$2 tip=$3 stamp selector updated
  stamp=$(git_history -C "$repo" show -s --format=%ct "$tip") || return 1
  selector=$(git -C "$repo" reflog show -1 --format=%gD --date=unix "refs/heads/$branch") || return 1
  if [[ "$selector" =~ @\{([0-9]+)\} ]]; then
    updated=${BASH_REMATCH[1]}
    (( updated > stamp )) && stamp=$updated
  fi
  (( $(date +%s) - stamp >= STALE_DAYS * 86400 ))
}

plan_branches() {
  local repo=$1 base checked ref tip symbolic branch unpushed
  repo=$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir) || return
  base=$(git -C "$repo" symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null) || return 0
  # Without a known remote default, we cannot prove the default is protected.
  [[ "$base" == refs/remotes/origin/* ]] || return 0
  base=${base#refs/remotes/origin/}
  checked=$(checked_branches "$repo") || return
  while IFS=$'\t' read -r ref tip symbolic; do
    branch=${ref#refs/heads/}
    [[ -n "$symbolic" ]] && continue
    [[ "$branch" == "$base" || "$branch" == *'|'* ]] && continue
    grep -Fxq "branch $ref" <<< "$checked" && continue
    stale_branch "$repo" "$branch" "$tip" || continue
    unpushed=$(git_history -C "$repo" rev-list "$tip" --not --remotes) || continue
    [[ -z "$unpushed" ]] || continue
    if ! reflog_referenced "$repo" "$repo/logs/refs/heads/$branch"; then
      PLAN_REVIEW+=("$repo|$branch|unreferenced branch reflog commits; kept"); continue
    fi
    PLAN_BRANCH+=("$repo|$branch|$tip")
  done < <(git -C "$repo" for-each-ref --format='%(refname)%09%(objectname)%09%(symref)' refs/heads/)
}

apply_branches() {
  local entry repo branch tip checked unpushed out current base symbolic
  for entry in "${PLAN_BRANCH[@]}"; do
    IFS='|' read -r repo branch tip <<< "$entry"
    if ! supported_ref_storage "$repo"; then
      PLAN_REVIEW+=("$repo|$branch|unsupported ref storage; kept"); continue
    fi
    base=$(git -C "$repo" symbolic-ref --quiet refs/remotes/origin/HEAD) || continue
    [[ "$base" == refs/remotes/origin/* ]] || continue
    [[ "$branch" == "${base#refs/remotes/origin/}" ]] && continue
    symbolic=$(git -C "$repo" for-each-ref --format='%(symref)' "refs/heads/$branch") || continue
    [[ -n "$symbolic" ]] && continue
    checked=$(checked_branches "$repo") || {
      ERRORS+=("$repo|$branch|cannot recheck worktrees"); continue;
    }
    grep -Fxq "branch refs/heads/$branch" <<< "$checked" && continue
    unpushed=$(git_history -C "$repo" rev-list "$tip" --not --remotes) || {
      ERRORS+=("$repo|$branch|cannot recheck remote reachability"); continue;
    }
    [[ -z "$unpushed" ]] || continue
    current=$(git -C "$repo" for-each-ref --format='%(objectname)' "refs/heads/$branch") || continue
    if [[ "$current" != "$tip" ]]; then
      PLAN_KEEP+=("$repo|$branch|branch moved since planning; kept"); continue
    fi
    stale_branch "$repo" "$branch" "$tip" || continue
    if ! reflog_referenced "$repo" "$repo/logs/refs/heads/$branch"; then
      PLAN_REVIEW+=("$repo|$branch|branch reflog changed since planning; kept"); continue
    fi
    if out=$(git -C "$repo" update-ref --no-deref -d "refs/heads/$branch" "$tip" 2>&1); then
      DONE_BRANCH+=("$repo|$branch|$tip")
    elif current=$(git -C "$repo" for-each-ref --format='%(objectname)' "refs/heads/$branch") && [[ "$current" != "$tip" ]]; then
      PLAN_KEEP+=("$repo|$branch|branch moved since planning; kept")
    else
      ERRORS+=("$repo|$branch|${out//$'\n'/ }")
    fi
  done
}
