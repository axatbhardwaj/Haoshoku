#!/usr/bin/env bash
# Tests for haoshoku-gaming-workspace.
#
# The decision logic is sourced as a library (HAOSHOKU_GAMING_WORKSPACE_LIB=1) so the
# pure functions can be exercised without a compositor. The `place` cases run the real
# script, because the property that matters there -- that a broken watcher cannot break
# the launch -- only exists in the assembled program.

set -uo pipefail

SCRIPT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)/configs/scripts/haoshoku-gaming-workspace"
FIXTURES="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/fixtures"

pass=0 fail=0

ok() { printf '  ok   %s\n' "$1"; pass=$((pass + 1)); }
no() { printf '  FAIL %s\n       expected: %s\n       actual:   %s\n' "$1" "$2" "$3"; fail=$((fail + 1)); }

is() { # is <name> <expected> <actual>
  [ "$2" = "$3" ] && ok "$1" || no "$1" "$2" "$3"
}

[ -f "$SCRIPT" ] || { echo "haoshoku-gaming-workspace not found at $SCRIPT" >&2; exit 1; }

# shellcheck source=/dev/null
HAOSHOKU_GAMING_WORKSPACE_LIB=1 . "$SCRIPT"

echo "match_client_for_pids"

is "matches the launched pid directly" \
   "0xAAA" "$(match_client_for_pids "$FIXTURES/clients-two.json" 1111 || echo '')"

# The case that actually happens under Proton: the window belongs to a descendant,
# never to the pid the wrapper launched.
is "matches a descendant pid, not the launched one" \
   "0xBBB" "$(match_client_for_pids "$FIXTURES/clients-two.json" 2222 3333 || echo '')"

is "no match returns empty" \
   "" "$(match_client_for_pids "$FIXTURES/clients-two.json" 9999 || echo '')"

is "no match exits non-zero" \
   "1" "$(match_client_for_pids "$FIXTURES/clients-two.json" 9999 >/dev/null; echo $?)"

is "empty client list returns empty" \
   "" "$(match_client_for_pids "$FIXTURES/clients-empty.json" 1111 || echo '')"

is "malformed json returns empty, does not crash" \
   "" "$(match_client_for_pids "$FIXTURES/clients-malformed.json" 1111 || echo '')"

is "malformed json exits non-zero" \
   "1" "$(match_client_for_pids "$FIXTURES/clients-malformed.json" 1111 >/dev/null; echo $?)"

is "missing file exits non-zero" \
   "1" "$(match_client_for_pids "$FIXTURES/nope.json" 1111 >/dev/null; echo $?)"

# Elden Ring puts up an EasyAntiCheat splash and then the game window, both owned by
# the same pid. Returning only the first would place the splash and strand the game.
is "returns every window owned by the tree, not just the first" \
   "0xSPLASH 0xGAME" "$(match_client_for_pids "$FIXTURES/clients-two-same-pid.json" 4444 | tr '\n' ' ' | sed 's/ $//')"

echo "toggle_target"

is "on the gaming workspace, go back" \
   "previous" "$(toggle_target "$FIXTURES/activeworkspace-11.json")"

is "elsewhere, go to the gaming workspace" \
   "11" "$(toggle_target "$FIXTURES/activeworkspace-3.json")"

# A compositor query that returns nothing must not strand the user: defaulting to the
# gaming workspace is recoverable by pressing the key again, defaulting to `previous`
# from an unknown state is not.
is "unreadable state defaults to the gaming workspace" \
   "11" "$(toggle_target "$FIXTURES/activeworkspace-empty.json")"

is "missing file defaults to the gaming workspace" \
   "11" "$(toggle_target "$FIXTURES/nope.json")"

TD="$(mktemp -d)"
trap 'rm -rf "$TD"' EXIT

echo "toggle (mktemp failure)"

toggle_dispatch="$(
  (
    mktemp() { return 1; }
    dispatch() { printf '%s\n' "$*"; }
    haoshoku-special-workspace() { :; }
    cmd_toggle
  ) 2>/dev/null
)"
is "mktemp failure still defaults the toggle to workspace 11" "workspace 11" "$toggle_dispatch"

