# configs/worktree-cleanup/

Daily disk hygiene for Arch/Omarchy (user xzat) and Debian (root). The CLI names
remain `haoshoku --worktree-cleanup` and `--worktree-cleanup-backup`.

| File | Live location / purpose |
|------|-------------------------|
| `cleanup-disk.sh` | Same directory; daily entrypoint, always runs both steps and fails if either fails |
| `cleanup-worktrees.sh` | `~/.local/share/disk-cleanup/`; executable entry, dry-run by default |
| `branches.sh`, `caches.sh`, `report.sh` | Same directory; sourced runtime modules |
| `cleanup-temp.sh`, `disk-cleanup-tmpfiles.conf` | Same directory; tmpfiles wrapper and 3d `/tmp`, 7d `/var/tmp` policy |
| `disk-cleanup.service`, `disk-cleanup.timer` | `~/.config/systemd/user/`; daily, persistent, up to 1h jitter |
| `test-cleanup.sh`, `tests/` | Repository-only decision and real Git fixture tests |

Sync copies runtime files, disables/stops installed legacy
`defi-worktree-cleanup.{timer,service}`, removes their unit files, reloads systemd,
and enables the new timer. `enable:false` is a copy-only option for tests and
manual staging. Backup copies the runtime files and units back to this directory.
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
- Dirty, unpushed, closed-unmerged, unknown/unmerged and legacy `superpowers/`
  artifacts remain for review; open PRs stay. Clean pushed merged worktrees can
  be removed. Detached pushed checkouts require `STALE_DAYS` (7) of inactivity.
  Removal uses `git worktree remove` without force. Apply prunes once per repo
  through its stable Git common directory, even when no worktree was removed.
  Missing directories are not in use; dry-run never prunes their registrations.
- A local branch must be unchecked out everywhere, older than `STALE_DAYS`,
  fully reachable from remote refs, and different from the known origin default.
  Unknown origin default means no branch pruning. `update-ref -d` compares the
  recorded tip; moved branches survive and the conflict fails the apply run.

## Cache and temporary files

In retained worktrees idle for `CACHE_IDLE_DAYS` (3), remove only ignored
`node_modules`, `target`, `cargo-target`, `.next`, `.turbo` directories. Check
tracked and nonignored contents again before deletion. Paths must be canonical
absolute descendants; symlinks and paths through symlinked parents are rejected.

Within `<git-common-dir>/axstack/runs/*/evidence/`, remove only directories with
an actual `CACHEDIR.TAG` beginning `Signature: 8a477f597d28d172789f06886806bc55`
and no file modified within `CACHE_IDLE_DAYS`. Untagged evidence stays.

`cleanup-temp.sh` invokes `systemd-tmpfiles --clean
--replace=/etc/tmpfiles.d/tmp.conf <conf>`, with `/tmp` and `/var/tmp` prefixes to
avoid unrelated system cleanup. Replacement loads other distro configurations,
retaining systemd-private and X11 exclusions. Nonroot permission-denied-only
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
