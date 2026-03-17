# Feature Research

**Domain:** Linux setup/dotfiles toolkit (multi-distro bootstrap + AI config management)
**Researched:** 2026-03-18
**Confidence:** HIGH (ecosystem well-understood; gaps validated against chezmoi, yadm, dotbot, ML4W installer)

---

## What's Already Implemented

For context, the following are already done as of v4:

- CachyOS/Arch full desktop setup (pacman/paru/flatpak, Rust, uv, Foundry)
- Debian server hardening (UFW, fail2ban, Docker, Node.js)
- Fish shell + Fisher plugins + Starship prompt
- Git profile setup (personal + work, SSH keys, commit signing)
- Terminal configs (Ghostty, Kitty, Alacritty, Fastfetch)
- Zed editor config sync + backup (with sanitization)
- KDE Ocean theme + KDE Glass blur (CachyOS only)
- Claude Code config deploy + backup + update
- Skill manager: git clone to XDG cache, symlink to ~/.claude/skills/
- Agent merging to ~/.claude/agents/ (priority-based, first source wins)
- GSD install via --gsd flag
- OS auto-detection from /etc/os-release
- Standalone flags for all individual components
- Ghostty + Zed theme sync

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users of dotfiles/provisioning toolkits assume exist. Missing these = product feels half-finished.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Idempotency — re-running setup is safe | Every serious toolkit (chezmoi, dotbot, yadm) guarantees this. Users run setup again on updates. | MEDIUM | Currently partial: package installs check `commandExists`, but some copy/symlink ops overwrite without checking. Needs audit. |
| Dry-run / preview mode (`--dry-run`) | Chezmoi's `-n -v` is a core workflow. Users want to see what will change before committing. | MEDIUM | Not implemented. Requires threading a dry-run flag through all write operations. |
| Post-setup summary / install report | Users expect a clear "here's what was installed / what failed" at the end of a long run. | LOW | Partial: individual log.success() calls exist but no consolidated summary. |
| Backup before overwrite | Standard in all mature tools (chezmoi, dotbot). Files replaced without user consent erode trust. | LOW | Partial: KDE shortcuts and Zed backup exist, but terminal configs (fish, ghostty, kitty) are overwritten directly. |
| Skill source health check (`--health`) | Users discover broken sources silently. Checking URL reachability + SKILL.md presence is standard table stakes for a sync-based system. | LOW | Active requirement in PROJECT.md: "Skill source validation and health checks". |
| Feature parity across OS flows | CachyOS is primary; Debian lacks git config, Volta/NVM, and other items present in CachyOS. Users on Debian feel like second-class citizens. | MEDIUM | Active requirement in PROJECT.md. |
| Reproducibility on reinstall | Core value proposition: "one command bootstraps complete environment". Must work identically on second run on fresh machine. | MEDIUM | Requires idempotency + testing against clean VMs. |
| Offline / cached operation after first sync | Skills use shallow clone + stale cache fallback. Network should not be required after initial bootstrap. | LOW | Already implemented in skill_manager.js (keeps stale cache on fetch failure). |

### Differentiators (Competitive Advantage)

