# configs/worktree-cleanup/

Daily disk hygiene for Arch/Omarchy (user xzat) and Debian (root). The CLI names
remain `haoshoku --worktree-cleanup` and `--worktree-cleanup-backup`.

| File | Live location / purpose |
|------|-------------------------|
| `cleanup-disk.sh` | Same directory; daily entrypoint, always runs both steps and fails if either fails |
| `cleanup-worktrees.sh` | `~/.local/share/disk-cleanup/`; executable entry, dry-run by default |
| `branches.sh`, `caches.sh`, `prune.sh`, `report.sh` | Same directory; sourced runtime modules |
| `cleanup-temp.sh`, `disk-cleanup-tmpfiles.conf` | Same directory; tmpfiles wrapper and 3d `/tmp`, 30d `/var/tmp` policy |
| `disk-cleanup.service`, `disk-cleanup.timer` | `~/.config/systemd/user/`; daily, persistent, up to 1h jitter |
| `test-cleanup.sh`, `tests/` | Repository-only decision and real Git fixture tests |

Sync copies runtime files, disables/stops installed legacy
`defi-worktree-cleanup.{timer,service}`, removes their unit files, reloads systemd,
and enables the new timer. `enable:false` is a copy-only option for tests and
manual staging; it preserves legacy units and logs a disable hint. Backup copies the runtime files and units back to this directory.
The full Arch app setup syncs cleanup; Debian retains its opt-in setup prompt.

The service uses `%h` paths, a Git/gh/tmpfiles PATH, Nice=10 and idle I/O. It runs
`cleanup-disk.sh --apply`, which attempts worktree cleanup and temp cleanup
even if the first step fails.
All entry scripts default to dry-run when invoked directly. No live-host deployment
is part of author verification.

## Discovery and retention

- Direct child repositories of `~/defi`, `~/dev`, `~/Work`; missing roots are skipped.
  `CLEANUP_REPO_ROOTS` overrides this with a colon-separated list of absolute roots.
- Registered worktrees under `~/.t3/worktrees/*/*` also discover their owning repo;
  override the root with `T3_WORKTREES_ROOT`. Deduplicate by absolute Git common dir.
  Every registered checkout is planned, including `.git/axstack/runs/*/checkouts/*`.
  Unregistered T3 directories are report-only.
- Keep locked and primary worktrees, readable `/proc/*/cwd` activity at/inside a checkout,
  and activity within `MIN_IDLE_HOURS` (24). Activity is the newest worktree
  gitdir `HEAD`, `index`, `logs/HEAD` mtime, collected before worktree Git probes.
  Every Git probe uses `GIT_OPTIONAL_LOCKS=0` to avoid refreshing the index.
  Status always scans all untracked paths, disables fsmonitor/untracked caches,
  exposes file-mode and case-only changes, and includes submodule changes.
  Assume-unchanged/skip-worktree entries and weakened `core.trustctime` or
  `core.checkStat` settings require review rather than trusting cached status.
- Any in-progress Git operation keeps the worktree and its build caches. Markers
  include rebase-merge (head-name/update-refs included), rebase-apply, MERGE_HEAD,
  CHERRY_PICK_HEAD, REVERT_HEAD, BISECT_START/BISECT_LOG, sequencer, index/HEAD locks.
  While any registered worktree has an operation, branch cleanup pauses for the
  whole repo so stacked rebase refs and detached bisect state remain protected.
- Dirty, unpushed, closed-unmerged, unknown/unmerged and legacy `superpowers/`
  artifacts remain for review; open PRs stay. Clean pushed merged worktrees can
  be removed. Detached pushed checkouts require `STALE_DAYS` (7) of inactivity.
  Before any REMOVE, ignored entries must be allowlisted cache directories,
  directories with a valid `CACHEDIR.TAG`, or symlinks. Other ignored content
  (including `.env` and `notes/`) means REVIEW: ignored non-cache files. The
  legacy `superpowers/` review reason remains. Recheck before removal.
  Removal uses `git worktree remove` without force. Apply prunes once per repo
  through its stable Git common directory, even when no worktree was removed.
  Missing directories are not in use. Prune candidates come from Git's
  `prunable` records, including existing mount points with a missing `.git`.
  Check HEAD and both SHAs in every `logs/HEAD` entry. Any commit unreachable
  from branches, tags or remote refs, operation state, or unreadable history
  requires REVIEW and skips prune for that entire repo. Dry-run only reports.
  Ordinary worktree removal also preserves unreferenced HEAD reflog history.
  Reftable/unknown ref storage is report-only because these history guards
  inspect file-backed reflogs. Graph proofs ignore replace refs and grafts.
