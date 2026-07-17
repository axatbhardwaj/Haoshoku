#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────────
# Caelestia lock-screen portrait fix — apply / re-apply.
#
# Makes the lock panel AND its centre column scale to the screen
# WIDTH, so they stop overflowing (and misaligning on) portrait
# monitors. Touches two files: LockSurface.qml and Center.qml.
#
# First run installs the fix. If a `caelestia-shell` package
# update later reverts the files, just run this again:
#     bash ~/.local/share/caelestia-lockfix/apply.sh
# ───────────────────────────────────────────────────────────────
set -u

DIR=/etc/xdg/quickshell/caelestia/modules/lock
KIT="$HOME/.local/share/caelestia-lockfix"

# apply_one <file> <already-applied-marker> <stale-draft-marker|"">
#   returns 0 = patched, 2 = already applied, 1 = failed
apply_one() {
    local name="$1" marker="$2" stale="$3"
    local dst="$DIR/$name" patch="$KIT/$name.portrait-fix.patch"

    [ -f "$dst" ]   || { echo "  ✗ $name: $dst missing"; return 1; }
    [ -f "$patch" ] || { echo "  ✗ $name: patch file missing"; return 1; }

    # Heal: an earlier draft of this patch is installed — restore pristine first.
    if [ -n "$stale" ] && grep -q "$stale" "$dst" && [ -f "$dst.orig" ]; then
        echo "  • $name: clearing an earlier draft patch"
        sudo cp -a "$dst.orig" "$dst"
    fi

    if grep -q "$marker" "$dst"; then
        echo "  ✓ $name: fix already present"
        return 2
    fi

    sudo cp -a "$dst" "$dst.orig"            # refresh pristine backup
    if sudo patch -N "$dst" < "$patch"; then
        echo "  ✓ $name: patched"
        return 0
    fi
    echo "  ✗ $name: patch failed — restoring original"
    sudo cp -a "$dst.orig" "$dst"
    return 1
}

echo "═══ Caelestia portrait lock-screen fix ═══"
changed=0; failed=0
apply_one LockSurface.qml 'lockContent?.fitBase' 'contentItem.Tokens'; rc=$?
[ "$rc" = 0 ] && changed=1
[ "$rc" = 1 ] && failed=1
apply_one Center.qml 'lock.fitBase' ''; rc=$?
[ "$rc" = 0 ] && changed=1
[ "$rc" = 1 ] && failed=1

if [ "$failed" = 1 ]; then
    echo
    echo "✗ A patch failed — caelestia-shell likely changed these files."
    echo "  Originals are intact at $DIR/*.orig. Shell not restarted."
    exit 1
fi

if [ "$changed" = 0 ]; then
    echo
    echo "✓ Fix already fully applied — nothing to do."
    exit 0
fi

echo
echo "═══ Restarting Caelestia shell ═══"
caelestia shell -k 2>/dev/null
sleep 1.5
caelestia shell -d 2>/dev/null
echo "  waiting for the shell to come back..."
sleep 4

if pgrep -af 'qs -c caelestia' >/dev/null; then
    echo "  ✓ Caelestia shell running — config loaded cleanly."
    echo
    echo "  ▶ NEXT: press  Super+L  to lock, then check the portrait monitor."
else
    echo "  ✗ shell did NOT come back — auto-reverting both files."
    sudo cp -a "$DIR/LockSurface.qml.orig" "$DIR/LockSurface.qml"
    [ -f "$DIR/Center.qml.orig" ] && sudo cp -a "$DIR/Center.qml.orig" "$DIR/Center.qml"
    caelestia shell -k 2>/dev/null; sleep 1.5; caelestia shell -d 2>/dev/null
    echo "  waiting for the reverted shell to come back..."
    sleep 4
    if pgrep -af 'qs -c caelestia' >/dev/null; then
        echo "  ↩ reverted; shell restarted with the originals."
    else
        echo "  ✗ reverted; shell restart failed. Check Caelestia manually."
    fi
    exit 2
fi
