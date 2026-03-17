# Project Research Summary

**Project:** Haoshoku — Linux provisioning/dotfiles CLI toolkit
**Domain:** Multi-distro Linux setup and AI developer infrastructure management (JavaScript/Bun)
**Researched:** 2026-03-18
**Confidence:** HIGH

## Executive Summary

Haoshoku is a Bun/JavaScript CLI toolkit for bootstrapping opinionated Linux developer environments across CachyOS/Arch and Debian. Unlike generic dotfiles managers (chezmoi, yadm, dotbot), its primary differentiator is first-class AI developer infrastructure: it manages Claude Code config, skills, sub-agents, and the GSD workflow system as core features, not afterthoughts. The project is already at v4 with working functionality; the next milestone is hardening existing flows rather than adding breadth.

The recommended approach is incremental refactoring toward testability and reliability without disrupting the working feature set. The most impactful structural change is introducing a runtime abstraction layer (`src/runtime/`) and OS adapter layer (`src/os/`) so that feature logic is distro-agnostic and testable without real system commands. This is not a rewrite — it is extracting seams that are already implied by the current architecture. The build order is strict: runtime abstraction first, then OS adapters, then feature migration, then orchestrator.

The top risks are: (1) the npm portability problem (`Bun.spawnSync` leaking into a package published to npm) — this will surprise users who install via npm and get an immediate crash; (2) silent failures in the Debian flow (Fish PPA on plain Debian, missing git config, deprecated NodeSource script); (3) no dry-run mode making the tool dangerous to run on existing machines. All three are actionable and well-understood — none require fundamental rethinking.

---

## Key Findings

### Recommended Stack

The current stack is the right stack. Bun 1.3.x, Commander.js 14.x, chalk 5.x, ora 9.x, and Biome 2.x are all current, ESM-compatible, and well-suited for a provisioning CLI. No stack changes are needed to unblock the next milestone.

The one critical stack gap is Bun API usage in published code. `Bun.spawnSync` and `import { spawn } from "bun"` are not available in the Node.js runtime, which breaks `npm install -g haoshoku`. The fix is to migrate to `node:child_process` (which Bun runs natively) — this is a compatibility shim, not a runtime change. Everything else (chalk, ora, Commander, Biome) is runtime-agnostic.

**Core technologies:**
- Bun 1.3.x: runtime, test runner, package manager — built-in TypeScript, fast spawn, no separate test dep
- Commander.js 14.x: CLI argument parsing — v14 option groups useful for growing flag count
- chalk 5.x + ora 9.x: terminal output — ESM-native, reference implementations
- Biome 2.x: lint + format — single binary, 50-100x faster than ESLint+Prettier, already in use
- bun:test: test runner — `mock.module()` + `--preload` pattern enables mocking spawn and fs

**Testing pattern (key finding):** The correct path to unit testing haoshoku's spawn-heavy logic is a `runner` object exported from `src/runtime/shell.js` that can be swapped via `mock.module()` in a `--preload` setup file. Auto-mocking (`__mocks__/`) is not supported in bun:test 1.3.x and will silently fail.

### Expected Features

The project is v4 and feature-complete for its core use cases. The next milestone is quality and parity, not new features. Four items are active requirements already in PROJECT.md:

**Must have (active requirements / P1):**
- Debian flow feature parity — add git config and Node version manager (fnm) to Debian flow; currently missing vs CachyOS
- Skill source health check (`--health`) — validate sources are reachable and contain SKILL.md markers
- npm/Node runtime compatibility — replace Bun-specific APIs so `npm install -g haoshoku` works
- Idempotency audit — verify all config deploy operations are safe to re-run; terminal configs currently overwrite silently

**Should have (quality bar / P2):**
- Post-setup summary — collect installed/failed/skipped items, print at end; existing log.success() calls are not enough
- Backup before overwrite for terminal configs — extend KDE/Zed backup pattern to fish, ghostty, kitty, alacritty
- Dry-run mode (`--dry-run`) — preview what a run would change before committing; especially critical for existing machines

