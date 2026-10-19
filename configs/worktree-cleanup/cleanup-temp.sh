#!/usr/bin/env bash
# tmpfiles retains distro exclusions while replacing only tmp.conf's ages.
set -uo pipefail
args=(--dry-run)
case "${1:---dry-run}" in
  --apply) args=() ;;
  --dry-run) ;;
  *) echo 'Usage: cleanup-temp.sh [--dry-run|--apply]' >&2; exit 2 ;;
esac
conf="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/disk-cleanup-tmpfiles.conf"
status=0
output=$(LC_ALL=C systemd-tmpfiles "${args[@]}" --clean --replace=/etc/tmpfiles.d/tmp.conf "$conf" 2>&1) || status=$?
printf '%s\n' "$output"
if (( status == 0 )); then exit 0; fi
# User services cannot clean other users' files. Ignore only those diagnostics;
# a mixed output containing any other failure must still fail the unit.
if (( EUID != 0 )) && [[ -n "$output" ]] &&
  ! grep -Ev '^$|: Permission denied$' <<< "$output" | grep -q .; then
  exit 0
fi
exit 1
