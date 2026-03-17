# Roadmap: Haoshoku

## Overview

This milestone hardens a feature-complete v4 tool into something reliable enough to run on unfamiliar machines. The work moves in three natural steps: fix the known breakage (bugs and npm crash), fill the gaps in the Debian flow while making config deploys safe, then cap the whole thing with a dry-run mode that lets users preview before committing.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Fixes + Portability** - Hotfix three silent bugs and replace Bun-specific APIs so npm install works
- [ ] **Phase 2: Debian Parity + Robustness** - Complete the Debian flow and make all config deploys backup-safe
- [ ] **Phase 3: Dry Run + Post-Setup Polish** - Add preview mode and a post-run summary

## Phase Details

### Phase 1: Fixes + Portability
**Goal**: The tool installs and runs correctly regardless of whether the user invoked it via Bun or npm, and the three known silent-failure bugs are gone
**Depends on**: Nothing (first phase)
**Requirements**: FIX-01, FIX-02, FIX-03, PORT-01, PORT-02, PORT-03, PORT-04
**Success Criteria** (what must be TRUE):
  1. `npm install -g haoshoku && haoshoku --version` completes without a "Bun is not defined" crash on a machine with only Node.js installed
  2. Skill sync against a repo whose default branch is not "main" updates the local cache correctly
  3. `haoshoku --debian` runs Fish shell install on a plain Debian 12 system without hitting a Launchpad PPA error
  4. Node.js installs on a fresh Debian server via fnm (not the deprecated NodeSource curl-pipe-bash script)
  5. `package.json` `engines` field reflects Node >= 18 or Bun >= 1.0 so package managers surface the requirement
**Plans**: TBD

Plans:
- [ ] 01-01: Replace Bun.spawnSync / Bun.spawn with node:child_process throughout src/ and add engines field
- [ ] 01-02: Fix FIX-01 (dynamic branch detection), FIX-02 (Debian Fish repo), FIX-03 (fnm replaces NodeSource)

### Phase 2: Debian Parity + Robustness
**Goal**: A Debian server provisioned by haoshoku has git configured and Zed config synced (matching CachyOS parity), skills sync runs automatically, and no config file is silently overwritten without a backup
**Depends on**: Phase 1
**Requirements**: DEB-01, DEB-02, DEB-03, ROB-01, ROB-02, ROB-03
**Success Criteria** (what must be TRUE):
  1. Running `haoshoku --debian` prompts for git user name/email and writes `~/.gitconfig` (same as CachyOS flow)
  2. Debian flow offers to sync Zed editor config, not just CachyOS
  3. Skill sync runs automatically during Debian setup without requiring a separate manual invocation
  4. Existing fish, ghostty, and kitty config files are renamed to `*.bak` before any overwrite
  5. A failed skill sync returns a structured error to the caller instead of calling `process.exit(1)` mid-setup
  6. Post-setup summary prints a list of what was installed, what was changed, and what was skipped
**Plans**: TBD

Plans:
- [ ] 02-01: Debian parity — add configureGit, Zed sync, and auto-skill-sync to debian_server.js
- [ ] 02-02: Robustness — backup-before-overwrite for terminal configs + syncSkills error return + post-setup summary

### Phase 3: Dry Run + Post-Setup Polish
**Goal**: Users can safely preview exactly what haoshoku will do on their machine before any file is written or package installed
**Depends on**: Phase 2
**Requirements**: DRY-01, DRY-02
**Success Criteria** (what must be TRUE):
  1. `haoshoku --dry-run` prints every action that would execute (install, copy, symlink, config write) without touching the filesystem or running any package manager
  2. Dry-run output labels each line with its action type (INSTALL / COPY / SYMLINK / CONFIG) so the user can scan what category of change is pending
  3. Running `haoshoku --dry-run` followed by `haoshoku` produces a real run that matches what the dry-run described
**Plans**: TBD

Plans:
- [ ] 03-01: Implement --dry-run flag with action-type labeling across all install and config-deploy paths

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Fixes + Portability | 0/2 | Not started | - |
| 2. Debian Parity + Robustness | 0/2 | Not started | - |
| 3. Dry Run + Post-Setup Polish | 0/1 | Not started | - |
