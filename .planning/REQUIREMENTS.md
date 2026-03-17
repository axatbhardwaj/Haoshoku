# Requirements: Haoshoku

**Defined:** 2026-03-18
**Core Value:** One command bootstraps a complete, opinionated development environment with all tools, configs, and AI coding infrastructure ready to use.

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Critical Fixes

- [ ] **FIX-01**: Skill manager detects default branch dynamically instead of hardcoding "main"
- [ ] **FIX-02**: Debian Fish install uses correct repo (not Ubuntu PPA) with fallback
- [ ] **FIX-03**: Debian Node.js install uses fnm or direct binary instead of deprecated NodeSource script

### Runtime Portability

- [ ] **PORT-01**: Replace all Bun.spawnSync/Bun.spawn with node:child_process equivalents
- [ ] **PORT-02**: Replace `import { spawn } from "bun"` in utils.js with node:child_process spawn
- [ ] **PORT-03**: Add `engines` field to package.json specifying Node >= 18 or Bun >= 1.0
- [ ] **PORT-04**: npm global install (`npm i -g haoshoku`) works without Bun installed

### Debian Parity

- [ ] **DEB-01**: Debian flow includes configureGit (matching CachyOS)
- [ ] **DEB-02**: Debian flow offers Zed config sync (matching CachyOS)
- [ ] **DEB-03**: Debian flow runs skill sync automatically (not just prompted after)

### Robustness

- [ ] **ROB-01**: skill_manager syncSkills returns error instead of calling process.exit(1)
- [ ] **ROB-02**: Terminal configs (fish, ghostty, kitty) backup existing files before overwriting
- [ ] **ROB-03**: Post-setup summary shows what was installed, changed, and skipped

### Dry Run

- [ ] **DRY-01**: `--dry-run` flag shows what would be installed/changed without executing
- [ ] **DRY-02**: Dry run output distinguishes between install, copy, symlink, and system config actions

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Architecture

- **ARCH-01**: OS adapter layer (strategy pattern) for distro-agnostic feature modules
- **ARCH-02**: Feature-as-step orchestrator replacing if-else dispatch in haoshoku.js
- **ARCH-03**: Centralized paths module replacing scattered __dirname/fileURLToPath patterns

### Testing

- **TEST-01**: Unit tests for skill_manager with mocked git operations
- **TEST-02**: Integration tests for OS setup flows using container-based testing
- **TEST-03**: Test coverage for config sync/backup roundtrip

### Additional Distros

- **DIST-01**: Ubuntu as explicit target (not just Debian)
- **DIST-02**: Fedora support

## Out of Scope

| Feature | Reason |
|---------|--------|
| GUI/TUI installer | CLI-only by design, keeps scope tight |
| macOS/Windows support | Linux-focused tool, different ecosystem |
| Secrets management (age/gpg) | Duplicates chezmoi; haoshoku manages configs not secrets |
| Multi-machine sync | Out of scope; use git for that |
| Config file editing/patching | Only full file copy/symlink, keeps sync simple and predictable |
| Rollback/undo system | Too complex for v1; dry-run is the safer path |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FIX-01 | Phase 1 | Pending |
| FIX-02 | Phase 1 | Pending |
| FIX-03 | Phase 1 | Pending |
| PORT-01 | Phase 1 | Pending |
| PORT-02 | Phase 1 | Pending |
| PORT-03 | Phase 1 | Pending |
| PORT-04 | Phase 1 | Pending |
| DEB-01 | Phase 2 | Pending |
| DEB-02 | Phase 2 | Pending |
| DEB-03 | Phase 2 | Pending |
| ROB-01 | Phase 2 | Pending |
| ROB-02 | Phase 2 | Pending |
| ROB-03 | Phase 2 | Pending |
| DRY-01 | Phase 3 | Pending |
| DRY-02 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0

---
*Requirements defined: 2026-03-18*
*Last updated: 2026-03-18 after roadmap creation*
