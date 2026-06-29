# docs/

Project documentation and design notes.

## Files

| File          | What                          | When to read                              |
| ------------- | ----------------------------- | ----------------------------------------- |
| `haoshoku.md` | Detailed project architecture | Deep dive into system design              |
| `hyprland-monitor-multihost-todo.md` | Per-host monitor configuration TODO (uses `deviceType` persisted by `--hyprland`) | Implementing per-host monitor selection across desktop / laptop |
| `hyprland-vrr-fix.md` | NVIDIA rotated-output VRR flicker fix (applied 2026-05-20 on `io`) | Reference for default knobs the per-device `pc` monitor template should ship |
| `runbooks/` | Self-contained dark-HTML setup/debug docs. Prime/ZEE5/Crunchyroll/JioHotstar launcher runbooks are historical unless a future change explicitly reintroduces those retired launchers; `nvidia-video-diagnosis.html` remains current. | Reproducing older streaming investigations or debugging NVIDIA video |