Features where Haoshoku is distinctly positioned vs generic dotfiles managers.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| AI coding infrastructure as first-class citizen | No other toolkit ships Claude Code config, skills, agents, and GSD as core features. This is the primary differentiation. | LOW (already done) | Unique in the ecosystem. Skills + agents + GSD = opinionated AI dev workflow. |
| Priority-based skill merging (user overrides community) | Most tools are simple copy/symlink. First-source-wins with multi-repo merging lets users layer community skills under personal overrides without conflict. | LOW (already done) | Solid design, worth highlighting. |
| Skill source as external git repo (not bundled) | Separates tool lifecycle from skill content lifecycle. Users can update skills without updating haoshoku itself. | LOW (already done) | Analogous to Fisher plugin model. |
| Agent merging to ~/.claude/agents/ | No other tool manages Claude sub-agents. Unique feature category. | LOW (already done) | First-mover in this space. |
| Standalone flag granularity | `--claude`, `--zed`, `--skills`, `--gsd`, `--kde-glass` etc. lets users use haoshoku surgically on existing setups. Competitors require full re-run or manual cherry-picking. | LOW (already done) | Core usability feature. Well-implemented. |
| Config sanitization on backup | `--zed-backup` strips API keys and sensitive data before committing to configs/. Rare in this space. | LOW (already done) | Makes dotfiles safely public. |
| Bun runtime — native TS, fast startup | Zero compile step. Scripts run at native speed. Biome linting included. | LOW (already done) | Trade-off: blocks Node runtime compatibility (see anti-features). |
| --skills-list discovery UI | Users can browse available skills across all sources without syncing. Enables informed source selection. | LOW (already done) | Useful for community skill repos. |
| Cross-profile skill priority ordering | ~/.haoshoku.json array order = priority order. Explicit, predictable, documentable. | LOW (already done) | Better than implicit alphabetical/last-write-wins. |
| Post-run action prompts (skills sync offer) | After full OS setup, user is offered a skills sync. Reduces "I forgot to run --skills" scenarios. | LOW (already done) | Good UX pattern. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but would harm the project's core design.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| GUI / TUI installer (ncurses, Ink) | Looks polished, demo-able, impressive | High maintenance burden, adds a framework dependency, slows scripting, breaks non-interactive use (CI, scripts). Out of scope by design. | Clear terminal output with spinner + color already implemented. Extend log output quality instead. |
| macOS support | Broadens audience | macOS has completely different package managers (Homebrew), different config paths, different tooling. Would fragment every function. Scope explosion. | Explicitly document Linux-only. Point macOS users to chezmoi or nix-darwin. |
| Config file editing / patching (sed/awk transforms) | Users want haoshoku to tweak specific lines in existing configs | Brittle: config format changes break patches silently. Hard to test. Chezmoi's modify manager is the right solution for this and it's complex. | Only full-file copy/symlink. Haoshoku deploys opinionated, complete files. Users fork the repo to customize content. |
| Skill authoring tools (haoshoku new-skill) | Natural extension of skill management | Scope creep into a different product (a skill development kit). Would compete with Claude's own SKILL.md format guidance. | Document SKILL.md format. Let users create skills in their own repos. Haoshoku manages, not creates. |
| Windows / WSL support | Maximum audience | WSL adds conditional paths throughout every function. Different package managers, service management, file ownership. | WSL users can run haoshoku inside Ubuntu WSL, but no first-class support. |
| secrets encryption (age/gpg integration) | Public dotfiles repos shouldn't contain API keys | Large complexity addition. Chezmoi already solves this better than any custom implementation could. | Config sanitization on backup (already implemented for Zed). Extend pattern to other config files. |
| Multi-machine sync / remote state | Chezmoi-style push/pull from remote dotfiles repo | This is an entire different product category (config sync daemon). Haoshoku is a one-shot setup tool, not a sync daemon. | Users pair haoshoku with git (clone repo, run haoshoku). The git repo IS the remote state. |
| Dependency graph resolution / declarative config (YAML/TOML) | Ansible-style declarative provisioning | High complexity. Haoshoku's value is being JS/TS, readable, and hackable. A DSL interpreter adds a layer of abstraction that fights against easy modification. | Keep imperative JS. Functions are readable and directly hackable. |

---

## Feature Dependencies

```
OS Detection
    └──requires──> correct flow routing (cachyos.js vs debian_server.js)

Skill Sync (--skills)
    └──requires──> ~/.haoshoku.json (config)
    └──requires──> git installed
    └──enables──> Claude config deploy (--claude checks cache first)

Claude Config Deploy (--claude)
    └──requires──> skill cache exists (auto-syncs if missing)
    └──requires──> configs/claude/ directory in repo
    └──enables──> GSD install (--gsd works standalone but is related)

Agent Merging
    └──requires──> skill sources cloned (agents/ dirs inside repos)
    └──part-of──> syncSkills() flow

Git Profile Setup
    └──requires──> SSH key generation → user action (copy pubkey to GitHub)
    └──enables──> signed commits on future work

Dry-run mode (not yet built)
    └──requires──> all write operations accept a dryRun flag
    └──requires──> command runner to support no-op mode
    └──enhances──> every existing feature

Backup before overwrite (partial)
    └──enhances──> terminal config deployment (fish, ghostty, kitty)
    └──conflicts-with──> silent overwrite pattern currently in configureTerminals()

Skill health check (--health, not yet built)
    └──requires──> skill source URLs from ~/.haoshoku.json
    └──requires──> network reachability check + SKILL.md detection
    └──enhances──> --skills-list (could show health status per source)

Feature parity (Debian)
    └──requires──> configureGit() added to debian_server.js
    └──requires──> Volta/NVM install in debian_server.js
    └──requires──> review of all CachyOS features for server-applicability
```

### Dependency Notes

- **Claude config deploy requires skill cache**: `--claude` already auto-runs `syncSkills` if cache is empty. This is a good dependency pattern — keep it.
- **Dry-run requires threading**: To implement `--dry-run`, a `dryRun` flag needs to be passed to `runCommand`, `fs.copyFileSync`, `fs.symlinkSync`, and `fs.writeFileSync` throughout. Consider a `DryRunContext` singleton rather than threading a parameter everywhere.
- **Health check enhances skills-list**: `--skills-list` currently only shows skills in cache. `--health` could extend this with source URL reachability and last-sync timestamps.
- **Backup before overwrite conflicts with current terminal config pattern**: `configureTerminals()` in cachyos.js overwrites kitty/alacritty/ghostty configs directly. Adding backup would make this safe but adds a `.bak` file accumulation problem — needs a cleanup strategy.

---

## MVP Definition

Since the project is already at v4 and shipped, this section covers what's needed for the _next meaningful milestone_ rather than initial launch.

### Must Address (Next Milestone Priority)

