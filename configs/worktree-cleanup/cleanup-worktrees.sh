#!/usr/bin/env bash
# Daily disk hygiene: Git worktrees, local branches and bounded build caches.
# Default --dry-run reports only; --apply executes the validated plan.
# Filesystem/git/gh facts -> pure decide() -> execute; see test-cleanup.sh.
# Temporary files are a separate service step via cleanup-temp.sh.
#
# NOTE: no global `set -e` — this file is sourced by test-cleanup.sh, which must
# not inherit errexit. Strictness is enabled inside main() only.

# Prevent read-only status probes from refreshing the index activity timestamp.
export GIT_OPTIONAL_LOCKS=0
CLEANUP_REPO_ROOTS="${CLEANUP_REPO_ROOTS:-$HOME/defi:$HOME/dev:$HOME/Work}"
T3_WORKTREES_ROOT="${T3_WORKTREES_ROOT:-$HOME/.t3/worktrees}"
MIN_IDLE_HOURS="${MIN_IDLE_HOURS:-24}"
STALE_DAYS="${STALE_DAYS:-7}"
ACTIVE_WORK="${ACTIVE_WORK:-$HOME/ACTIVE-WORK.md}"

# Set by main() after checking gh auth. Lets pr_state_for() degrade gracefully.
GH_OK=0

# Report buckets (plan). Populated during planning, consumed by reporting.
PLAN_REMOVE=()   # wt|branch|pr|main_wt
PLAN_REVIEW=()   # wt|branch|reason
PLAN_KEEP=()     # wt|branch|pr
DONE_REMOVE=()   # wt|branch|note     (apply mode, successful)
ERRORS=()        # wt|branch|message  (apply mode, failed)

# ---------------------------------------------------------------------------
# decide(): PURE function, facts -> verdict. No I/O. Unit-tested in
# test-cleanup.sh — do not add side effects here.
#   decide <is_main> <dirty> <detached> <unpushed> <pr_state> <merged_into_base>
#          <has_artifacts> [in_use recent idle_days stale_days locked ignored_non_cache]
#   echoes: KEEP | REMOVE | REVIEW:<reason>
# ---------------------------------------------------------------------------
decide() {
  local is_main=$1 dirty=$2 detached=$3 unpushed=$4 pr=$5 merged=$6 has_artifacts=$7

  local in_use=${8:-0} recent=${9:-0} idle_days=${10:-0} stale_days=${11:-7} locked=${12:-0} ignored=${13:-0}

  # Order matters — most protective conditions first.
  [[ "$locked" == 1 || "$in_use" == 1 || "$recent" == 1 ]] && { echo "KEEP"; return; }
  [[ "$is_main" == 1 ]] && { echo "KEEP"; return; }                          # never touch the primary worktree
  [[ "$dirty" == 1 ]] && { echo "REVIEW:uncommitted changes"; return; }       # unsaved work
  if [[ "$detached" == 1 && "$unpushed" == 0 && "$has_artifacts" == 0 && "$idle_days" -ge "$stale_days" ]]; then
    if [[ "$ignored" == 1 ]]; then echo "REVIEW:ignored non-cache files"; else echo "REMOVE"; fi
    return
  fi
  [[ "$detached" == 1 ]] && { echo "REVIEW:detached HEAD"; return; }          # commits on no branch
  [[ "$pr" == OPEN ]] && { echo "KEEP"; return; }                            # active PR
  [[ "$unpushed" == 1 ]] && { echo "REVIEW:unpushed commits"; return; }       # local-only commits beyond any merge

  # Legacy artifact guard: an older worktree may still hold ignored planning
  # docs under ./superpowers/ as their only local copy. Never auto-remove it. This
  # wraps exactly the two REMOVE outcomes below; KEEP/other-REVIEW are untouched.
  local artifact_review=""
  [[ "$ignored" == 1 ]] && artifact_review="REVIEW:ignored non-cache files"
  [[ "$has_artifacts" == 1 ]] && artifact_review="REVIEW:local ./superpowers/ artifacts"

  [[ "$pr" == MERGED ]] && { echo "${artifact_review:-REMOVE}"; return; }     # done: PR merged
  [[ "$pr" == CLOSED ]] && { echo "REVIEW:PR closed unmerged"; return; }      # abandoned, may hold code
  [[ "$merged" == 1 ]] && { echo "${artifact_review:-REMOVE}"; return; }      # no PR, but merged into base
  [[ "$pr" == UNKNOWN ]] && { echo "REVIEW:gh unavailable, unmerged"; return; }
  echo "REVIEW:no PR, unmerged"
}

