#!/usr/bin/env bash
# Plan real removals, then change activity/content before execution.
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
for branch in busy fresh dirty; do wt "$branch"; old "$FIXTURE/$branch"; done
wt open-cache
mkdir -p "$FIXTURE/open-cache/node_modules"
old "$FIXTURE/open-cache"
evidence="$REPO/.git/axstack/runs/race/evidence/cache"
mkdir -p "$evidence"
printf 'Signature: 8a477f597d28d172789f06886806bc55\n' > "$evidence/CACHEDIR.TAG"
touch -d '10 days ago' "$evidence/CACHEDIR.TAG"
# shellcheck source=../cleanup-worktrees.sh
source "$TEST_DIR/cleanup-worktrees.sh"
GH_OK=1
process_repo "$REPO"
[[ ${#PLAN_REMOVE[@]} == 3 && ${#PLAN_CACHE[@]} == 2 ]]
(cd "$FIXTURE/busy" && exec sleep 120) &
busy_pid=$!
trap 'kill "$busy_pid" 2>/dev/null || true' EXIT
touch "$(git -C "$FIXTURE/fresh" rev-parse --git-path HEAD)"
echo dirty >> "$FIXTURE/dirty/file"
touch "$(git -C "$FIXTURE/open-cache" rev-parse --git-path index)"
echo new > "$evidence/recent"
apply_plan
[[ ${#ERRORS[@]} == 0 ]] || { printf 'FAIL benign races reported errors: %s\n' "${ERRORS[@]}"; exit 1; }
[[ ${#PLAN_KEEP[@]} -ge 6 ]] || { echo 'FAIL races were not reported as kept'; exit 1; }
for branch in busy fresh dirty; do assert_exists "$FIXTURE/$branch"; done
assert_exists "$FIXTURE/open-cache/node_modules"
assert_exists "$evidence/recent"
echo 'PASS activity, dirty and cache races are reported KEEP without job errors'