echo "collect_descendants"

# Real process tree rather than a fixture: the /proc walk is the part that can be wrong.
bash -c "sleep 5 & echo \$! > '$TD/gw-test-child.pid'; wait" &
parent=$!
child=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ -s "$TD/gw-test-child.pid" ] && child="$(cat "$TD/gw-test-child.pid")" && break
  sleep 0.2
done

if [ -n "$child" ]; then
  descendants="$(collect_descendants "$parent")"
  case " $descendants " in
    *" $parent "*) ok "includes the parent itself" ;;
    *) no "includes the parent itself" "$parent in set" "$descendants" ;;
  esac
  case " $descendants " in
    *" $child "*) ok "includes a live child" ;;
    *) no "includes a live child" "$child in set" "$descendants" ;;
  esac
else
  no "spawns a test process tree" "a child pid" "none captured"
fi
kill "$parent" 2>/dev/null; wait "$parent" 2>/dev/null
rm -f "$TD/gw-test-child.pid"

is "a dead pid yields an empty set" \
   "" "$(collect_descendants 2147483646)"

echo "place (integration)"

is "missing -- separator exits 2" \
   "2" "$("$SCRIPT" place /bin/true >/dev/null 2>&1; echo $?)"

is "no command after -- exits 2" \
   "2" "$("$SCRIPT" place -- >/dev/null 2>&1; echo $?)"

# The whole point of the wrapper: it is transparent. A game that exits 0 must not
# become non-zero because a watcher failed, and a game that fails must still report it.
is "passes through a zero exit status" \
   "0" "$("$SCRIPT" place -- /bin/true >/dev/null 2>&1; echo $?)"

is "passes through a non-zero exit status" \
   "1" "$("$SCRIPT" place -- /bin/false >/dev/null 2>&1; echo $?)"

is "passes through an arbitrary exit status" \
   "42" "$("$SCRIPT" place -- bash -c 'exit 42' >/dev/null 2>&1; echo $?)"

is "unknown verb exits 2" \
   "2" "$("$SCRIPT" wibble >/dev/null 2>&1; echo $?)"

echo "place (window placement)"

cat > "$TD/placing-hyprctl" <<EOS
#!/usr/bin/env bash
if [ "\$1 \$2" = "clients -j" ]; then
  pid=\$(cat "\$PID_FILE" 2>/dev/null) || exit 1
  if [ -e "\$POLL_MARKER" ]; then address=0xDIALOG
  else address=0xCAFE; : > "\$POLL_MARKER"; fi
  printf '[{"address":"%s","pid":%s}]\n' "\$address" "\$pid"
else
  printf '%s\n' "\$*" >> "\$DISPATCH_LOG"
fi
EOS
chmod +x "$TD/placing-hyprctl"

PID_FILE="$TD/place.pid" POLL_MARKER="$TD/polled" DISPATCH_LOG="$TD/dispatches" \
  HAOSHOKU_GW_HYPRCTL="$TD/placing-hyprctl" \
  "$SCRIPT" place -- bash -c "echo \$\$ > '$TD/place.pid'; sleep 1" >/dev/null 2>&1
is "moves the wrapped process window silently to workspace 11" "1" \
   "$(grep -cFx 'dispatch movetoworkspacesilent 11,address:0xCAFE' "$TD/dispatches")"
is "moves every later window silently" "1" \
   "$(grep -cFx 'dispatch movetoworkspacesilent 11,address:0xDIALOG' "$TD/dispatches")"
is "focuses workspace 11 only on the first placement" "1" \
   "$(grep -cFx 'dispatch workspace 11' "$TD/dispatches")"

echo "place (shutdown path)"

# Everything below exists because a green suite of synchronous-exit cases hid two real
# defects: an interrupted `wait` reporting 143 while the game was still alive, and a
# descendant surviving the stop button. Shutdown is where a launch wrapper does harm.


