#!/usr/bin/env bash
# cleanup-worktrees.sh — weekly hygiene for git worktrees under ~/defi.
#
# Removes ONLY worktrees that are provably safe to drop (clean working tree,
# branch's PR merged — or branch merged into base — and every commit already on
# a remote). Everything uncertain (dirty, detached, unpushed, closed-unmerged,
# no-PR-and-unmerged) is REPORTED for manual review and never touched.
#
# Default mode is --dry-run (report only). Real removal requires --apply.
#
# Architecture (see test-cleanup.sh):
#   collect facts (git + gh)  ->  decide() [PURE, unit-tested]  ->  execute
#
# NOTE: no global `set -e` — this file is sourced by test-cleanup.sh, which must
# not inherit errexit. Strictness is enabled inside main() only.

DEFI_ROOT="${DEFI_ROOT:-$HOME/defi}"
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
#   echoes: KEEP | REMOVE | REVIEW:<reason>
# ---------------------------------------------------------------------------
decide() {
  local is_main=$1 dirty=$2 detached=$3 unpushed=$4 pr=$5 merged=$6 has_artifacts=$7

  # Order matters — most protective conditions first.
  [[ "$is_main" == 1 ]] && { echo "KEEP"; return; }                          # never touch the primary worktree
  [[ "$dirty" == 1 ]] && { echo "REVIEW:uncommitted changes"; return; }       # unsaved work
  [[ "$detached" == 1 ]] && { echo "REVIEW:detached HEAD"; return; }          # commits on no branch
  [[ "$pr" == OPEN ]] && { echo "KEEP"; return; }                            # active PR
  [[ "$unpushed" == 1 ]] && { echo "REVIEW:unpushed commits"; return; }       # local-only commits beyond any merge

  # Artifact guard: a worktree holding gitignored ./superpowers/ docs is the
  # only local copy of that research/plan/review — never auto-remove it. This
  # wraps exactly the two REMOVE outcomes below; KEEP/other-REVIEW are untouched.
  local artifact_review=""
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
  [[ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ]] && dirty=1
  n=$(git -C "$wt" rev-list --count HEAD --not --remotes 2>/dev/null || echo 0)
  [[ "${n:-0}" -gt 0 ]] && unpushed=1
  base=$(base_ref "$wt")
  if [[ -n "$base" ]] && git -C "$wt" merge-base --is-ancestor HEAD "$base" 2>/dev/null; then
    merged=1
  fi
  echo "${dirty}|${unpushed}|${merged}"
}

# has_artifacts <wt>: echoes 1 if the worktree holds a non-empty gitignored
# superpowers/ dir (research/plans/review HTML — the only local copy of design
# deliverables per the workspace convention). git status never reports these
# because they are gitignored, so removal would silently destroy them.
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
  local repo=$1 main_wt=$2 wt=$3 branch=$4 detached=$5 is_main=$6
  local dirty=0 unpushed=0 merged=0 pr=NONE artifacts=0 verdict

  if [[ "$is_main" != 1 ]]; then
    IFS='|' read -r dirty unpushed merged <<<"$(git_facts "$wt")"
    pr=$(pr_state_for "$wt" "$branch")
    artifacts=$(has_artifacts "$wt")
  fi

  verdict=$(decide "$is_main" "$dirty" "$detached" "$unpushed" "$pr" "$merged" "$artifacts")

  case "$verdict" in
    REMOVE)    PLAN_REMOVE+=("$wt|$branch|$pr|$main_wt") ;;
    REVIEW:*)  PLAN_REVIEW+=("$wt|$branch|${verdict#REVIEW:}") ;;
    KEEP)      PLAN_KEEP+=("$wt|$branch|$pr") ;;
  esac
}

