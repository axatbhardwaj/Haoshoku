#!/usr/bin/env bash
# Repository discovery and report-only T3 orphan detection.
registered_worktree() {
  local d=$1 top listing
  top=$(git -C "$d" rev-parse --show-toplevel 2>/dev/null) || return 1
  [[ "$top" == "$d" ]] || return 1
  listing=$(git -C "$d" worktree list --porcelain) || return 1
  grep -Fxq "worktree $d" <<< "$listing"
}

repo_candidates() {
  local root d
  local -a roots
  IFS=: read -ra roots <<< "$CLEANUP_REPO_ROOTS"
  for root in "${roots[@]}"; do
    [[ -d "$root" ]] || continue
    find "$root" -mindepth 1 -maxdepth 1 -type d -print0
  done
  [[ -d "$T3_WORKTREES_ROOT" ]] || return 0
  while IFS= read -r -d '' d; do
    registered_worktree "$d" && printf '%s\0' "$d"
  done < <(find "$T3_WORKTREES_ROOT" -mindepth 2 -maxdepth 2 -type d -print0)
}

discover_repos() {
  local d common
  declare -A seen=()
  while IFS= read -r -d '' d; do
    common=$(git -C "$d" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || continue
    common=$(realpath -e -- "$common") || continue
    if [[ -z "${seen[$common]:-}" ]]; then
      seen[$common]=1
      echo "$d"
    fi
  done < <(repo_candidates)
}

report_orphans() {
  local d
  [[ -d "$T3_WORKTREES_ROOT" ]] || return 0
  while IFS= read -r -d '' d; do
    registered_worktree "$d" || PLAN_REVIEW+=("$d||unregistered T3 directory (report only)")
  done < <(find "$T3_WORKTREES_ROOT" -mindepth 2 -maxdepth 2 -type d -print0)
}

