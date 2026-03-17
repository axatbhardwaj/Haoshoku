# Haoshoku

## What This Is

A multi-distro Linux setup and configuration toolkit built with Bun/JavaScript. Haoshoku automates provisioning of development environments — from system packages and shell setup to editor configs, terminal themes, and Claude Code skill management. It targets CachyOS (Arch) desktops and Debian servers, with standalone flags for individual components.

## Core Value

One command bootstraps a complete, opinionated development environment with all tools, configs, and AI coding infrastructure (Claude Code + GSD + skills) ready to use.

## Requirements

### Validated

- ✓ CachyOS/Arch desktop full setup (packages, rust, AUR, flatpak) — v1
- ✓ Debian server hardening (SSH, UFW, fail2ban, Docker) — v1
- ✓ Fish shell + Fisher plugins + Starship prompt — v1
- ✓ Claude Code CLI install and config sync (CLAUDE.md, settings, conventions, output-styles) — v1
- ✓ Skill manager with git clone to XDG cache, symlink to ~/.claude/skills/ — v3
- ✓ Agent merging to ~/.claude/agents/ with priority-based sourcing — v3
- ✓ Zed editor config sync/backup with sanitization — v3
- ✓ Ghostty and Zed theme sync via standalone flags — v3.5
- ✓ KDE Ocean theme deploy/backup — v3
- ✓ KDE Glass blur effect install (CachyOS only) — v3
- ✓ GSD install via --gsd flag (npx get-shit-done-cc) — v4
- ✓ Standalone CLI flags for individual components (--claude, --skills, --zed, --gsd, etc.) — v4
- ✓ OS auto-detection from /etc/os-release — v1
- ✓ Node.js install + configureClaude() in Debian flow — v4 (just added)

### Active

- [ ] Feature parity between CachyOS and Debian flows (git config, etc.)
- [ ] Skill source validation and health checks
- [ ] npm global install compatibility (Bun.spawnSync usage blocks Node runtime)

### Out of Scope

- GUI/TUI installer — CLI-only by design
- macOS/Windows support — Linux-focused tool
- Config file editing (only full file copy/symlink) — keeps sync simple
- Skill authoring tools — haoshoku manages skills, doesn't create them

## Context

- Published to npm as `haoshoku` (v4.0.0), but requires Bun runtime due to Bun-specific APIs (Bun.spawnSync, Bun.spawn)
- Skill manager uses ~/.haoshoku.json for skill source configuration (array of git URLs)
- Skills are identified by SKILL.md marker files inside repo/skills/ directories
- CachyOS flow is the primary/mature path; Debian flow is simpler (server-focused)
- The project includes a Remotion video generator in video/ for promotional content
- Tests use Bun's built-in test runner, linting via Biome

## Constraints

- **Runtime**: Bun required — uses Bun.spawnSync and `import { spawn } from "bun"` throughout
- **Permissions**: Requires sudo for system package installation
- **Network**: Git clone for skills, curl for tool installers — needs internet access
- **File ownership**: configs/ directory is version-controlled templates; ~/.claude/ and ~/.config/ are deployment targets

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Bun over Node | Faster startup, built-in test runner, native TS support | — Pending (blocks npm portability) |
| Symlinks over copies for skills | Single source of truth, cache updates immediately visible | ✓ Good |
| Shallow clone (--depth 1) for skills | Reduced bandwidth/disk, full history unnecessary | ✓ Good |
| Priority-based skill merging (first source wins) | User skills override community skills predictably | ✓ Good |
| NodeSource for Debian Node.js | Official LTS repo, reliable for apt-based installs | — Pending |

---
*Last updated: 2026-03-18 after initialization*
