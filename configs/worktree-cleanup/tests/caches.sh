#!/usr/bin/env bash
# shellcheck source=fixture.sh
source "$(dirname "${BASH_SOURCE[0]}")/fixture.sh"
wt open-cache
wt in-use
wt recent
for branch in open-cache in-use recent; do
  mkdir -p "$FIXTURE/$branch/node_modules" "$FIXTURE/$branch/target"
  echo cache > "$FIXTURE/$branch/node_modules/data"
  old "$FIXTURE/$branch"
done
# Only the allowlist of ignored build directories can be removed.
mkdir -p "$FIXTURE/open-cache/keep" "$FIXTURE/open-cache/tracked/target" "$FIXTURE/outside-cache"
echo precious > "$FIXTURE/open-cache/keep/data"
echo tracked > "$FIXTURE/open-cache/tracked/target/data"
git -C "$FIXTURE/open-cache" add -f tracked/target/data
git -C "$FIXTURE/open-cache" commit -qm tracked
ln -s "$FIXTURE/outside-cache" "$FIXTURE/open-cache/cargo-target"
old "$FIXTURE/open-cache"
touch "$(git -C "$FIXTURE/recent" rev-parse --git-path HEAD)"
(cd "$FIXTURE/in-use" && exec sleep 120) &
busy_pid=$!
trap 'kill "$busy_pid" 2>/dev/null || true' EXIT
evidence="$REPO/.git/axstack/runs/x/evidence"
mkdir -p "$evidence/tagged" "$evidence/untagged" "$evidence/recent" "$evidence/invalid" "$evidence/hidden-recent"
for name in tagged recent hidden-recent; do
  printf 'Signature: 8a477f597d28d172789f06886806bc55\n# cache\n' > "$evidence/$name/CACHEDIR.TAG"
done
echo wrong > "$evidence/invalid/CACHEDIR.TAG"
echo precious > "$evidence/untagged/data"
find "$evidence" -exec touch -d '10 days ago' {} +
echo active > "$evidence/recent/data"
mkdir -p "$evidence/hidden-recent/.hidden"
echo active > "$evidence/hidden-recent/.hidden/data"
# File mtimes, not just the top directory's mtime, protect a cache.
touch -d '10 days ago' "$evidence/hidden-recent"
ln -s "$FIXTURE/outside-cache" "$evidence/link"
run_cleanup --dry-run
assert_exists "$FIXTURE/open-cache/node_modules"
assert_exists "$evidence/tagged"
run_cleanup --apply
assert_absent "$FIXTURE/open-cache/node_modules"
assert_absent "$FIXTURE/open-cache/target"
assert_exists "$FIXTURE/open-cache/keep/data"
assert_exists "$FIXTURE/open-cache/tracked/target/data"
assert_exists "$FIXTURE/open-cache/cargo-target"
assert_exists "$FIXTURE/outside-cache"
assert_exists "$FIXTURE/in-use/node_modules"
assert_exists "$FIXTURE/recent/node_modules"
assert_absent "$evidence/tagged"
for name in untagged recent invalid hidden-recent link; do assert_exists "$evidence/$name"; done
echo 'PASS ignored build caches and tagged Axstack evidence only'