- [ ] **Feature parity: Debian flow** — add configureGit() and Node version manager to debian_server.js. Current active requirement.
- [ ] **Skill source health check** — current active requirement. `haoshoku --health` that validates sources are reachable and contain valid SKILL.md-marked directories.
- [ ] **npm/Node compatibility** — Bun.spawnSync is blocking portability. Replace with cross-runtime spawn wrapper so `npm install -g haoshoku` actually works without Bun. Current active requirement.
- [ ] **Idempotency audit** — verify all config deploy operations are safe to re-run. Add check-before-overwrite to terminal config deployments.

### Add After Validation (v4.x)

- [ ] **Post-setup summary** — collect installed/failed/skipped items during a run, print consolidated report at end. Low effort, high UX value.
- [ ] **Backup before overwrite for terminal configs** — extend the KDE shortcuts / Zed backup pattern to fish, ghostty, kitty, alacritty.
- [ ] **Dry-run mode (`--dry-run`)** — useful for users auditing what a run would do on an existing system. Medium effort; needs threading.

### Future Consideration (v5+)

- [ ] **Additional OS targets** (Ubuntu, Fedora) — only add if there is clear user demand. Scope is significant per distro added.
- [ ] **--health with timestamps** — extend skill health to show last-sync time per source. Low value until skill ecosystem grows.
- [ ] **Skill version pinning** — allow ~/.haoshoku.json to specify a git ref/tag per source instead of always pulling main. Useful for stability but premature until skills ecosystem matures.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Debian feature parity (git config, NVM) | HIGH | LOW | P1 |
| Skill source health check (`--health`) | HIGH | LOW | P1 |
| npm/Node runtime compatibility | HIGH | MEDIUM | P1 |
| Idempotency audit + safe re-run | HIGH | MEDIUM | P1 |
| Post-setup summary / install report | MEDIUM | LOW | P2 |
| Backup before overwrite (terminal configs) | MEDIUM | LOW | P2 |
| Dry-run mode (`--dry-run`) | MEDIUM | MEDIUM | P2 |
| Additional OS targets (Ubuntu, Fedora) | MEDIUM | HIGH | P3 |
| Skill version pinning in config | LOW | MEDIUM | P3 |
| --health with sync timestamps | LOW | LOW | P3 |

**Priority key:**
- P1: Must have — active requirements already in PROJECT.md, blocking real users
- P2: Should have — standard quality bar for the toolkit category
- P3: Nice to have — defer until user demand is demonstrated

---

## Competitor Feature Analysis

| Feature | chezmoi | yadm | dotbot | ML4W Installer | Haoshoku |
|---------|---------|------|--------|----------------|----------|
| Multi-machine dotfile sync | YES (core) | YES (git-based) | partial | NO | NO (by design — one-shot) |
| Templating / per-host variants | YES | YES (Jinja) | NO | NO | NO |
| Secrets encryption (age/gpg) | YES (4 backends) | YES (archive) | NO | NO | NO (sanitize-on-backup only) |
| Dry run / diff preview | YES (`-n -v`, diff) | NO | NO | NO | NO (gap) |
| Rollback / undo | YES (via git) | YES (via git) | NO | YES (backups) | PARTIAL (backup flags only) |
| Multi-OS package installation | NO | NO | NO | YES (Arch/Fedora/openSUSE) | YES (CachyOS/Debian) |
| Claude Code config management | NO | NO | NO | NO | YES (unique) |
| Skill/agent management | NO | NO | NO | NO | YES (unique) |
| Standalone component flags | NO (chezmoi apply all) | NO | PARTIAL (dotbot -c) | PARTIAL | YES (strong) |
| Health check / source validation | NO | NO | NO | NO | PARTIAL (active requirement) |
| Config backup with sanitization | NO | NO | NO | NO | YES (Zed, KDE) |
| AI tool integration (GSD) | NO | NO | NO | NO | YES (unique) |
| Post-setup summary | NO | NO | PARTIAL (exit codes) | YES | PARTIAL (log calls only) |

**Key takeaway:** Haoshoku's unique territory is AI developer infrastructure (Claude skills, agents, GSD) and surgical standalone flags. Generic dotfiles features (templating, multi-machine sync, secrets encryption) are better left to chezmoi. The competitive advantage is depth in the AI dev workflow, not breadth in config management.

---

## Sources

- [chezmoi: Why use chezmoi?](https://www.chezmoi.io/why-use-chezmoi/) — HIGH confidence, official docs
- [dotfiles.github.io utilities list](https://dotfiles.github.io/utilities/) — HIGH confidence, community-maintained reference
- [yadm.io](https://yadm.io/) — HIGH confidence, official docs
- [ML4W dotfiles installer](https://github.com/mylinuxforwork/ml4w-dotfiles-installer) — MEDIUM confidence, WebSearch-verified
- [chezmoi diff documentation](https://www.chezmoi.io/user-guide/tools/diff/) — HIGH confidence, official docs
- [awesome-dotfiles](https://github.com/webpro/awesome-dotfiles) — MEDIUM confidence, community-curated
- haoshoku source code (src/ directory) — HIGH confidence, direct inspection

---
*Feature research for: Linux setup/dotfiles toolkit (haoshoku)*
*Researched: 2026-03-18*
