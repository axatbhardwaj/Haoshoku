# iosatellite: planned Omarchy worker

iosatellite is a Dell Inspiron 7570 intended to run engineering jobs locally,
like iobox. Same-host T3 subagents and reviewers are allowed; it does not hand
jobs to another host. The fleet username is `xzat`, the hostname and persisted
profile are both `iosatellite`. It remains **planned/unprovisioned** until setup
and the target checks below pass. This change deploys nothing to live hosts.

The profile reuses `common/paru_applist_iobox.txt` and all iobox exclusions in
full setup and standalone device commands. No additional package list, package
removal or hardware-model detection is involved. Explicit `--device-type`
selection wins over stored values, then fleet hostname, then DMI/battery
inference. A stored desktop/laptop choice remains until explicitly changed.

## Local bring-up

Use a checkout containing the iosatellite feature until a release includes it.
Run on the Dell as the ordinary `xzat` user, using sudo for system operations.

1. Set the hostname: `sudo hostnamectl set-hostname iosatellite`.
2. Follow the [worker prerequisites](iobox-profile-and-fleet.md#bring-up-checklist):
   install Bun, stable T3 desktop and Tailscale; open T3 desktop once and disable
   **Local environment**; authenticate Tailscale and start `tailscaled.service`.
3. In the Haoshoku checkout, run:

   ```bash
   bun install
   bun haoshoku.js --device-type iosatellite
   bun haoshoku.js
   ```

4. Resolve any named T3, Tailscale, linger, sleep-mask, lid-policy or fleet SSH
   failure and rerun setup. Retry the service/power step with
   `bun haoshoku.js --tailscale-t3`, and fleet wiring with
   `bun haoshoku.js --fleet-ssh`. Worker setup requires a recognized Arch fleet
   hostname and verified matching tailnet; failed verification stops setup.
5. If told **Reboot required**, keep the lid open and finish provisioning before
   `sudo reboot`. After reboot rerun `bun haoshoku.js --tailscale-t3` and resolve
   any remaining conflict or runtime-probe failure before closing the lid.
6. Configure the hub provider instances, gh authentication, T3 pairing and any
   desired Executor clients using the [worker checklist](iobox-profile-and-fleet.md#bring-up-checklist).
   Optional `~/.config/op/service-account.env` wiring uses the same existing-file
   validation as iobox; no token is created or assumed present. Keys, tailnet
   ACLs, peer SSH configuration and live peer sync remain separate operations.

## Power policy and activation

The user's choice is **always awake, including on battery**. Both worker
profiles mask and verify these five system targets: `sleep.target`,
`suspend.target`, `hibernate.target`, `hybrid-sleep.target` and
`suspend-then-hibernate.target`. Switching profiles does not unmask prior targets
or remove an installed drop-in.

Only iosatellite manages
`/etc/systemd/logind.conf.d/90-haoshoku-iosatellite.conf` with:

```ini
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
```

Haoshoku verifies the effective on-disk settings using
`systemd-analyze cat-config systemd/logind.conf`, checks the running logind
properties over D-Bus, and reports desktop `handle-lid-switch` inhibitors.
Conflicting effective settings or failed probes stop the worker service step.
It never restarts logind: that can disrupt desktop sessions. A mismatch in
running settings requires a reboot; saving the file does not activate it.
A desktop inhibitor may take over lid handling, so logind settings alone do
not prove the desktop's behavior. No Dell BIOS setting is assumed.

## Required checks on the real Dell

1. After reboot, rerun `bun haoshoku.js --tailscale-t3`. Inspect
   `systemd-analyze cat-config systemd/logind.conf` and
   `systemd-inhibit --list --no-pager`. Check the running properties:

   ```bash
   for key in HandleLidSwitch HandleLidSwitchExternalPower HandleLidSwitchDocked; do
     busctl get-property org.freedesktop.login1 /org/freedesktop/login1 org.freedesktop.login1.Manager "$key"
   done
   loginctl show-user xzat -p Linger
   systemctl --user is-active t3code.service
   ```

   All three lid properties must report `s "ignore"`, linger must be enabled,
   and T3 must be active. Check all five targets with
   `systemctl show <target> --property=UnitFileState --value` (expect `masked`).
2. Plug in AC. Start a harmless long-running job from T3 or SSH, close the lid,
   then confirm from an access device that `ssh iosatellite` and T3 remain
   reachable and the job continues advancing. Reconnect after several minutes.
3. Inspect `journalctl -b -u systemd-logind` for lid/suspend events. Check actual
   temperatures and ventilation while the closed-lid job runs. Repeat after
   reboot. Resolve any desktop-owned lid policy before relying on availability.
4. Check `ssh -o BatchMode=yes <peer> true` locally for io, iobook, iobox and
   axat-vps. Verify inbound access separately from an authorized access device.
   Missing credentials, keys and ACLs must be provisioned separately.
5. Verify Axstack, its `axstack-default-sync` timer and pool drop-in after they
   are actually installed. Existing release verification on io, iobook, iobox
   and axat-vps remains mandatory; include iosatellite once provisioned and
   record its planned/unverified status until then.

These hardware, desktop, AC/lid, SSH, T3 and thermal checks have not been run by
this implementation. Thermal shutdown, battery depletion and loss of power
remain outside the no-sleep policy.