- A local branch must be unchecked out everywhere, older than `STALE_DAYS`,
  fully reachable from remote refs, and different from the known origin default.
  Staleness uses the newer of tip commit date and last reflog update. Preserve
  unreferenced commits in branch reflogs too. Symbolic local refs stay; apply
  rechecks the default, ref type, activity and operation state. Deletion uses
  `update-ref --no-deref -d` and the recorded tip to protect dereference races.
  Failed fetches warn and retain the existing remote-ref snapshot.
  Unknown origin default means no branch pruning. Moved or disappeared branches
  are reported KEEP. Ref-write
  failures with an unchanged tip remain errors.

## Cache and temporary files

Never prune build caches in the primary worktree. In retained linked worktrees
idle for `CACHE_IDLE_DAYS` (3), remove only ignored `node_modules`, `target`,
`cargo-target`, `.next`, `.turbo` directories. Keep cache targets referenced by
symlinks in another worktree of the same repo, including symlinks to an ancestor
inside the owning worktree and references appearing between planning and apply.
If a sibling symlink scan fails, preserve the cache. Kept worktrees with ignored non-cache files still
qualify for this bounded cache cleanup. Check
tracked and nonignored contents again before deletion. Paths must be canonical
absolute descendants; symlinks and paths through symlinked parents are rejected.

Within `<git-common-dir>/axstack/runs/*/evidence/`, remove only directories with
an actual `CACHEDIR.TAG` beginning `Signature: 8a477f597d28d172789f06886806bc55`
and no file modified within `CACHE_IDLE_DAYS`. Untagged evidence stays.

`cleanup-temp.sh` invokes `systemd-tmpfiles --clean
--replace=/etc/tmpfiles.d/tmp.conf <conf>`, with `/tmp` and `/var/tmp` prefixes to
avoid unrelated system cleanup. Only `/tmp` tightens to 3 days; `/var/tmp`
retains the distro default 30 days for preserved temporary state. Because this
replaces the whole `tmp.conf`, both entries must remain. Other distro configs
still exclude the `systemd-private-*` directories themselves and X11 sockets.
As in the distro default, inner `systemd-private-*/tmp` contents age with the
`/tmp` threshold (now 3 days); the directory exclusion does not preserve those
contents indefinitely. This affects root's cleanup where it can access them. Nonroot permission-denied-only
failures are expected; other or mixed failures return 1. Do not replace this
with direct recursive deletion of shared temporary roots.

Package/app caches, Trash, containers, T3 database/runtime/logs/scratch and thread
archival are outside this job. In-use detection covers only readable proc links.

## Reporting and verification

HTML defaults to `~/.local/state/disk-cleanup/last-run.html`; override with
`--html PATH`. Journald summary: `journalctl --user -u disk-cleanup.service`.
Real apply failures return 1. Benign activity/content/lock races are reported
as KEEP. Worktree removal keeps its branch for the separate compare-and-delete
pass. No discovered repos means a diagnostic and exit 0, with an HTML report. Cache and branch tables describe the plan; summary
counts and errors distinguish actual removals. Use `--dry-run --no-fetch` for
local inspection without updating remote refs or deleting anything.

Run `bash configs/worktree-cleanup/test-cleanup.sh`. For integration checks,
set `TMPDIR` to a canonical, nonsymlink, current-user-owned mode-0700 directory,
then run each `configs/worktree-cleanup/tests/*.sh` except `fixture.sh`.
Fixtures create a bare remote, clones and worktrees only below that directory;
they control activity with `touch -d`, stub gh/tmpfiles, and leave fixtures for
inspection. Never apply the script to real data during author verification.

Helper: `src/helpers/configure_worktree_cleanup.js`.
Bun tests: `tests/configure_worktree_cleanup.test.js`,
`tests/cachyos_disk_cleanup.test.js`.