**Defer (v5+ / P3):**
- Additional OS targets (Ubuntu, Fedora) — only if user demand is demonstrated; scope per distro is high
- Skill version pinning — premature until skills ecosystem grows
- GUI/TUI — high maintenance burden, breaks non-interactive use; extend log output quality instead
- macOS support, Windows/WSL first-class support — scope explosion, recommend chezmoi/nix-darwin for macOS

**Haoshoku's unique territory:** AI developer infrastructure (Claude skills, agents, GSD) and surgical standalone flags. Generic dotfiles features (multi-machine sync, templating, secrets encryption) are chezmoi's domain and should not be replicated.

### Architecture Approach

The current architecture is functional but has accumulated coupling that blocks testability and cross-distro feature parity. The monolithic OS scripts (`cachyos.js`, `debian_server.js`) embed feature logic directly with distro-specific commands, making it impossible to share a feature across distros without copy-paste. The primary improvement is three layers of separation: runtime abstraction (wrapping Bun/fs APIs), OS adapter (abstracting `paru` vs `apt`), and feature modules (distro-agnostic steps that receive both).

**Major components (target architecture):**
1. `src/runtime/` — thin wrappers over Bun.spawn, node:fs, and prompts; the single seam for testing
2. `src/os/` — OS adapter layer (arch.js, debian.js) with a shared interface; features call `osAdapter.installPackage()`, never `paru` directly
3. `src/features/` — one file per user-facing capability (fish.js, git.js, claude.js, skills.js, etc.); each takes `{ osAdapter, runtime }` and is fully testable
4. `src/orchestrator.js` — replaces the if-else dispatch in haoshoku.js; resolves feature steps for full-OS presets or single-flag runs
5. `src/paths.js` — centralized PROJECT_ROOT, CONFIGS_DIR, COMMON_DIR constants (eliminates scattered `__dirname` / `fileURLToPath` across modules)

**Build order is strict:** Runtime layer → OS adapters → Feature migration → Orchestrator → Thin CLI refactor → Tests. You cannot skip ahead because features depend on the injected runtime, and the orchestrator depends on features.

### Critical Pitfalls

1. **`Bun.spawnSync` in npm-published package** — Users who `npm install -g haoshoku` crash immediately with `Bun is not defined`. Fix: migrate to `node:child_process` (which Bun also runs). Do not mix Bun-only APIs with npm publishing.

2. **Hardcoded "main" branch in skill git operations** — `updateRepo()` uses `git fetch origin main` + `git reset --hard origin/main`. Community repos using `master`/`trunk` silently fail to update with no loud error. Fix: use `git fetch origin` + `git reset --hard FETCH_HEAD` (three-line change).

3. **Fish PPA on plain Debian** — `add-apt-repository ppa:fish-shell/release-3` is a Launchpad/Ubuntu mechanism that silently fails on plain Debian. Fix: detect `ID=ubuntu` vs `ID=debian` in `/etc/os-release`; use openSUSE Build Service repo for Debian.

4. **`process.exit(1)` inside `syncSkills()` library function** — When called mid-OS-setup (from `--claude` flow), it aborts the entire provisioning run with no cleanup or partial success summary. Fix: return `{ succeeded, failed[] }` from syncSkills; reserve process.exit for CLI entry point handlers only.

5. **No dry-run mode** — `haoshoku` immediately writes configs, installs packages, and modifies system files. On a misidentified OS or existing machine, this is destructive with no preview. Fix: `--dry-run` flag gates all `runCommand` + fs write operations via the runtime abstraction layer.

6. **NodeSource setup script deprecated** — `debian_server.js` uses `curl ... | sudo bash -` from NodeSource, which is deprecated and may install wrong Node versions with GPG errors on newer Debian. Fix: switch to `fnm` (which `nvm.fish` expects anyway) or manual NodeSource deb repo method.

---

## Implications for Roadmap

Based on research, the build order follows the architecture dependency graph exactly: you cannot test features until you have injectable runtime wrappers, and you cannot achieve feature parity until you have OS adapters. Quick wins (hardcoded branch, NodeSource, Fish PPA) should be hotfixed before or during Phase 1 since they are single-file changes with no dependencies.