# Every child below touches a ready file AFTER installing its handlers, and the tests
# wait for that file rather than sleeping a guessed interval. A fixed sleep raced
# python's startup here and produced a failure that was purely the harness's.
await_ready() { # await_ready <file>
  local i
  for i in $(seq 1 100); do
    [ -e "$1" ] && return 0
    sleep 0.1
  done
  return 1
}

cat > "$TD/slow-term" <<EOS
#!/usr/bin/env bash
# Exits 42, but not instantly -- the wrapper must wait for it rather than report 143.
trap 'sleep 1; echo TERM > "$TD/signal"; exit 42' TERM
touch "$TD/ready"
sleep 30
EOS

# Python, not bash, and that is the whole point. Bash sets SIGINT to SIG_IGN on async
# children of a non-interactive shell and then cannot trap it, so a bash child could
# never observe a forwarded INT no matter what the wrapper does -- it would test the
# shell's rule, not this script. Python's signal.signal overrides SIG_IGN, so this
# child can prove which signal actually arrived.
cat > "$TD/signal-identity" <<EOS
#!/usr/bin/env python3
import signal, sys, time
def rec(name, code):
    def handler(*_):
        open("$TD/signal", "w").write(name)
        sys.exit(code)
    return handler
signal.signal(signal.SIGINT, rec("INT", 7))
signal.signal(signal.SIGTERM, rec("TERM", 8))
open("$TD/ready", "w").close()
time.sleep(30)
EOS

cat > "$TD/leaves-descendant" <<EOS
#!/usr/bin/env bash
sleep 300 &
echo \$! > "$TD/grandchild.pid"
trap 'exit 0' TERM
touch "$TD/ready"
wait
EOS
# The complement of slow-term: exits the instant TERM lands. A wait loop that retries
# on "is the pid still alive" rather than "did a trap fire" breaks here holding 143,
# because the child is already gone by the time it looks. Most games exit promptly.
cat > "$TD/fast-term" <<EOS
#!/usr/bin/env bash
trap 'exit 42' TERM
touch "$TD/ready"
sleep 300
EOS
chmod +x "$TD/fast-term"

chmod +x "$TD/slow-term" "$TD/signal-identity" "$TD/leaves-descendant"

# (a) An interrupted wait must not become the answer.
rm -f "$TD/ready"
"$SCRIPT" place -- "$TD/slow-term" >/dev/null 2>&1 &
w=$!
await_ready "$TD/ready" || no "slow-term child became ready" "ready file" "timeout"
kill -TERM "$w" 2>/dev/null
wait "$w"; term_status=$?
is "reports the game's real status after TERM, not 143" "42" "$term_status"
is "waits for the game to finish shutting down" "TERM" "$(cat "$TD/signal" 2>/dev/null)"

# (a2) Same property, but with a child that exits instantly.
rm -f "$TD/ready"
"$SCRIPT" place -- "$TD/fast-term" >/dev/null 2>&1 &
w=$!
await_ready "$TD/ready" || no "fast-term child became ready" "ready file" "timeout"
kill -TERM "$w" 2>/dev/null
wait "$w"; fast_status=$?
is "reports the real status when the game exits instantly" "42" "$fast_status"

# (b) A game that distinguishes INT from TERM must see what was actually sent, not a
# TERM substituted for it.
#
# `set -m` is load-bearing and was measured, not assumed. Without it this shell starts
# the wrapper with SIGINT in SigIgn (0x6 rather than 0x4), bash cannot trap a signal
# ignored on entry, and the case silently passes INT to nobody -- status 0, no marker.
# Under Steam the wrapper runs in the foreground of `sh -c`, where SIGINT is not
# ignored, so job control here reproduces production rather than departing from it.
rm -f "$TD/signal"
rm -f "$TD/ready"
set -m
"$SCRIPT" place -- "$TD/signal-identity" >/dev/null 2>&1 &
w=$!
set +m
await_ready "$TD/ready" || no "signal-identity child became ready" "ready file" "timeout"
kill -INT "$w" 2>/dev/null
wait "$w"; int_status=$?
is "forwards INT as INT, not TERM" "INT" "$(cat "$TD/signal" 2>/dev/null)"
is "reports the status of an INT-handled exit" "7" "$int_status"