# ---------------------------------------------------------------------------
# git-derived facts (no network beyond what's already fetched, no gh)
# ---------------------------------------------------------------------------

# base_ref <wt>: echoes the remote base ref to compare against (e.g. origin/main).
base_ref() {
  local wt=$1 ref c
  if ref=$(git -C "$wt" symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null); then
    echo "${ref#refs/remotes/}"
    return
  fi
  for c in origin/dev origin/main origin/master; do
    if git -C "$wt" rev-parse --verify --quiet "$c" >/dev/null 2>&1; then
      echo "$c"
      return
    fi
  done
  echo ""
}

# git_facts <wt>: echoes "dirty|unpushed|merged" (detached comes from porcelain).
#   unpushed = HEAD has commit(s) reachable from NO remote-tracking ref -> data
#              would be lost on removal. This is the core safety guard.
#   merged   = HEAD is an ancestor of the remote base branch.
git_facts() {
  local wt=$1 dirty=0 unpushed=0 merged=0 n base
  local status
  status=$(git -C "$wt" status --porcelain 2>/dev/null) || dirty=1
  [[ -n "$status" ]] && dirty=1
  n=$(git -C "$wt" rev-list --count HEAD --not --remotes 2>/dev/null) || n=1
  [[ "${n:-0}" -gt 0 ]] && unpushed=1
  base=$(base_ref "$wt")
  if [[ -n "$base" ]] && git -C "$wt" merge-base --is-ancestor HEAD "$base" 2>/dev/null; then
    merged=1
  fi
  echo "${dirty}|${unpushed}|${merged}"
}

# has_artifacts <wt>: echoes 1 if an older worktree holds a non-empty ignored
# superpowers/ directory. It may be the only local copy of historical planning
# deliverables, so removal would silently destroy it.
has_artifacts() {
  local wt=$1
  if [[ -d "$wt/superpowers" ]] && [[ -n "$(find "$wt/superpowers" -type f -print -quit 2>/dev/null)" ]]; then
    echo 1
  else
    echo 0
  fi
}

# pr_state_for <wt> <branch>: echoes MERGED|CLOSED|OPEN|NONE|UNKNOWN.
#   Tries a PR number embedded in the branch name first (review/pr-103,
#   pr-101-review), then a PR whose head branch == this branch.
pr_state_for() {
  local wt=$1 branch=$2 st num
  [[ "$GH_OK" != 1 ]] && { echo "UNKNOWN"; return; }
  if [[ "$branch" =~ [pP][rR][-/_]?([0-9]+) ]]; then
    num="${BASH_REMATCH[1]}"
    if st=$( (cd "$wt" && gh pr view "$num" --json state -q .state) 2>/dev/null ); then
      echo "${st:-NONE}"; return
    fi
  fi
  if [[ -n "$branch" ]] && st=$( (cd "$wt" && gh pr view "$branch" --json state -q .state) 2>/dev/null ); then
    echo "${st:-NONE}"; return
  fi
  echo "NONE"
}

# ---------------------------------------------------------------------------
# planning
# ---------------------------------------------------------------------------

