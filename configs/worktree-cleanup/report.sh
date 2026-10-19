#!/usr/bin/env bash
# HTML rendering for the cleanup plan; sourced by cleanup-worktrees.sh.
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
<title>Daily disk cleanup</title>
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

    echo "<h1>Daily disk cleanup</h1>"
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

    echo '<h2>Idle caches</h2><table><tr><th>Path</th><th>Kind</th></tr>'
    local cache cache_path cache_root cache_kind
    for cache in "${PLAN_CACHE[@]}"; do
      IFS='|' read -r cache_path cache_root cache_kind <<< "$cache"
      printf '<tr><td><code>%s</code></td><td>%s</td></tr>\n' "$(esc "$cache_path")" "$(esc "$cache_kind")"
    done
    echo '</table>'
    echo '<h2>Stale local branches (planned)</h2><table><tr><th>Repo</th><th>Branch</th><th>Recorded tip</th></tr>'
    local branch_entry branch_repo branch_name branch_tip
    for branch_entry in "${PLAN_BRANCH[@]}"; do
      IFS='|' read -r branch_repo branch_name branch_tip <<< "$branch_entry"
      printf '<tr><td><code>%s</code></td><td><code>%s</code></td><td><code>%s</code></td></tr>\n' "$(esc "$branch_repo")" "$(esc "$branch_name")" "$(esc "$branch_tip")"
    done
    echo '</table>'
    echo '<footer>Generated by cleanup-worktrees.sh. Logs: journalctl --user -u disk-cleanup.</footer>'
    echo '</div></body></html>'
  } >"$tmp"
  mv -f "$tmp" "$out"
}
