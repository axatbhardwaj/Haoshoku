#!/usr/bin/env bash
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
printf '.env\nnotes/\ntagged/\nlink\n' >> "$REPO/.gitignore"
git -C "$REPO" commit -qam ignores
git -C "$REPO" push -q origin main
for name in env notes all-cache detached; do wt "$name"; old "$FIXTURE/$name"; done
echo secret > "$FIXTURE/env/.env"
mkdir -p "$FIXTURE/notes/notes" "$FIXTURE/env/node_modules"
echo precious > "$FIXTURE/notes/notes/plan.md"
git -C "$FIXTURE/detached" checkout -q --detach
echo secret > "$FIXTURE/detached/.env"
old "$FIXTURE/detached"
mkdir -p "$FIXTURE/all-cache/node_modules" "$FIXTURE/all-cache/tagged"
printf 'Signature: 8a477f597d28d172789f06886806bc55\n' > "$FIXTURE/all-cache/tagged/CACHEDIR.TAG"
ln -s "$FIXTURE/notes/notes" "$FIXTURE/all-cache/link"
run_cleanup --apply
assert_exists "$FIXTURE/env/.env"
assert_exists "$FIXTURE/notes/notes/plan.md"
assert_exists "$FIXTURE/detached/.env"
assert_absent "$FIXTURE/env/node_modules"
assert_absent "$FIXTURE/all-cache"
grep -q 'ignored non-cache files' "$FIXTURE/report.html"
# Ignored data created after planning must also survive.
wt late
old "$FIXTURE/late"
# shellcheck source=../cleanup-worktrees.sh
source "$TEST_DIR/cleanup-worktrees.sh"
GH_OK=1
process_repo "$REPO"
echo secret > "$FIXTURE/late/.env"
apply_plan
assert_exists "$FIXTURE/late/.env"
[[ ${#ERRORS[@]} == 0 ]]
echo 'PASS ignored non-cache data protected at planning and removal; idle caches still cleaned'
