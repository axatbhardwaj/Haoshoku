## iobox profile and fleet

The axnet fleet in [`configs/fleet.json`](../configs/fleet.json) is io (PC, control),
iobook (laptop, access), iobox (always-on Omarchy agent box running T3, worker),
axat-vps (Debian VPS running Executor and Hermes, worker), and planned iosatellite
(Dell Inspiron 7570 Omarchy laptop, worker). iosatellite remains unprovisioned;
see [local bring-up and closed-lid AC checks](iosatellite-profile.md). Everything is reached over Tailscale only.
Use MagicDNS short names (`ssh io`, `ssh iobook`, `ssh iobox`, `ssh axat-vps`,
and `ssh iosatellite` after provisioning);
Arch hosts use Tailscale SSH, and axat-vps keeps OpenSSH. Agents may SSH to any
fleet host and act there. Accepted risk: one compromised agent reaches every host.

`--device-type iobox` or `--device-type iosatellite` stores the worker profile; a later full setup uses
[`common/paru_applist_iobox.txt`](../common/paru_applist_iobox.txt), including T3,
Tailscale, Claude/Codex dependencies, Git/gh and 1Password desktop plus `op` CLI.
It keeps Axstack, gh-stack, shared agent instructions, user scripts and Omarchy
appearance. It skips Flatpaks, gaming/Steam, uosc/MPV, the Bluetooth prompt,
Brave/Chromium profiles, KDE Connect, voxtype, bar/plugins, workspaces,
hyprmoncfg and audio. Standalone `--workspaces`, `--monitors`,
`--hyprmoncfg-backup`, `--audio` and `--audio-backup` refuse both worker profiles. Reruns keep
previously installed apps; switching profiles does not uninstall anything.

The Arch T3 step enables and verifies user linger. On both worker profiles it also masks and
verifies `sleep.target`, `suspend.target`, `hibernate.target`,
`hybrid-sleep.target` and `suspend-then-hibernate.target`. T3, Tailscale, linger
or sleep-mask failures stop worker setup with the failed step named.

`--fleet-ssh` runs only fleet SSH setup on an Arch fleet host; Debian and
non-fleet hosts are refused without changes. Tailscale must report `BackendState`
`Running` and `MagicDNSSuffix` matching the manifest tailnet (`tail140c22.ts.net`)
before fleet actions. Otherwise standalone mode exits non-zero without writing
files. Full desktop and iobox setup skip fleet SSH when the hostname is not in
the fleet or the tailnet identity cannot be verified; failed tailnet checks print
a message. iosatellite stops setup on either preflight failure. After successful
preflight, fleet SSH setup failures still stop both worker profiles.
It enables/verifies Tailscale SSH, writes `~/.ssh/config.d/haoshoku-fleet`, and
puts its Include first in `~/.ssh/config`, preserving user Host/Match blocks.
Arch peer keys from Tailscale go to `~/.ssh/known_hosts_fleet` with strict host
checking; offline peers retain their cached keys. VPS connections use
`~/.ssh/id_ed25519_vps` and `accept-new`, recording the first key in ordinary
`known_hosts`. Haoshoku does not create SSH keys, authorize them or edit ACLs.

### Subscriptions via CLIProxyAPI hub

Claude and Codex subscriptions are pooled by the CLIProxyAPI hub on axat-vps at
`https://axat-vps.tail140c22.ts.net:8317` (tailnet-only). Haoshoku no longer
creates `~/.claude-alt` or `~/.codex-alt`; existing directories are left untouched.

Account logins happen once, on the hub (`cd /root/cliproxyapi` on axat-vps):

- Claude: `./cli-proxy-api -config config.yaml -claude-login -no-browser`, open
  the printed URL, then paste the `localhost:54545/callback` URL back.
- Codex: `./cli-proxy-api -config config.yaml -codex-device-login`.

Each host's T3 has one Claude and one Codex pool instance, set manually in
T3 provider settings. The key is the hub client key from
`/root/cliproxyapi/client-key` on axat-vps; never print or commit it.

| Instance | Settings |
| --- | --- |
| `claudeAgent` ("Claude Pool") | env `ANTHROPIC_BASE_URL` = hub URL; sensitive env `ANTHROPIC_AUTH_TOKEN` = hub client key |
| `codex` ("Codex Pool") | sensitive env `CLIPROXY_API_KEY` = hub client key; empty `shadowHomePath`; launch args below |

```text
-c model_provider=cliproxy -c model_providers.cliproxy.name=CLIProxyAPI
-c model_providers.cliproxy.base_url=https://axat-vps.tail140c22.ts.net:8317/v1
-c model_providers.cliproxy.wire_api=responses
-c model_providers.cliproxy.env_key=CLIPROXY_API_KEY
-c model_providers.cliproxy.requires_openai_auth=false
-c model_providers.cliproxy.supports_websockets=true
```

Pooled quota shows in T3 under Settings > Providers > Usage providers (hub URL
plus management key). Run `t3-provider-fix` after changing provider instances.

### Bring-up checklist

Run each host's setup locally. For the new iosatellite profile use a checkout
containing that feature until it is released; see its separate bring-up checklist.

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
6. Configure the T3 `claudeAgent` and `codex` pool instances as described in
   [Subscriptions via CLIProxyAPI hub](#subscriptions-via-cliproxyapi-hub); no
   per-host Claude or Codex subscription logins are needed.
7. Rerun `bun haoshoku.js --axstack` if the first setup reported incomplete
   Axstack harness setup.
8. Supply `EXECUTOR_AUTHORIZATION` securely as described in
   [Executor clients](../README.md#opt-in-executor-clients), then register once:

   ```bash
   bun haoshoku.js --executor-clients https://axat-vps.tail140c22.ts.net/mcp
   ```
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