# handle_worktree <repo> <main_wt> <wt> <branch> <detached> <is_main>
handle_worktree() {
  local repo=$1 main_wt=$2 wt=$3 branch=$4 detached=$5 is_main=$6 locked=${7:-0}
  local dirty=0 unpushed=0 merged=0 pr=NONE artifacts=0 ignored=0 verdict
  local idle recent=0 busy=0
  if [[ ! -d "$wt" ]]; then
    PLAN_KEEP+=("$wt|$branch|missing directory; registration eligible for prune"); return
  fi
  idle=$(idle_seconds "$wt")
  (( idle < MIN_IDLE_HOURS * 3600 )) && recent=1
  in_use "$wt" && busy=1

  if [[ "$is_main" != 1 ]]; then
    IFS='|' read -r dirty unpushed merged <<<"$(git_facts "$wt")"
    pr=$(pr_state_for "$wt" "$branch")
    artifacts=$(has_artifacts "$wt")
    ignored_non_cache_files "$wt" && ignored=1
  fi

  verdict=$(decide "$is_main" "$dirty" "$detached" "$unpushed" "$pr" "$merged" "$artifacts" "$busy" "$recent" "$((idle / 86400))" "$STALE_DAYS" "$locked" "$ignored")

  case "$verdict" in
    REMOVE)    PLAN_REMOVE+=("$wt|$branch|$pr|$main_wt") ;;
    REVIEW:*)  PLAN_REVIEW+=("$wt|$branch|${verdict#REVIEW:}") ;;
    KEEP)      PLAN_KEEP+=("$wt|$branch|$([[ "$locked" == 1 ]] && echo locked || echo "$pr")") ;;
  esac
  if [[ "$is_main" != 1 && "$verdict" != REMOVE && "$busy" == 0 && "$locked" == 0 ]] && (( idle >= CACHE_IDLE_DAYS * 86400 )); then
    plan_build_caches "$wt"
  fi
}

