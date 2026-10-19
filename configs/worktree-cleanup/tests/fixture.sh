#!/usr/bin/env bash
# Real git fixtures, always confined to the caller's private TMPDIR.
set -euo pipefail
: "${TMPDIR:?Set a private fixture TMPDIR}"
[[ "$TMPDIR" == /* && ! -L "$TMPDIR" && "$(realpath "$TMPDIR")" == "$TMPDIR" ]]
[[ "$(stat -c %u "$TMPDIR")" == "$UID" && "$(stat -c %a "$TMPDIR")" == 700 ]]
TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
FIXTURE=$(mktemp -d "$TMPDIR/disk-cleanup.XXXXXX")
export HOME="$FIXTURE/home" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME=Fixture GIT_AUTHOR_EMAIL=fixture@example.test
export GIT_COMMITTER_NAME=Fixture GIT_COMMITTER_EMAIL=fixture@example.test
export GIT_AUTHOR_DATE='2020-01-01T00:00:00Z'
export GIT_COMMITTER_DATE="$GIT_AUTHOR_DATE"
export CLEANUP_REPO_ROOTS="$HOME/dev:$HOME/absent" DEFI_ROOT="$HOME/dev"
export T3_WORKTREES_ROOT="$HOME/.t3/worktrees"
mkdir -p "$HOME/dev" "$FIXTURE/bin" "$T3_WORKTREES_ROOT/project/orphan"
git init -q --bare --initial-branch=main "$FIXTURE/remote.git"
git clone -q "$FIXTURE/remote.git" "$HOME/dev/repo"
REPO="$HOME/dev/repo"
printf 'node_modules/\ntarget/\ncargo-target/\n.next/\n.turbo/\nsuperpowers/\n' > "$REPO/.gitignore"
echo tracked > "$REPO/file"
git -C "$REPO" add .
git -C "$REPO" commit -qm initial
git -C "$REPO" push -qu origin main
git -C "$REPO" remote set-head origin -a >/dev/null
cat > "$FIXTURE/bin/gh" <<'GH'
#!/usr/bin/env bash
if [[ "$1" == auth ]]; then exit 0; fi
if [[ "$3" == open* ]]; then echo OPEN; else echo NONE; fi
GH
chmod 755 "$FIXTURE/bin/gh"
export PATH="$FIXTURE/bin:$PATH"
old() {
  local gd
  gd=$(git -C "$1" rev-parse --absolute-git-dir)
  touch -d '10 days ago' "$gd/HEAD" "$gd/index" "$gd/logs/HEAD"
}
wt() { git -C "$REPO" worktree add -qb "$1" "$FIXTURE/$1" main; }
run_cleanup() { bash "$TEST_DIR/cleanup-worktrees.sh" --no-fetch --html "$FIXTURE/report.html" "$@"; }
assert_exists() { [[ -e "$1" || -L "$1" ]] || { echo "FAIL expected kept: $1"; exit 1; }; }
assert_absent() { [[ ! -e "$1" && ! -L "$1" ]] || { echo "FAIL expected removed: $1"; exit 1; }; }
