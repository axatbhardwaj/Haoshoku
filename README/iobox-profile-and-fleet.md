## iobox profile and fleet

The axnet fleet in [`configs/fleet.json`](../configs/fleet.json) is io (PC, control),
iobook (laptop, access), iobox (always-on Omarchy agent box running T3, worker),
and axat-vps (Debian VPS running Executor and Hermes, worker). Everything is reached over Tailscale only.
Use MagicDNS short names (`ssh io`, `ssh iobook`, `ssh iobox`, `ssh axat-vps`);
Arch hosts use Tailscale SSH, and axat-vps keeps OpenSSH. Agents may SSH to any
fleet host and act there. Accepted risk: one compromised agent reaches every host.

`--device-type iobox` stores the profile; a later full setup uses
[`common/paru_applist_iobox.txt`](../common/paru_applist_iobox.txt), including T3,
Tailscale, Claude/Codex dependencies, Git/gh and 1Password desktop plus `op` CLI.
It keeps Axstack, gh-stack, shared agent instructions, user scripts and Omarchy
appearance. It skips Flatpaks, gaming/Steam, uosc/MPV, the Bluetooth prompt,
Brave/Chromium profiles, KDE Connect, voxtype, bar/plugins, workspaces,
hyprmoncfg and audio. Standalone `--workspaces`, `--monitors`,
`--hyprmoncfg-backup`, `--audio` and `--audio-backup` refuse iobox. Reruns keep
previously installed apps; switching profiles does not uninstall anything.

The Arch T3 step enables and verifies user linger. On iobox it also masks and
verifies `sleep.target`, `suspend.target`, `hibernate.target`,
`hybrid-sleep.target` and `suspend-then-hibernate.target`. T3, Tailscale, linger
or sleep-mask failures stop iobox setup with the failed step named.

`--fleet-ssh` runs only fleet SSH setup on an Arch fleet host; Debian and
non-fleet hosts are refused without changes. Tailscale must report `BackendState`
`Running` and `MagicDNSSuffix` matching the manifest tailnet (`tail140c22.ts.net`)
before fleet actions. Otherwise standalone mode exits non-zero without writing
files; full Arch setup skips fleet SSH with a message.
It enables/verifies Tailscale SSH, writes `~/.ssh/config.d/haoshoku-fleet`, and
puts its Include first in `~/.ssh/config`, preserving user Host/Match blocks.
Arch peer keys from Tailscale go to `~/.ssh/known_hosts_fleet` with strict host
checking; offline peers retain their cached keys. VPS connections use
`~/.ssh/id_ed25519_vps` and `accept-new`, recording the first key in ordinary
`known_hosts`. Haoshoku does not create SSH keys, authorize them or edit ACLs.

`--agent-accounts` is opt-in elsewhere and runs by default on iobox after
Claude/Codex and shared-profile setup. It creates `~/.claude-alt` and
`~/.codex-alt`, sharing every other primary-home top-level entry by symlink
except these private entries:

| Home | Private entries (never linked) |
| --- | --- |
| Claude | `.credentials.json`, `.claude.json`, `history.jsonl`, `sessions`, `session-env`, `shell-snapshots`, `cache`, `backups`, `security`, `mcp-needs-auth-cache.json`, `.last-cleanup` |
| Codex | `auth.json`, `config.toml`, `models_cache.json`, `log`, `memories`, `tmp` |

Codex `config.toml` is copied once when the alt file is missing. Other runtime
state stays shared, including Claude `projects` and Codex `history.jsonl`,
`sessions` and SQLite files. Existing real entries and wrong/dangling links
are reported and preserved; private symlinks report incomplete account isolation.
Missing primary homes are skipped. Logins and T3 provider settings remain manual.

### Bring-up checklist

Run each host's setup locally. Until 12.4.0 ships, use a git checkout with Bun
for the new commands below; the installed 12.3.x package does not include them.

1. Set the hostname to `iobox` (`sudo hostnamectl set-hostname iobox`).
2. Install Bun (`yay -S --needed bun-bin`; Bun >= 1.3.14), then
   `git clone https://github.com/axatbhardwaj/Haoshoku.git` and `cd Haoshoku`.
3. Install T3 desktop (`yay -S aur/t3code-bin`; verify the proposed stable
   version is >=0.1.0), open it once with
   `t3code`, choose the Stable update channel, and disable **Local environment**
   in its settings. This creates
   the desktop settings file required by preflight; do this before the service step.
4. Install Tailscale (`sudo pacman -S --needed tailscale`), enable it with
   `sudo systemctl enable --now tailscaled.service`, then run `sudo tailscale up`
   and finish tailnet login. Haoshoku verifies it is installed, enabled and logged in.
5. In the checkout, run `bun install`, `bun haoshoku.js --device-type iobox`, then
   `bun haoshoku.js` as the ordinary setup user. If the T3 step stops, fix the
   reported condition (including desktop settings), then rerun `bun haoshoku.js`.
6. Complete two Claude paste-code logins: launch `claude`, use `/login`, then
   repeat with `CLAUDE_CONFIG_DIR=~/.claude-alt claude`.
7. Complete two Codex device logins: `codex login --device-auth`, then
   `CODEX_HOME=~/.codex-alt codex login --device-auth`.
   After completing the primary logins, rerun `bun haoshoku.js --axstack` if
   the first setup reported incomplete Axstack harness setup.
8. Supply `EXECUTOR_AUTHORIZATION` securely as described in
   [Executor clients](../README.md#opt-in-executor-clients), then register once per home:

   ```bash
   bun haoshoku.js --executor-clients https://axat-vps.tail140c22.ts.net/mcp
   CLAUDE_CONFIG_DIR=~/.claude-alt CODEX_HOME=~/.codex-alt bun haoshoku.js --executor-clients https://axat-vps.tail140c22.ts.net/mcp
   ```

   In T3, manually map provider instance `claudeAlt` to `CLAUDE_CONFIG_DIR=~/.claude-alt`
   and `codexAlt` to `CODEX_HOME=~/.codex-alt` (use absolute home paths in settings).
9. Run `gh auth login` and set your Git name/email; Omarchy skips Git identity setup.
   Then rerun `bun haoshoku.js --gh-stack` if the first setup skipped gh-stack.
   The end-of-run **Next steps** block lists incomplete gh-stack and Axstack
   setup, the reason, and the exact `haoshoku` command to rerun.
10. Create the iobox key with `ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_vps` and
    authorize its public key on axat-vps by hand. Keep the private key local.
11. Create `~/.config/op/service-account.env` as a regular file owned by your user,
    mode 0600, containing exactly one non-empty `OP_SERVICE_ACCOUNT_TOKEN=` assignment
    (one trailing newline allowed). Never log or commit the value. Retry
    `bun haoshoku.js --tailscale-t3` to install the managed `haoshoku-op.conf` drop-in;
    an absent file only prints guidance. After token rotation or later creation
    with an existing drop-in, run `systemctl --user restart t3code`.
12. Complete T3 pairing using the service's pairing flow.
13. Ensure tailnet policy allows port 22 and a fleet SSH rule with `action: accept`.
    An overlapping `check` rule wins and breaks unattended SSH; policy edits are manual.
14. Smoke-test `ssh -o BatchMode=yes <peer> true` for each peer (from iobox:
    io, iobook and axat-vps). Check authenticated Executor tool discovery separately
    in both primary and alt T3 instances; registration alone does not prove access.
