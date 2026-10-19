#!/usr/bin/env bash
# A prunable registration can hold the only surviving history of a checkout.
referenced_commit() {
  local common=$1 sha=$2 orphan
  [[ "$sha" =~ ^([[:xdigit:]]{40}|[[:xdigit:]]{64})$ ]] || return 1
  [[ "$sha" =~ ^0+$ ]] && return 0  # reflog's null old/new OID
  orphan=$(git --git-dir="$common" rev-list -n1 "$sha" --not --branches --tags --remotes) || return 1
  [[ -z "$orphan" ]]
}

registration_referenced() {
  local common=$1 wt=$2 tip=$3 gd location old new rest head found=0
  referenced_commit "$common" "$tip" || return 1
  # Porcelain has the path, not the admin-dir ID. Inspect every matching record.
  for gd in "$common"/worktrees/*; do
    [[ -d "$gd" && -r "$gd/gitdir" ]] || continue
    IFS= read -r location < "$gd/gitdir" || return 1
    [[ "$location" == "$wt/.git" ]] || continue
    found=1
    head=$(git --git-dir="$gd" rev-parse --verify 'HEAD^{commit}') || return 1
    referenced_commit "$common" "$head" || return 1
    if [[ -e "$gd/logs/HEAD" ]]; then
      [[ -r "$gd/logs/HEAD" ]] || return 1
      while read -r old new rest || [[ -n "$old$new$rest" ]]; do
        referenced_commit "$common" "$old" && referenced_commit "$common" "$new" || return 1
      done < "$gd/logs/HEAD"
    fi
  done
  (( found ))
}

prune_repo() {
  local common=$1 apply=$2 listing line wt="" tip="" prunable=0 blocked=0
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
          PLAN_REVIEW+=("$wt||prunable worktree has unreferenced commits or unreadable history; repo prune skipped")
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
