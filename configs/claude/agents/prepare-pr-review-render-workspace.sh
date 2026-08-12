#!/bin/bash
set -eu

PREFIX='/tmp/pr-review-render.'
MARKER='.pr-review-workspace'
MARKER_VALUE='pr-review-render-workspace-v1'
ATTRIBUTION_PATH='review.html'

cleanup_workspace() {
  local requested="$1" canonical git_root marker_value
  canonical=$(realpath -m -- "$requested" 2>/dev/null) || return 1
  [ "$canonical" = "$requested" ] || return 1
  case "$canonical" in /tmp/pr-review-render.????????) ;; *) return 1 ;; esac
  [ -f "$canonical/$MARKER" ] && [ ! -L "$canonical/$MARKER" ] || return 1
  marker_value=$(cat "$canonical/$MARKER" 2>/dev/null) || return 1
  [ "$marker_value" = "$MARKER_VALUE" ] || return 1
  git_root=$(git -C "$canonical" rev-parse --show-toplevel 2>/dev/null) || return 1
  [ "$git_root" = "$canonical" ] || return 1
  find "$canonical" -depth -delete
}

if [ "${1:-}" = '--cleanup' ]; then
  [ "$#" -eq 2 ] || { echo 'usage: prepare-pr-review-render-workspace.sh --cleanup <workspace>' >&2; exit 64; }
  cleanup_workspace "$2" || { echo "refusing to clean unverified render workspace: $2" >&2; exit 64; }
  exit 0
fi
[ "$#" -eq 0 ] || { echo 'usage: prepare-pr-review-render-workspace.sh [--cleanup <workspace>]' >&2; exit 64; }

umask 077
workspace=$(mktemp -d "${PREFIX}XXXXXXXX")
cleanup_on_failure() {
  cleanup_workspace "$workspace" >/dev/null 2>&1 || :
}
trap cleanup_on_failure ERR INT TERM

git -C "$workspace" init -q
printf '/%s\n' "$ATTRIBUTION_PATH" > "$workspace/.gitignore"
printf '%s\n' "$MARKER_VALUE" > "$workspace/$MARKER"
git -C "$workspace" add .gitignore "$MARKER"
git -C "$workspace" \
  -c user.name='PR Review Workflow' \
  -c user.email='pr-review-workflow@example.invalid' \
  commit -qm 'chore: initialize render workspace'

trap - ERR INT TERM
jq -n \
  --arg workspace "$workspace" \
  --arg attribution_path "$ATTRIBUTION_PATH" \
  --arg output_file "$workspace/$ATTRIBUTION_PATH" \
  '{workspace:$workspace, attribution_path:$attribution_path, output_file:$output_file}'