# process_repo <repo_dir>: parse `git worktree list --porcelain` into blocks
# (block 0 is the primary worktree) and plan each.
process_repo() {
  local repo=$1
  local -a blocks=()
  local wt="" branch="" det=0 line

  while IFS= read -r line; do
    if [[ "$line" == "worktree "* ]]; then
      wt="${line#worktree }"; branch=""; det=0
    elif [[ "$line" == "branch "* ]]; then
      branch="${line#branch refs/heads/}"
    elif [[ "$line" == "detached" ]]; then
      det=1
    elif [[ -z "$line" ]]; then
      [[ -n "$wt" ]] && blocks+=("$wt|$branch|$det")
      wt=""
    fi
  done < <(git -C "$repo" worktree list --porcelain 2>/dev/null)
  [[ -n "$wt" ]] && blocks+=("$wt|$branch|$det")

  [[ ${#blocks[@]} -eq 0 ]] && return
  local main_wt="${blocks[0]%%|*}" i b_wt b_branch b_det is_main
  for i in "${!blocks[@]}"; do
    IFS='|' read -r b_wt b_branch b_det <<<"${blocks[$i]}"
    is_main=0; [[ $i -eq 0 ]] && is_main=1
    handle_worktree "$repo" "$main_wt" "$b_wt" "$b_branch" "$b_det" "$is_main"
  done
}

# discover_repos: echo one representative worktree dir per distinct repo under
# ~/defi (deduped by the shared git common-dir; non-git dirs are skipped).
discover_repos() {
  local d common
  declare -A seen=()
  for d in "$DEFI_ROOT"/*/; do
    d="${d%/}"
    common=$(git -C "$d" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || continue
    if [[ -z "${seen[$common]:-}" ]]; then
      seen[$common]=1
      echo "$d"
    fi
  done
}

# ---------------------------------------------------------------------------
# execution (only reached in --apply mode)
# ---------------------------------------------------------------------------

# do_remove <main_wt> <wt> <branch>
do_remove() {
  local main_wt=$1 wt=$2 branch=$3 out
  if out=$(git -C "$main_wt" worktree remove "$wt" 2>&1); then
    git -C "$main_wt" worktree prune >/dev/null 2>&1 || true
    if [[ -n "$branch" ]] && git -C "$main_wt" branch -d "$branch" >/dev/null 2>&1; then
      DONE_REMOVE+=("$wt|$branch|removed worktree + merged branch")
    else
      DONE_REMOVE+=("$wt|$branch|removed worktree (branch kept)")
    fi
  else
    ERRORS+=("$wt|$branch|${out//$'\n'/ }")
  fi
}

apply_plan() {
  local entry wt branch main_wt
  [[ ${#PLAN_REMOVE[@]} -eq 0 ]] && return
  for entry in "${PLAN_REMOVE[@]}"; do
    IFS='|' read -r wt branch _pr main_wt <<<"$entry"
    do_remove "$main_wt" "$wt" "$branch"
  done
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

html_escape() { sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'; }
esc() { printf '%s' "$1" | html_escape; }

emit_html() {
  local out=$1 mode=$2 ts=$3
  local tmp="${out}.tmp.$$"
  local n_remove=${#PLAN_REMOVE[@]} n_review=${#PLAN_REVIEW[@]} n_keep=${#PLAN_KEEP[@]} n_err=${#ERRORS[@]}
  local remove_label="Would remove"
  [[ "$mode" == apply ]] && remove_label="Removed"

  {
    cat <<'HTML_HEAD'
<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>~/defi worktree cleanup</title>
<style>
:root{--bg:#0d1117;--panel:#161b22;--border:#30363d;--fg:#e6edf3;--muted:#8b949e;--accent:#58a6ff;
--ok:#3fb950;--warn:#d29922;--bad:#f85149}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:40px 24px 80px}
h1{font-size:1.6rem;margin:0 0 4px}
h2{font-size:1.05rem;margin:36px 0 12px;color:var(--accent);font-weight:600}
.sub{color:var(--muted);margin:0 0 28px}
.cards{display:flex;gap:14px;flex-wrap:wrap;margin:0 0 8px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px 20px;min-width:130px}
.card .n{font-size:1.8rem;font-weight:700}
.card .l{color:var(--muted);font-size:.85rem;text-transform:uppercase;letter-spacing:.04em}
.card.remove .n{color:var(--ok)} .card.review .n{color:var(--warn)}
.card.keep .n{color:var(--accent)} .card.err .n{color:var(--bad)}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--border);border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--border);vertical-align:top}
th{color:var(--muted);font-weight:600;font-size:.8rem;text-transform:uppercase;letter-spacing:.04em}
tr:last-child td{border-bottom:none}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.86em;color:var(--fg)}
.path{color:var(--fg)} .branch{color:var(--accent)}
.reason{color:var(--warn)}
.badge{display:inline-block;padding:1px 8px;border-radius:20px;font-size:.78rem;border:1px solid var(--border)}
.badge.MERGED{color:var(--ok);border-color:var(--ok)} .badge.OPEN{color:var(--accent);border-color:var(--accent)}
.badge.CLOSED{color:var(--bad);border-color:var(--bad)} .badge.NONE,.badge.UNKNOWN{color:var(--muted)}
.empty{color:var(--muted);font-style:italic;padding:8px 2px}
footer{margin-top:48px;color:var(--muted);font-size:.82rem;border-top:1px solid var(--border);padding-top:16px}
.mode{display:inline-block;padding:2px 10px;border-radius:6px;font-size:.8rem;font-weight:600}
.mode.dry{background:#1f2937;color:var(--warn)} .mode.apply{background:#10240f;color:var(--ok)}
</style></head><body><div class="wrap">
HTML_HEAD

    echo "<h1>~/defi worktree cleanup</h1>"
    printf '<p class="sub">%s &nbsp;·&nbsp; mode: <span class="mode %s">%s</span></p>\n' \
      "$(esc "$ts")" "$([[ $mode == apply ]] && echo apply || echo dry)" \
      "$([[ $mode == apply ]] && echo APPLY || echo 'DRY-RUN (nothing deleted)')"

    echo '<div class="cards">'
    printf '<div class="card remove"><div class="n">%s</div><div class="l">%s</div></div>' "$n_remove" "$remove_label"
    printf '<div class="card review"><div class="n">%s</div><div class="l">Needs review</div></div>' "$n_review"
    printf '<div class="card keep"><div class="n">%s</div><div class="l">Kept (active)</div></div>' "$n_keep"
    [[ $mode == apply ]] && printf '<div class="card err"><div class="n">%s</div><div class="l">Errors</div></div>' "$n_err"
    echo '</div>'

    # removed / would-remove
    echo "<h2>$remove_label</h2>"
    if [[ $mode == apply ]]; then
      if [[ ${#DONE_REMOVE[@]} -eq 0 ]]; then echo '<p class="empty">none</p>'; else
        echo '<table><tr><th>Worktree</th><th>Branch</th><th>Result</th></tr>'
        local e wt br note
        for e in "${DONE_REMOVE[@]}"; do IFS='|' read -r wt br note <<<"$e"
          printf '<tr><td class="path"><code>%s</code></td><td class="branch"><code>%s</code></td><td>%s</td></tr>' \
            "$(esc "$wt")" "$(esc "$br")" "$(esc "$note")"; done
        echo '</table>'
      fi
    else
      if [[ ${#PLAN_REMOVE[@]} -eq 0 ]]; then echo '<p class="empty">none</p>'; else
        echo '<table><tr><th>Worktree</th><th>Branch</th><th>PR</th></tr>'
        local e wt br pr
        for e in "${PLAN_REMOVE[@]}"; do IFS='|' read -r wt br pr _m <<<"$e"
          printf '<tr><td class="path"><code>%s</code></td><td class="branch"><code>%s</code></td><td><span class="badge %s">%s</span></td></tr>' \
            "$(esc "$wt")" "$(esc "$br")" "$(esc "$pr")" "$(esc "$pr")"; done
        echo '</table>'
      fi
    fi

    # errors
    if [[ $mode == apply && ${#ERRORS[@]} -gt 0 ]]; then
      echo '<h2>Errors</h2><table><tr><th>Worktree</th><th>Branch</th><th>Message</th></tr>'
      local e wt br msg
      for e in "${ERRORS[@]}"; do IFS='|' read -r wt br msg <<<"$e"
        printf '<tr><td class="path"><code>%s</code></td><td class="branch"><code>%s</code></td><td>%s</td></tr>' \
          "$(esc "$wt")" "$(esc "$br")" "$(esc "$msg")"; done
      echo '</table>'
    fi

    # needs review
    echo '<h2>Needs review (kept — decide manually)</h2>'
    if [[ ${#PLAN_REVIEW[@]} -eq 0 ]]; then echo '<p class="empty">none</p>'; else
      echo '<table><tr><th>Worktree</th><th>Branch</th><th>Why</th></tr>'
      local e wt br why
      for e in "${PLAN_REVIEW[@]}"; do IFS='|' read -r wt br why <<<"$e"
        printf '<tr><td class="path"><code>%s</code></td><td class="branch"><code>%s</code></td><td class="reason">%s</td></tr>' \
          "$(esc "$wt")" "$(esc "$br")" "$(esc "$why")"; done
      echo '</table>'
    fi

    # stale ACTIVE-WORK.md
    local stale; stale=$(stale_active_work "$mode")
    if [[ -n "$stale" ]]; then
      echo '<h2>Stale ~/ACTIVE-WORK.md entries (removed worktrees — prune by hand)</h2>'
      echo '<table><tr><th>Line</th><th>Entry</th></tr>'
      while IFS=$'\t' read -r ln rest; do
        [[ -z "$ln" ]] && continue
        printf '<tr><td><code>%s</code></td><td><code>%s</code></td></tr>' "$(esc "$ln")" "$(esc "$rest")"
      done <<<"$stale"
      echo '</table>'
    fi

    echo '<h2>Kept (active / primary)</h2>'
    if [[ ${#PLAN_KEEP[@]} -eq 0 ]]; then echo '<p class="empty">none</p>'; else
      echo '<table><tr><th>Worktree</th><th>Branch</th><th>PR</th></tr>'
      local e wt br pr
      for e in "${PLAN_KEEP[@]}"; do IFS='|' read -r wt br pr <<<"$e"
        printf '<tr><td class="path"><code>%s</code></td><td class="branch"><code>%s</code></td><td><span class="badge %s">%s</span></td></tr>' \
          "$(esc "$wt")" "$(esc "$br")" "$(esc "$pr")" "$(esc "$pr")"; done
      echo '</table>'
    fi

    printf '<footer>Generated by <code>cleanup-worktrees.sh</code>. Logs: <code>journalctl --user -u defi-worktree-cleanup</code>. Re-run report: <code>%s/.worktree-cleanup/cleanup-worktrees.sh --dry-run</code>.</footer>\n' "$(esc "$DEFI_ROOT")"
    echo '</div></body></html>'
  } >"$tmp"
  mv -f "$tmp" "$out"
}

usage() {
  cat <<EOF
Usage: cleanup-worktrees.sh [--dry-run|--apply] [--no-fetch] [--html PATH]

  --dry-run   plan and report only; delete nothing (default)
  --apply     actually remove the provably-safe worktrees
  --no-fetch  skip the per-repo 'git fetch' (faster; stale remote refs)
  --html PATH write the HTML report here (default: \$DEFI_ROOT/.worktree-cleanup/last-run.html)

Scope: every git repo under \$DEFI_ROOT (default ~/defi).
EOF
}

main() {
  set -uo pipefail   # deliberately NOT -e: many calls (grep/gh/merge-base) return non-zero by design

  local APPLY=0 FETCH=1
  local HTML_OUT="$DEFI_ROOT/.worktree-cleanup/last-run.html"
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
  if [[ ${#repos[@]} -eq 0 ]]; then
    echo "no git repos found under $DEFI_ROOT" >&2
    return 1
  fi

  local repo
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
  [[ $APPLY -eq 1 ]] && apply_plan

  local ts; ts="$(date '+%Y-%m-%d %H:%M %Z')"
  emit_html "$HTML_OUT" "$mode" "$ts"

  # stdout summary -> journald under systemd
  if [[ $APPLY -eq 1 ]]; then
    echo "[$ts] worktree-cleanup APPLY: removed=${#DONE_REMOVE[@]} review=${#PLAN_REVIEW[@]} kept=${#PLAN_KEEP[@]} errors=${#ERRORS[@]}"
    local e; for e in "${DONE_REMOVE[@]:-}"; do [[ -n "$e" ]] && echo "  removed: ${e%%|*}"; done
    for e in "${ERRORS[@]:-}"; do [[ -n "$e" ]] && echo "  ERROR:   $e"; done
  else
    echo "[$ts] worktree-cleanup DRY-RUN: would-remove=${#PLAN_REMOVE[@]} review=${#PLAN_REVIEW[@]} kept=${#PLAN_KEEP[@]}"
    local e; for e in "${PLAN_REMOVE[@]:-}"; do [[ -n "$e" ]] && echo "  would-remove: ${e%%|*}"; done
  fi
  echo "report: $HTML_OUT"

  # Apply-mode removal failures must fail the run so systemd marks the unit failed.
  if [[ $APPLY -eq 1 && ${#ERRORS[@]} -gt 0 ]]; then
    return 1
  fi
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
