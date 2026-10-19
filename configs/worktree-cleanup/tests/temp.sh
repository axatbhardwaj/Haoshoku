#!/usr/bin/env bash
# Exercise the service's ExecStart boundary with a harmless tmpfiles executable.
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
export TMPFILES_LOG="$FIXTURE/tmpfiles.log" TMPFILES_STATUS=0 TMPFILES_OUTPUT=''
cat > "$FIXTURE/bin/systemd-tmpfiles" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$TMPFILES_LOG"
printf '%s' "$TMPFILES_OUTPUT"
exit "$TMPFILES_STATUS"
STUB
chmod 755 "$FIXTURE/bin/systemd-tmpfiles"
while IFS= read -r line; do
  [[ "$line" == ExecStart=* ]] || continue
  command=${line#ExecStart=}
  command=${command//%h\/.local\/share\/disk-cleanup/$TEST_DIR}
  read -ra args <<< "$command"
  "${args[@]}"
done < "$TEST_DIR/disk-cleanup.service"
[[ -f "$TMPFILES_LOG" ]] || { echo 'FAIL service did not invoke tmpfiles'; exit 1; }
grep -Fxq -- '--prefix=/tmp' "$TMPFILES_LOG"
grep -Fxq -- '--prefix=/var/tmp' "$TMPFILES_LOG"
grep -Fxq -- '--clean' "$TMPFILES_LOG"
grep -Fxq -- '--replace=/etc/tmpfiles.d/tmp.conf' "$TMPFILES_LOG"
if grep -Fxq -- '--dry-run' "$TMPFILES_LOG"; then echo 'FAIL service must apply temp policy'; exit 1; fi
bash "$TEST_DIR/cleanup-temp.sh"
grep -Fxq -- '--dry-run' "$TMPFILES_LOG"
export TMPFILES_STATUS=1 TMPFILES_OUTPUT='Failed to clean: Input/output error'
if bash "$TEST_DIR/cleanup-temp.sh" --apply; then echo 'FAIL unexpected tmpfiles error ignored'; exit 1; fi
echo 'PASS temp service invocation, replacement args, dry-run and failure propagation'
