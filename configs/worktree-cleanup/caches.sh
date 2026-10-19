#!/usr/bin/env bash
# Bounded build caches and explicitly tagged Axstack evidence.
CACHE_IDLE_DAYS="${CACHE_IDLE_DAYS:-3}"
PLAN_CACHE=()  # path|owning root|build or tagged
DONE_CACHE=()

# Require a canonical absolute descendant, rejecting symlinks in every component.
safe_directory() {
  local root=$1 target=$2 resolved
  [[ "$root" == /* && "$root" != / && "$target" == "$root/"* && -d "$target" && ! -L "$target" ]] || return 1
  resolved=$(realpath -e -- "$target") || return 1
  [[ "$resolved" == "$target" && "$(realpath -e -- "$root")" == "$root" ]]
}

ignored_build_cache() {
  local wt=$1 target=$2 rel tracked other
  safe_directory "$wt" "$target" || return 1
  case "${target##*/}" in node_modules|target|cargo-target|.next|.turbo) ;; *) return 1 ;; esac
  rel=${target#"$wt/"}
  git -C "$wt" check-ignore -q -- "$rel/" || return 1
  tracked=$(git -C "$wt" ls-files -- "$rel") || return 1
  other=$(git -C "$wt" ls-files --others --exclude-standard -- "$rel") || return 1
  [[ -z "$tracked" && -z "$other" ]]
}

# A cache can serve other worktrees even when its owner is idle.
private_build_cache() {
  local wt=$1 target=$2 listing line other link resolved first=1
  listing=$(git -C "$wt" worktree list --porcelain) || return 1
  while IFS= read -r line; do
    [[ "$line" == 'worktree '* ]] || continue
    other=${line#worktree }
    if (( first )); then
      [[ "$other" == "$wt" ]] && return 1  # primary caches are never pruned
      first=0
    fi
    [[ "$other" != "$wt" && -d "$other" ]] || continue
    while IFS= read -r -d '' link; do
      resolved=$(realpath -e -- "$link" 2>/dev/null) || continue
      [[ "$resolved" == "$target" || "$resolved" == "$target/"* ]] && return 1
    done < <(find "$other" -type l -print0)
  done <<< "$listing"
  return 0
}

plan_build_caches() {
  local wt=$1 rel target
  while IFS= read -r -d '' rel; do
    [[ "$rel" == */ ]] || continue
    target="$wt/${rel%/}"
    if ignored_build_cache "$wt" "$target" && private_build_cache "$wt" "$target"; then
      PLAN_CACHE+=("$target|$wt|build")
    fi
  done < <(git -C "$wt" ls-files --others --ignored --exclude-standard --directory -z)
}

idle_tagged_cache() {
  local root=$1 target=$2 signature='Signature: 8a477f597d28d172789f06886806bc55' newer
  safe_directory "$root" "$target" || return 1
  [[ -f "$target/CACHEDIR.TAG" && ! -L "$target/CACHEDIR.TAG" ]] || return 1
  [[ "$(head -c "${#signature}" -- "$target/CACHEDIR.TAG")" == "$signature" ]] || return 1
  newer=$(find "$target" -type f -newermt "$CACHE_IDLE_DAYS days ago" -print -quit) || return 1
  [[ -z "$newer" ]]
}

plan_tagged_caches() {
  local repo=$1 common root tag target
  common=$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir) || return
  [[ -d "$common/axstack/runs" ]] || return 0
  while IFS= read -r -d '' root; do
    while IFS= read -r -d '' tag; do
      target=${tag%/CACHEDIR.TAG}
      if idle_tagged_cache "$root" "$target"; then
        PLAN_CACHE+=("$target|$root|tagged")
      fi
    done < <(find "$root" -type f -name CACHEDIR.TAG -print0)
  done < <(find "$common/axstack/runs" -mindepth 2 -maxdepth 2 -type d -name evidence -print0)
}

apply_caches() {
  local entry target root kind
  for entry in "${PLAN_CACHE[@]}"; do
    IFS='|' read -r target root kind <<< "$entry"
    # A parent tagged cache may already have removed this planned descendant.
    [[ -e "$target" || -L "$target" ]] || continue
    if [[ "$kind" == build ]]; then
      if in_use "$root" || (( $(idle_seconds "$root") < CACHE_IDLE_DAYS * 86400 )) || ! ignored_build_cache "$root" "$target" || ! private_build_cache "$root" "$target"; then
        PLAN_KEEP+=("$target||cache changed since planning; kept"); continue
      fi
    elif ! idle_tagged_cache "$root" "$target"; then
      PLAN_KEEP+=("$target||tagged cache changed since planning; kept"); continue
    fi
    # No force, no variable glob, and no symlink traversal by rm.
    if rm -r -- "${target:?}"; then
      DONE_CACHE+=("$target|$kind")
    else
      ERRORS+=("$target||cache removal failed")
    fi
  done
}
