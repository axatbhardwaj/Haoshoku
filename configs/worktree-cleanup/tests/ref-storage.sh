#!/usr/bin/env bash
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
git clone -q --ref-format=reftable "$FIXTURE/remote.git" "$HOME/dev/table"
REPO="$HOME/dev/table"
git -C "$REPO" remote set-head origin -a >/dev/null
orphan=$(echo local | git -C "$REPO" commit-tree main^{tree} -p main)
git -C "$REPO" branch endangered "$orphan"
git -C "$REPO" update-ref refs/heads/endangered "$(git -C "$REPO" rev-parse main)"
run_cleanup --apply
git -C "$REPO" show-ref --verify --quiet refs/heads/endangered || { echo 'FAIL deleted branch without inspecting its reftable history'; exit 1; }
grep -q 'unsupported ref storage' "$FIXTURE/report.html"
echo 'PASS unsupported ref storage is report-only'
