#!/usr/bin/env bash
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
if (( EUID != 0 )) || ! command -v setpriv >/dev/null; then
  echo 'SKIP nonroot transition needs root and setpriv'; exit 0
fi
mkdir -p "$FIXTURE/nonroot/bin"
chmod 755 "$FIXTURE/nonroot" "$FIXTURE/nonroot/bin"
cp "$TEST_DIR/cleanup-temp.sh" "$FIXTURE/nonroot/cleanup-temp.sh"
cat > "$FIXTURE/nonroot/bin/systemd-tmpfiles" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' 'Failed to clean other user: Permission denied'
if [[ "${MIXED:-0}" == 1 ]]; then
  for ((i=0;i<10000;i++)); do printf '%s\n' 'Failed to clean: Input/output error'; done
fi
exit 1
STUB
chmod 755 "$FIXTURE/nonroot/bin/systemd-tmpfiles"
cd "$FIXTURE/nonroot"
export PATH="./bin:/usr/bin:/bin"
setpriv --reuid=65534 --regid=65534 --clear-groups bash ./cleanup-temp.sh --apply > allowed.log
if MIXED=1 setpriv --reuid=65534 --regid=65534 --clear-groups bash ./cleanup-temp.sh --apply > mixed.log; then
  echo 'FAIL mixed non-permission errors were ignored'; exit 1
fi
echo 'PASS nonroot permission-only noise accepted, mixed errors fail'
