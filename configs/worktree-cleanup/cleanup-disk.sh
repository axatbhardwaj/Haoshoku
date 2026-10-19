#!/usr/bin/env bash
# Always run both daily steps, preserving failure from either one.
set -uo pipefail
mode=${1:---dry-run}
if [[ $# -gt 1 || ( "$mode" != --apply && "$mode" != --dry-run ) ]]; then
  echo 'Usage: cleanup-disk.sh [--dry-run|--apply]' >&2
  exit 2
fi
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd) || exit 1
status=0
"$script_dir/cleanup-worktrees.sh" "$mode" || status=1
"$script_dir/cleanup-temp.sh" "$mode" || status=1
exit "$status"
