#!/usr/bin/env bash
# A prunable registration can hold the only surviving history of a checkout.
# Isolate graph overrides to history probes; do not add graft warnings to every Git call.
git_history() {
  GIT_GRAFT_FILE=/dev/null git -c advice.graftFileDeprecated=false "$@"
}
supported_ref_storage() {
  local storage
  storage=$(git -C "$1" config --get extensions.refStorage) || [[ $? == 1 ]] || return 1
  [[ -z "$storage" || "$storage" == files ]]
}

referenced_commits() {
  local common=$1 sha orphan
  shift
  local -a commits=()
  for sha in "$@"; do
    [[ "$sha" =~ ^([[:xdigit:]]{40}|[[:xdigit:]]{64})$ ]] || return 1
    [[ "$sha" =~ ^0+$ ]] || commits+=("$sha")  # null old/new OIDs are not commits
  done
  (( ${#commits[@]} == 0 )) && return 0
  orphan=$(git_history --git-dir="$common" rev-list -n1 "${commits[@]}" --not --branches --tags --remotes) || return 1
  [[ -z "$orphan" ]]
}

reflog_referenced() {
  local common=$1 log=$2 old new rest
  local -a commits=()
  [[ -e "$log" ]] || return 0
  [[ -r "$log" ]] || return 1
  while read -r old new rest || [[ -n "$old$new$rest" ]]; do
    commits+=("$old" "$new")
  done < "$log"
  referenced_commits "$common" "${commits[@]}"
}

worktree_history_referenced() {
  local wt=$1 common tip
  common=$(git -C "$wt" rev-parse --path-format=absolute --git-common-dir) || return 1
  tip=$(git -C "$wt" rev-parse --verify 'HEAD^{commit}') || return 1
  registration_referenced "$common" "$wt" "$tip"
}

registration_referenced() {
  local common=$1 wt=$2 tip=$3 gd location head found=0
  supported_ref_storage "$common" || return 1
  referenced_commits "$common" "$tip" || return 1
  # Porcelain has the path, not the admin-dir ID. Inspect every matching record.
  for gd in "$common"/worktrees/*; do
    [[ -d "$gd" && -r "$gd/gitdir" ]] || continue
    IFS= read -r location < "$gd/gitdir" || return 1
    [[ "$location" == "$wt/.git" ]] || continue
    found=1
    git_operation "$gd" && return 1
    head=$(git --git-dir="$gd" rev-parse --verify 'HEAD^{commit}') || return 1
    referenced_commits "$common" "$head" || return 1
    reflog_referenced "$common" "$gd/logs/HEAD" || return 1
  done
  (( found ))
}

prune_repo() {
  local common=$1 apply=$2 listing line wt="" tip="" prunable=0 blocked=0
  if ! supported_ref_storage "$common"; then
    PLAN_REVIEW+=("$common||unsupported ref storage; prune skipped"); return
  fi
  listing=$(git --git-dir="$common" worktree list --porcelain) || {
    ERRORS+=("$common||cannot inspect registrations for prune"); return;
  }
  while IFS= read -r line; do
    case "$line" in
      'worktree '*) wt=${line#worktree }; tip=""; prunable=0 ;;
      'HEAD '*) tip=${line#HEAD } ;;
      prunable|prunable\ *) prunable=1 ;;
      '')
        if (( prunable )) && ! registration_referenced "$common" "$wt" "$tip"; then
          PLAN_REVIEW+=("$wt||prunable worktree has unreferenced commits, an in-progress operation or unreadable history; repo prune skipped")
          blocked=1
        fi
        wt="" ;;
    esac
  done <<< "$listing"$'\n'
  if (( apply && ! blocked )); then
    if ! git --git-dir="$common" worktree prune; then
      ERRORS+=("$common||worktree prune failed")
    fi
  fi
}
