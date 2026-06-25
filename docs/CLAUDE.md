# docs/

Project documentation and design notes.

## Files

| File          | What                          | When to read                              |
| ------------- | ----------------------------- | ----------------------------------------- |
| `haoshoku.md` | Detailed project architecture | Deep dive into system design              |
| `hyprland-monitor-multihost-todo.md` | Per-host monitor configuration TODO (uses `deviceType` persisted by `--hyprland`) | Implementing per-host monitor selection across desktop / laptop |
| `hyprland-vrr-fix.md` | NVIDIA rotated-output VRR flicker fix (applied 2026-05-20 on `io`) | Reference for default knobs the per-device `pc` monitor template should ship |
| `runbooks/` | Self-contained dark-HTML setup/debug docs: `prime-video-hd.html` (Prime bottle build), `streaming-launchers-context.html` (all five Brave app launchers + dedicated-profile model), `zee5-bottle-hwaccel-findings.html` (why ZEE5/CR/JioHotstar can't use the bottle), `nvidia-video-diagnosis.html` | Reproducing a setup or debugging Prime/ZEE5/streaming/NVIDIA video |