# (c) A descendant that outlives its parent must not survive the stop button.
rm -f "$TD/grandchild.pid"
rm -f "$TD/ready"
"$SCRIPT" place -- "$TD/leaves-descendant" >/dev/null 2>&1 &
w=$!
await_ready "$TD/ready" || no "leaves-descendant child became ready" "ready file" "timeout"
gc="$(cat "$TD/grandchild.pid" 2>/dev/null)"
teardown_start=$SECONDS
kill -TERM "$w" 2>/dev/null
wait "$w" 2>/dev/null
teardown_secs=$((SECONDS - teardown_start))
sleep 0.5

# Without a deadline this case passed on the grandchild's own expiry rather than on a
# signal. The child now sleeps 300s, so being gone at +0.5s can only mean it was killed,
# and a slow teardown is itself a failure rather than a longer wait.
if [ "$teardown_secs" -le 5 ]; then ok "tears down promptly rather than waiting out the child"
else no "tears down promptly rather than waiting out the child" "<=5s" "${teardown_secs}s"; fi
if [ -n "$gc" ]; then
  kill -0 "$gc" 2>/dev/null && no "kills the whole process tree" "grandchild $gc gone" "still alive" \
                            || ok "kills the whole process tree"
  kill -9 "$gc" 2>/dev/null
else
  no "kills the whole process tree" "a grandchild pid" "none captured"
fi

# No case here for helpers orphaned during shutdown. It was written, and it failed for
# a reason no reasonable amount of code fixes: an orphan reparents to init and leaves
# the tree this script can walk. The bound is documented at forward_signal instead of
# being asserted by a test that would only ever encode the limitation.

echo "place (watcher failure)"

# The previous version of this case wrapped /bin/true, so the watcher could lose the
# race and the test would pass without ever reaching the hyprctl call it claims to
# cover. A marker file turns that race into a proof.
cat > "$TD/fake-hyprctl" <<EOS
#!/bin/sh
touch "$TD/hyprctl-was-called"
exit 1
EOS
chmod +x "$TD/fake-hyprctl"

hyprctl_status="$(HAOSHOKU_GW_HYPRCTL="$TD/fake-hyprctl" "$SCRIPT" place -- sleep 1 >/dev/null 2>&1; echo $?)"
is "a failing hyprctl does not affect the launch" "0" "$hyprctl_status"
is "and the watcher really did reach hyprctl" \
   "yes" "$([ -e "$TD/hyprctl-was-called" ] && echo yes || echo no)"

is "survives hyprctl being absent entirely" \
   "0" "$(HAOSHOKU_GW_HYPRCTL=/nonexistent/hyprctl "$SCRIPT" place -- sleep 1 >/dev/null 2>&1; echo $?)"

# One temp file per launch was leaking, because the watcher's RETURN trap does not run
# when the parent kills it. Counted rather than inspected: the name is unpredictable.
# TMPDIR is pinned, not assumed. mktemp honours TMPDIR and this counter used to watch
# /tmp unconditionally, so the assertion passed green while files leaked elsewhere.
# Pinning also removes cross-talk from every other process creating temp files in /tmp.
mkdir -p "$TD/leakcount"
before_tmp="$(find "$TD/leakcount" -maxdepth 1 -name 'tmp.*' 2>/dev/null | wc -l)"
for _ in 1 2 3; do
  TMPDIR="$TD/leakcount" HAOSHOKU_GW_HYPRCTL=/nonexistent/hyprctl \
    "$SCRIPT" place -- /bin/true >/dev/null 2>&1
done
after_tmp="$(find "$TD/leakcount" -maxdepth 1 -name 'tmp.*' 2>/dev/null | wc -l)"
is "three launches leak no temp files" "$before_tmp" "$after_tmp"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
