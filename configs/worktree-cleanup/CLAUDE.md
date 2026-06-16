# configs/worktree-cleanup/

Weekly git-worktree cleanup for `~/defi` (a shell script + a systemd **user** timer).

| File | Deployed to | Notes |
|------|-------------|-------|
| `cleanup-worktrees.sh` | `~/defi/.worktree-cleanup/` (chmod 755) | Removes only provably-safe worktrees (clean + every commit on a remote + PR merged / branch merged); reviews dirty / unpushed / detached / open-PR / `superpowers/`-artifact ones |
| `defi-worktree-cleanup.service` | `~/.config/systemd/user/` | `oneshot`, runs the script with `--apply` |
| `defi-worktree-cleanup.timer` | `~/.config/systemd/user/` | `OnCalendar=Fri 18:00`, `Persistent=true` |
| `test-cleanup.sh` | *(not deployed)* | Unit tests for the script's pure `decide()` logic |
| `CLAUDE.md` | *(not deployed)* | This doc |

Deploy: `haoshoku --worktree-cleanup` — copies the runtime files, then (if `systemctl --user` is available) runs `daemon-reload` + `enable --now` on the timer.
Backup: `haoshoku --worktree-cleanup-backup` — copies the live files back into this directory.

Helper: `src/helpers/configure_worktree_cleanup.js`. Tests: `tests/configure_worktree_cleanup.test.js`.