# process_repo <repo_dir>: parse `git worktree list --porcelain` into blocks
# (block 0 is the primary worktree) and plan each.
process_repo() {
  local repo=$1
  plan_tagged_caches "$repo"
  plan_branches "$repo"
  local -a blocks=()
  local wt="" branch="" det=0 locked=0 line

  while IFS= read -r line; do
    if [[ "$line" == "worktree "* ]]; then
      wt="${line#worktree }"; branch=""; det=0; locked=0
    elif [[ "$line" == "branch "* ]]; then
      branch="${line#branch refs/heads/}"
    elif [[ "$line" == "detached" ]]; then
      det=1
    elif [[ "$line" == locked || "$line" == "locked "* ]]; then
      locked=1
    elif [[ -z "$line" ]]; then
      [[ -n "$wt" ]] && blocks+=("$wt|$branch|$det|$locked")
      wt=""
    fi
  done < <(git -C "$repo" worktree list --porcelain 2>/dev/null)
  [[ -n "$wt" ]] && blocks+=("$wt|$branch|$det|$locked")

  [[ ${#blocks[@]} -eq 0 ]] && return
  local main_wt="${blocks[0]%%|*}" i b_wt b_branch b_det b_locked is_main
  for i in "${!blocks[@]}"; do
    IFS='|' read -r b_wt b_branch b_det b_locked <<<"${blocks[$i]}"
    is_main=0; [[ $i -eq 0 ]] && is_main=1
    handle_worktree "$repo" "$main_wt" "$b_wt" "$b_branch" "$b_det" "$is_main" "$b_locked"
  done
}

# Filesystem-only activity collection must precede git status or other probes.
idle_seconds() {
  local wt=$1 gd="$1/.git" value newest=0 stamp now
  if [[ -f "$gd" ]]; then
    IFS= read -r value < "$gd"
    [[ "$value" == "gitdir: "* ]] || { echo 0; return; }
    gd=${value#gitdir: }
    [[ "$gd" == /* ]] || gd="$wt/$gd"
  fi
  for value in HEAD index logs/HEAD; do
    stamp=$(stat -c %Y "$gd/$value" 2>/dev/null) || continue
    (( stamp > newest )) && newest=$stamp
  done
  now=$(date +%s)
  if (( newest == 0 || newest > now )); then echo 0; else echo "$((now - newest))"; fi
}

in_use() {
  local wt cwd
  [[ -d "$1" ]] || return 1
  wt=$(realpath -e -- "$1" 2>/dev/null) || return 0
  while IFS= read -r -d '' cwd; do
    [[ "$cwd" == "$wt" || "$cwd" == "$wt/"* ]] && return 0
  done < <(readlink -z -- /proc/[0-9]*/cwd 2>/dev/null)
  return 1
}

registered_worktree() {
  local d=$1 top
  top=$(git -C "$d" rev-parse --show-toplevel 2>/dev/null) || return 1
  [[ "$top" == "$d" ]] || return 1
  git -C "$d" worktree list --porcelain | grep -Fxq "worktree $d"
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

# ---------------------------------------------------------------------------
# execution (only reached in --apply mode)
# ---------------------------------------------------------------------------

# do_remove <main_wt> <wt> <branch>
do_remove() {
  local main_wt=$1 wt=$2 branch=$3 out
  local dirty unpushed merged
  if [[ ! -d "$wt" ]]; then
    PLAN_KEEP+=("$wt|$branch|directory disappeared; kept"); return
  fi
  if [[ "$wt" != /* || "$wt" == / || -L "$wt" || "$(realpath -e -- "$wt")" != "$wt" ]]; then
    ERRORS+=("$wt|$branch|unsafe worktree path; kept"); return
  fi
  if in_use "$wt" || (( $(idle_seconds "$wt") < MIN_IDLE_HOURS * 3600 )); then
    PLAN_KEEP+=("$wt|$branch|became active; kept"); return
  fi
  if [[ -f "$(git -C "$wt" rev-parse --absolute-git-dir 2>/dev/null)/locked" ]]; then
    PLAN_KEEP+=("$wt|$branch|became locked; kept"); return
  fi
  IFS='|' read -r dirty unpushed merged <<< "$(git_facts "$wt")"
  if [[ "$dirty" == 1 || "$unpushed" == 1 ]]; then
    PLAN_KEEP+=("$wt|$branch|changed since planning; kept"); return
  fi
  if ignored_non_cache_files "$wt"; then
    PLAN_REVIEW+=("$wt|$branch|ignored non-cache files; changed since planning"); return
  fi
  if out=$(git -C "$main_wt" worktree remove "$wt" 2>&1); then
    DONE_REMOVE+=("$wt|$branch|removed worktree (branch kept)")
  else
    ERRORS+=("$wt|$branch|${out//$'\n'/ }")
  fi
}

# Missing registrations can be the only remaining reference to detached work.
prune_repo() {
  local common=$1 apply=$2 listing line wt="" tip="" orphan blocked=0
  listing=$(git --git-dir="$common" worktree list --porcelain) || {
    ERRORS+=("$common||cannot inspect registrations for prune"); return;
  }
  while IFS= read -r line; do
    case "$line" in
      'worktree '*) wt=${line#worktree }; tip="" ;;
      'HEAD '*) tip=${line#HEAD } ;;
      '')
        if [[ -n "$wt" && ! -d "$wt" ]]; then
          if [[ -z "$tip" ]] || ! orphan=$(git --git-dir="$common" rev-list -n1 "$tip" --not --branches --tags --remotes); then
            PLAN_REVIEW+=("$wt||cannot prove missing worktree commits are referenced; repo prune skipped")
            blocked=1
          elif [[ -n "$orphan" ]]; then
            PLAN_REVIEW+=("$wt||missing worktree has unreferenced commits; repo prune skipped")
            blocked=1
          fi
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

apply_plan() {
  local entry wt branch main_wt
  for entry in "${PLAN_REMOVE[@]}"; do
    IFS='|' read -r wt branch _pr main_wt <<<"$entry"
    do_remove "$main_wt" "$wt" "$branch"
  done
  apply_caches
  apply_branches
}

# ---------------------------------------------------------------------------
# reporting
# ---------------------------------------------------------------------------

# stale_active_work: echo "wt|lineno|line" for ACTIVE-WORK.md entries whose
# worktree path is in the (planned or done) removal set.
stale_active_work() {
  local mode="${1:-dry-run}"
  [[ -f "$ACTIVE_WORK" ]] || return
  # In apply mode, only the worktrees actually removed (DONE_REMOVE) are gone —
  # a planned removal that failed in do_remove() still exists. In dry-run,
  # report the planned removals.
  local -a entries=()
  if [[ "$mode" == apply ]]; then
    entries=("${DONE_REMOVE[@]:-}")
  else
    entries=("${PLAN_REMOVE[@]:-}")
  fi
  local -a removed_paths=()
  local entry wt
  for entry in "${entries[@]:-}"; do [[ -n "$entry" ]] && removed_paths+=("${entry%%|*}"); done
  [[ ${#removed_paths[@]} -eq 0 ]] && return
  for wt in "${removed_paths[@]}"; do
    awk -v p="$wt" 'substr($0,1,length(p))==p {print NR"\t"$0}' "$ACTIVE_WORK"
  done
}

# shellcheck source=branches.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/branches.sh"

# shellcheck source=caches.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/caches.sh"

# shellcheck source=report.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/report.sh"

usage() {
  cat <<EOF
Usage: cleanup-worktrees.sh [--dry-run|--apply] [--no-fetch] [--html PATH]

  --dry-run   plan and report only; delete nothing (default)
  --apply     actually remove the provably-safe worktrees
  --no-fetch  skip the per-repo 'git fetch' (faster; stale remote refs)
  --html PATH write the HTML report here (default: ~/.local/state/disk-cleanup/last-run.html)

Scope: repos under CLEANUP_REPO_ROOTS (colon-separated) and T3_WORKTREES_ROOT.
EOF
}

main() {
  set -uo pipefail   # deliberately NOT -e: many calls (grep/gh/merge-base) return non-zero by design

  local APPLY=0 FETCH=1
  local HTML_OUT="$HOME/.local/state/disk-cleanup/last-run.html"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --apply) APPLY=1 ;;
      --dry-run) APPLY=0 ;;
      --no-fetch) FETCH=0 ;;
      --html) shift; HTML_OUT="${1:?--html needs a path}" ;;
      -h|--help) usage; return 0 ;;
      *) echo "unknown arg: $1" >&2; usage; return 2 ;;
    esac
    shift
  done

  gh auth status >/dev/null 2>&1 && GH_OK=1 || GH_OK=0

  local -a repos=()
  mapfile -t repos < <(discover_repos)
  report_orphans
  [[ ${#repos[@]} -eq 0 ]] && echo "no git repos found under configured roots; nothing to prune"

  local repo common
  local -a prune_repos=()
  for repo in "${repos[@]}"; do
    if common=$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir); then
      prune_repos+=("$common")
    else
      ERRORS+=("$repo||cannot locate git common directory for prune")
    fi
  done
  if [[ $FETCH -eq 1 ]]; then
    for repo in "${repos[@]}"; do
      git -C "$repo" fetch --all --prune --quiet >/dev/null 2>&1 || true
    done
  fi

  for repo in "${repos[@]}"; do
    process_repo "$repo"
  done

  local mode="dry-run"
  [[ $APPLY -eq 1 ]] && mode="apply"
  if [[ $APPLY -eq 1 ]]; then
    apply_plan
  fi
  for common in "${prune_repos[@]}"; do
    prune_repo "$common" "$APPLY"
  done

  local ts; ts="$(date '+%Y-%m-%d %H:%M %Z')"
  mkdir -p -- "$(dirname "$HTML_OUT")" || return 1
  emit_html "$HTML_OUT" "$mode" "$ts" || return 1

  # stdout summary -> journald under systemd
  if [[ $APPLY -eq 1 ]]; then
    echo "[$ts] worktree-cleanup APPLY: removed=${#DONE_REMOVE[@]} review=${#PLAN_REVIEW[@]} kept=${#PLAN_KEEP[@]} errors=${#ERRORS[@]}"
    local e; for e in "${DONE_REMOVE[@]:-}"; do [[ -n "$e" ]] && echo "  removed: ${e%%|*}"; done
    for e in "${ERRORS[@]:-}"; do [[ -n "$e" ]] && echo "  ERROR:   $e"; done
  else
    echo "[$ts] worktree-cleanup DRY-RUN: would-remove=${#PLAN_REMOVE[@]} review=${#PLAN_REVIEW[@]} kept=${#PLAN_KEEP[@]}"
    local e; for e in "${PLAN_REMOVE[@]:-}"; do [[ -n "$e" ]] && echo "  would-remove: ${e%%|*}"; done
  fi
  echo "  caches: planned=${#PLAN_CACHE[@]} removed=${#DONE_CACHE[@]}"
  local cache
  for cache in "${PLAN_CACHE[@]}"; do echo "  cache: ${cache%%|*}"; done
  echo "  branches: planned=${#PLAN_BRANCH[@]} removed=${#DONE_BRANCH[@]}"
  echo "report: $HTML_OUT"

  # Apply-mode removal failures must fail the run so systemd marks the unit failed.
  if [[ $APPLY -eq 1 && ${#ERRORS[@]} -gt 0 ]]; then
    return 1
  fi
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