### Phase 0: Critical Hotfixes
**Rationale:** Three bugs in the current codebase have trivial fixes but high user impact. Address before any refactoring to avoid shipping known breakage.
**Delivers:** Skill sync works against non-main repos; Debian Fish install works on plain Debian; Node.js installs correctly on Debian
**Addresses:** Hardcoded "main" branch (3-line fix in skill_manager.js), Fish PPA distro check (debian_server.js), NodeSource deprecation (switch to fnm)
**Avoids:** Silent failures that look like success and waste user debugging time
**Research flag:** Standard patterns — no further research needed; fixes are prescribed in PITFALLS.md

### Phase 1: Runtime Abstraction + npm Portability
**Rationale:** This is the foundational layer that unblocks everything else. Cannot write tests, cannot achieve portability, and cannot implement dry-run without injectable runtime wrappers. Aligns with ARCHITECTURE.md Phase 1 build order.
**Delivers:** `src/runtime/shell.js`, `src/runtime/fs.js`, `src/runtime/prompt.js`; `Bun.spawnSync` replaced with `node:child_process`; `npm install -g haoshoku` works without Bun
**Addresses:** npm portability (P1 active requirement); testability prerequisite
**Avoids:** Bun.spawnSync crash for npm users (Pitfall 2)
**Uses:** `node:child_process` (Bun runs Node APIs natively — no behavior change for Bun users)
**Research flag:** Standard patterns — well-documented in STACK.md and ARCHITECTURE.md

### Phase 2: Debian Flow Parity
**Rationale:** Active P1 requirement. Debian users are missing git config and a working Node.js install. The OS adapter refactor also starts here — once Debian and Arch adapters exist as separate files, feature parity becomes structural rather than manual.
**Delivers:** `src/os/arch.js`, `src/os/debian.js`, `src/os/base.js`; `configureGit()` in Debian flow; `fnm` replacing NodeSource; Fish install fixed for plain Debian
**Addresses:** Debian feature parity (P1), Pitfall 3 (Fish PPA), Pitfall 4 (missing git config), Pitfall 8 (NodeSource deprecation)
**Avoids:** Debian users feeling like second-class citizens; git unusable post-provision on Debian servers
**Research flag:** May need brief research on fnm setup for Debian fish integration; otherwise patterns are clear

### Phase 3: Feature Module Migration + Idempotency Audit
**Rationale:** With OS adapters in place, helpers can be migrated to distro-agnostic features that use the adapter interface. This directly fixes the feature parity maintenance problem (currently each distro must duplicate feature logic). The idempotency audit fits here because it touches all the same files.
**Delivers:** `src/features/` directory (fish.js, git.js, claude.js, skills.js, zed.js, kde.js, docker.js, firewall.js); check-before-overwrite on all terminal config deployments; backup-before-overwrite for fish/ghostty/kitty/alacritty
**Addresses:** Idempotency (P1 active requirement), Backup before overwrite (P2), Feature parity maintenance
**Avoids:** Silent config overwrites, copy-paste feature duplication across distro scripts
**Research flag:** Standard patterns — ARCHITECTURE.md has exact implementation examples

### Phase 4: Orchestrator + Dry-Run Mode
**Rationale:** Once features are self-contained modules, the orchestrator replaces the if-else dispatch in haoshoku.js and enables dry-run by gating the runtime layer. These are coupled: dry-run is trivial once runtime injection exists.
**Delivers:** `src/orchestrator.js` with OS presets; `--dry-run` flag that replaces all shell.run + fs operations with log output; `src/paths.js` centralizing PROJECT_ROOT
**Addresses:** Dry-run mode (P2), scattered `__dirname` anti-pattern, process.exit inside syncSkills (Pitfall 7)
**Avoids:** Destructive operations on existing machines without preview (Pitfall 6); dispatch logic in CLI entry point (Architecture anti-pattern 3)
**Research flag:** Standard patterns — well-documented in ARCHITECTURE.md; no external research needed

### Phase 5: Tests + Post-Setup Polish
**Rationale:** The injectable runtime from Phase 1 and feature modules from Phase 3 make this straightforward. The `mock.module()` + `--preload` pattern is prescribed. Post-setup summary is a natural cap to the milestone.
**Delivers:** `tests/features/*.test.js` with mocked runtime/adapter; `tests/os/*.test.js`; post-setup summary report; skill health check (`--health` flag)
**Addresses:** Skill source health check (P1 active requirement), Post-setup summary (P2), test coverage for Debian flow
**Avoids:** "Looks done but isn't" scenarios (PITFALLS.md checklist); silent skill sync failures for empty sources
**Research flag:** Health check URL reachability + SKILL.md detection may need minor implementation research; everything else is standard

