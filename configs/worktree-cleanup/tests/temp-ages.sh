#!/usr/bin/env bash
# Verify the replacement policy through systemd's parser, in a private root.
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
mkdir -p "$FIXTURE/root/tmp" "$FIXTURE/root/var/tmp"
export TZ=UTC
now=$(date +%s)
SYSTEMD_LOG_LEVEL=debug systemd-tmpfiles --dry-run --clean --root="$FIXTURE/root" --replace=/etc/tmpfiles.d/tmp.conf "$TEST_DIR/disk-cleanup-tmpfiles.conf" > "$FIXTURE/ages.log" 2>&1
cat "$FIXTURE/ages.log"
for item in tmp:3 var/tmp:30; do
  dir=${item%:*}; days=${item##*:}
  threshold=$(sed -n "s|.*root/$dir\" is \(.*\); age-by:.*|\\1|p" "$FIXTURE/ages.log")
  stamp=$(date -d "$threshold" +%s)
  delta=$((now - stamp - days * 86400))
  (( delta >= -5 && delta <= 5 )) || { echo "FAIL $dir did not use its $days-day age"; exit 1; }
done
echo 'PASS tmpfiles parses /tmp 3d and /var/tmp 30d'