### Phase Ordering Rationale

- Phase 0 before anything: the hardcoded branch and Fish PPA bugs are one-liner fixes that will break users today; no reason to hold them behind refactoring
- Phase 1 before Phase 3: feature modules must receive an injectable runtime — if you migrate helpers to features before the runtime layer exists, you'll have to revisit every file again
- Phase 2 before Phase 3: OS adapters must exist before features can call `osAdapter.installPackage()` — otherwise feature migration has no interface to target
- Phase 4 after Phase 3: the orchestrator depends on features being discrete modules; the dry-run flag depends on runtime injection
- Phase 5 last: tests require the injectable seams from Phase 1-3; post-setup summary requires knowing what all the features report

### Research Flags

Phases with standard patterns (skip `/gsd:research-phase`):
- **Phase 0:** All three fixes are prescribed with exact code in PITFALLS.md
- **Phase 1:** node:child_process compatibility with Bun is verified; runtime injection pattern is in ARCHITECTURE.md
- **Phase 3:** Feature module shape and mock patterns are fully documented in ARCHITECTURE.md
- **Phase 4:** Orchestrator and dry-run patterns fully documented in ARCHITECTURE.md

May benefit from brief research:
- **Phase 2 (fnm on Debian):** Verify fnm install path and fish shell integration on Debian 12 before implementation
- **Phase 5 (health check):** Verify SKILL.md detection approach against real community skill repos

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All packages verified via official sources; Bun compatibility confirmed; exact versions current as of 2026-03-18 |
| Features | HIGH | Based on direct codebase inspection + competitor analysis (chezmoi, yadm, dotbot, ML4W); P1 items validated against PROJECT.md active requirements |
| Architecture | HIGH | Based on direct code audit; patterns are battle-tested (strategy pattern, DI) with concrete examples in research |
| Pitfalls | HIGH | All 8 critical pitfalls sourced from direct code audit; reproduction paths are clear; NodeSource deprecation verified against upstream GitHub |

**Overall confidence:** HIGH

### Gaps to Address

- **fnm on Debian fish integration:** The pitfalls research prescribes switching from NodeSource to fnm, but the exact Debian+fish integration path (fish function sourcing for fnm) was not verified against a live Debian 12 system. Verify during Phase 2 planning.

- **Community skill repo branch conventions:** The hardcoded "main" fix is clear, but if haoshoku is intended to support community skill repos broadly, the health check phase should validate what branch naming conventions are common in practice.

- **`prompts` stdin drain under new architecture:** The `drainStdin()` workaround in utils.js is currently a known issue. Once prompts is wrapped in `src/runtime/prompt.js`, verify the drain behavior is correctly isolated and doesn't leak into the feature layer.

---

## Sources

### Primary (HIGH confidence)
- Bun 1.3.9 release notes + test/mocks docs (bun.sh) — spawn patterns, mock.module, preload
- Commander.js changelog (github.com/tj/commander.js) — v14 features, option groups
- Biome v2 announcement (biomejs.dev) — type-aware linting without tsconfig
- chezmoi architecture docs (chezmoi.io) — design patterns, dry-run model
- haoshoku source code (direct inspection) — current state of all modules
- NodeSource deprecation (github.com/nodesource/distributions/discussions/1639) — confirmed deprecated

### Secondary (MEDIUM confidence)
- Fish shell Debian packaging (tracker.debian.org/pkg/fish) — openSUSE Build Service repo path
- prompts stdin drain issue (github.com/terkelg/prompts/issues) — known issue, workaround confirmed in utils.js
- awesome-dotfiles (github.com/webpro/awesome-dotfiles) — competitor feature baseline

### Tertiary (LOW confidence)
- curl-pipe-bash security tradeoffs — community blog posts; risk is understood but exact mitigation for each installer URL not verified

---
*Research completed: 2026-03-18*
*Ready for roadmap: yes*
