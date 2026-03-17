# Architecture Research

**Domain:** Linux setup/dotfiles toolkit (multi-distro, CLI, JavaScript/Bun)
**Researched:** 2026-03-18
**Confidence:** HIGH (based on direct codebase analysis + chezmoi official architecture docs)

## Standard Architecture

### System Overview (Current State)

```
┌─────────────────────────────────────────────────────────────┐
│                      CLI Entry Point                         │
│                      haoshoku.js                             │
│  Commander.js options  |  detectOS()  |  prompts()           │
│  Long if-else chain dispatches to helpers / os_scripts       │
└────────┬──────────────────────────────────┬──────────────────┘
         │                                  │
         ▼                                  ▼
┌────────────────────┐           ┌──────────────────────────────┐
│   OS Flow Scripts  │           │      Helper Modules           │
│  src/os_scripts/   │           │  src/helpers/                 │
│                    │           │                               │
│  cachyos.js        │           │  configure_claude.js          │
│  debian_server.js  │           │  configure_git.js             │
│                    │           │  configure_ghostty.js         │
│  Each file = one   │           │  configure_kde_theme.js       │
│  full distro flow  │           │  configure_zed.js             │
│  (monolithic fn)   │           │  skill_manager.js             │
└────────┬───────────┘           └────────────┬─────────────────┘
         │                                    │
         └──────────────┬─────────────────────┘
                        ▼
         ┌──────────────────────────────┐
         │       Shared Utilities       │
         │       src/common/            │
         │                              │
         │  utils.js                    │
         │    runCommand(cmd, opts)     │
         │    commandExists(cmd)        │
         │    promptUser(msg, initial)  │
         │    copyDirRecursive(src,dst) │
         │  ui.js                       │
         │    showBanner()              │
         │    withSpinner(label, fn)    │
         └──────────────┬───────────────┘
                        │
                        ▼
         ┌──────────────────────────────┐
         │          File System         │
         │  configs/    (templates)     │
         │  common/     (pkg lists)     │
         │  ~/.claude/  (deploy target) │
         │  ~/.config/  (deploy target) │
         │  ~/.cache/haoshoku/ (skills) │
         └──────────────────────────────┘
```

### Current Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `haoshoku.js` | CLI parsing, OS detection, dispatch | All modules via direct import |
| `src/os_scripts/cachyos.js` | CachyOS full setup flow (packages, AUR, dev tools, shell, KDE) | helpers, common |
| `src/os_scripts/debian_server.js` | Debian server setup (apt, SSH, UFW, Docker, fish) | helpers, common |
| `src/helpers/configure_claude.js` | Claude Code CLI install, config sync/backup, GSD install | common/utils |
| `src/helpers/skill_manager.js` | Git clone skills, symlink to ~/.claude/skills/, agent merge | common/utils (log only) |
| `src/helpers/configure_git.js` | SSH key generation, multi-profile git config | common/utils |
| `src/helpers/configure_zed.js` | Zed config sync, backup with sanitization | common/utils |
| `src/helpers/configure_kde_theme.js` | KDE Ocean theme sync/backup | common/utils |
| `src/helpers/configure_ghostty.js` | Ghostty theme sync | common/utils |
| `src/common/utils.js` | Shell execution (Bun.spawn), logging (chalk), prompts | Bun runtime, node:fs |
| `src/common/ui.js` | Banner, spinner via ora | chalk, gradient-string |
| `configs/` | Version-controlled config templates | Read by helpers at deploy time |
| `common/` | Package list files (paru, flatpak) | Read by os_scripts at install time |

---

## Recommended Architecture (Improved)

The primary architectural improvements needed are: (1) OS abstraction so helpers are distro-agnostic, (2) a runtime abstraction layer for testability, and (3) a step/feature registry so flows are composable rather than monolithic.

### Improved System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      CLI Entry Point                         │
│                      haoshoku.js                             │
│  Commander.js options  |  OS detection  |  prompt fallback   │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Setup Orchestrator                        │
│               src/orchestrator.js                            │
│                                                              │
│  Receives: { os, features[] }                                │
│  Resolves: steps[] via feature registry                      │
│  Executes: steps in dependency order                         │
└────────┬──────────────────────────────────────┬─────────────┘
         │                                      │
         ▼                                      ▼
┌────────────────────┐               ┌──────────────────────────┐
│  OS Adapter Layer  │               │    Feature Modules        │
│  src/os/           │               │    src/features/          │
│                    │               │                           │
│  arch.js           │◄──────────────│  fish.js      (shell)     │
│  debian.js         │  uses adapter │  git.js       (vcs)       │
│  base.js (shared)  │  for pkg ops  │  claude.js    (ai tools)  │
│                    │               │  skills.js    (skills)    │
│  installPackage()  │               │  zed.js       (editor)    │
│  isInstalled()     │               │  kde.js       (desktop)   │
│  addService()      │               │  docker.js    (infra)     │
│  getPackageMgr()   │               │  firewall.js  (security)  │
└────────────────────┘               └──────────────┬───────────┘
                                                    │
                                                    ▼
                                     ┌──────────────────────────┐
                                     │    Runtime Abstraction   │
                                     │    src/runtime/          │
                                     │                          │
                                     │  shell.js                │
                                     │    run(args, opts)       │
                                     │    exists(cmd)           │
                                     │  fs.js                   │
                                     │    copyFile()            │
                                     │    symlink()             │
                                     │    readJson()            │
                                     │  prompt.js               │
                                     │    confirm(msg)          │
                                     │    select(choices)       │
                                     └──────────────────────────┘
```

---

## Recommended Project Structure

```
haoshoku.js                  # CLI entry — thin, only parses + dispatches
src/
├── orchestrator.js          # Resolves and runs feature steps in order
├── os/                      # OS adapter layer
│   ├── index.js             # Factory: createOsAdapter(osType)
│   ├── base.js              # Abstract interface + shared helpers
│   ├── arch.js              # Arch/CachyOS implementation
│   └── debian.js            # Debian implementation
├── features/                # One file per user-facing capability
│   ├── fish.js              # Fish shell + Fisher + Starship
│   ├── git.js               # SSH keys + multi-profile gitconfig
│   ├── claude.js            # Claude Code install + config sync
│   ├── skills.js            # Skill manager (clone + symlink)
│   ├── zed.js               # Zed config sync/backup
│   ├── kde.js               # KDE theme + Glass blur
│   ├── docker.js            # Docker install + daemon setup
│   └── firewall.js          # UFW / iptables rules
├── runtime/                 # Thin wrappers — the seam for testing
│   ├── shell.js             # Wraps Bun.spawn — injectable in tests
│   ├── fs.js                # Wraps node:fs — injectable in tests
│   └── prompt.js            # Wraps prompts — injectable in tests
└── common/
    ├── utils.js             # Kept: log, copyDirRecursive
    └── ui.js                # Kept: banner, spinner
configs/                     # Template files (unchanged)
common/                      # Package lists (unchanged)
tests/
├── features/                # Feature-level tests with mocked runtime
├── os/                      # OS adapter unit tests
└── utils.test.js            # Common utility tests (existing, kept)
```

### Structure Rationale

- **`src/os/`:** Isolates the only code that differs by distro. Features call `osAdapter.installPackage("fish")` — they never call `paru` or `apt` directly. Adding a new distro means adding one file here, not editing feature code.
- **`src/features/`:** Each feature is a self-contained async function that takes `{ osAdapter, runtime }`. Features declare their steps, not the OS scripts. This eliminates the problem where Debian lacks git config because it was coded into `cachyos.js`.
- **`src/runtime/`:** Thin injectable wrappers. In tests, pass a mock `shell` that records calls without executing. This is the single change that unlocks unit testing for all feature logic.
- **`src/orchestrator.js`:** Replaces the giant if-else in `haoshoku.js`. Reads a feature list (from CLI flags or a full-OS preset) and runs them in dependency order.

---

## Architectural Patterns

### Pattern 1: OS Adapter (Strategy Pattern)

**What:** An interface with OS-specific implementations, selected at runtime from the detected OS type. Features call abstract methods like `installPackage()` — the adapter handles `paru` vs `apt`.

**When to use:** Any operation that differs between distros (package install, service management, shell default path detection).

**Trade-offs:** Adds one indirection layer. Worth it because it makes adding new distros a single-file concern and enables distro-agnostic features.

**Example:**

```javascript
// src/os/base.js — defines the interface
export class OsAdapter {
  constructor(runtime) { this.runtime = runtime; }
  async installPackage(name) { throw new Error("Not implemented"); }
  async isInstalled(cmd) { throw new Error("Not implemented"); }
  async enableService(name) { throw new Error("Not implemented"); }
}

// src/os/arch.js
export class ArchAdapter extends OsAdapter {
  async installPackage(name) {
    return this.runtime.shell.run(["paru", "-S", "--noconfirm", name]);
  }
}

// src/os/debian.js
export class DebianAdapter extends OsAdapter {
  async installPackage(name) {
    return this.runtime.shell.run(["sudo", "apt", "install", "-y", name]);
  }
}

// src/os/index.js — factory
export function createOsAdapter(osType, runtime) {
  if (osType === "cachyos") return new ArchAdapter(runtime);
  if (osType === "debian-server") return new DebianAdapter(runtime);
  throw new Error("Unsupported OS: " + osType);
}
```

### Pattern 2: Runtime Injection (Dependency Injection)

**What:** Feature modules receive a `runtime` object (`{ shell, fs, prompt }`) rather than calling Bun APIs directly. Tests inject a fake runtime that records calls.

**When to use:** Any feature function that calls `runCommand`, `fs.copyFileSync`, or `prompts`. That is: every helper and OS script.

**Trade-offs:** Slightly more verbose function signatures. Eliminates the "can't mock native modules in Bun" problem that the existing tests already identify as a blocker.

**Example:**

```javascript
// src/features/fish.js — uses injected runtime, no direct Bun/fs calls
export async function setupFish({ osAdapter, runtime }) {
  if (!(await runtime.shell.exists("fish"))) {
    await osAdapter.installPackage("fish");
  }
  if (await runtime.prompt.confirm("Set Fish as default shell?", true)) {
    const fishPath = await runtime.shell.capture(["which", "fish"]);
    await runtime.shell.run(["chsh", "-s", fishPath.trim()]);
  }
}

// tests/features/fish.test.js — no real shell invocations
import { setupFish } from "../../src/features/fish.js";
import { describe, it, expect } from "bun:test";

describe("setupFish", () => {
  it("installs fish when not present", async () => {
    const installed = [];
    const mockAdapter = { installPackage: async (n) => installed.push(n) };
    const mockRuntime = {
      shell: { exists: async () => false, run: async () => true },
      prompt: { confirm: async () => false },
    };
    await setupFish({ osAdapter: mockAdapter, runtime: mockRuntime });
    expect(installed).toContain("fish");
  });
});
```

### Pattern 3: Feature-as-Step (Composable Steps)

**What:** Each feature is a discrete async function with a known shape `({ osAdapter, runtime }) => Promise<void>`. The orchestrator collects the relevant steps for a given run (full OS setup vs a single flag) and executes them sequentially.

**When to use:** Always. Replaces the current approach of monolithic `runCachyOSSetup()` embedding all logic.

**Trade-offs:** Slightly more orchestration code upfront. Unlocks: feature parity across distros, dry-run mode, selective re-runs, testing individual features.

**Example:**

```javascript
// src/orchestrator.js
const OS_PRESETS = {
  "cachyos": ["fish", "git", "zed", "kde", "claude", "skills"],
  "debian-server": ["fish", "git", "docker", "firewall", "claude", "skills"],
};

export async function runSetup({ os, features, runtime }) {
  const osAdapter = createOsAdapter(os, runtime);
  const steps = features || OS_PRESETS[os];
  for (const name of steps) {
    const { default: step } = await import(`./features/${name}.js`);
    await step({ osAdapter, runtime });
  }
}
```

---

## Data Flow

### Full OS Setup Flow

```
User: haoshoku (no flags)
    |
    v
haoshoku.js: detectOS() -> "cachyos" | "debian-server" | prompt
    |
    v
orchestrator.js: buildStepList(osType)
    -> [ fish, git, claude, skills, zed, kde, ... ]
    |
    v
For each step:
    step({ osAdapter, runtime })
        |
        v
        osAdapter.installPackage(name)
            | (Arch path)
            v
            runtime.shell.run(["paru", "-S", "--noconfirm", name])
        OR
        runtime.fs.copyFile(src, dest)
        OR
        runtime.prompt.confirm(msg)
    |
    v
log.success("Setup complete")
```

### Standalone Flag Flow

```
User: haoshoku --claude
    |
    v
haoshoku.js: options.claude = true
    |
    v
orchestrator.js: buildStepList(["claude"])
    -> [ claude ]  (skills auto-prepended if cache empty)
    |
    v
claudeFeature({ osAdapter: nullAdapter, runtime })
    |
    v
runtime.fs operations: configs/claude/ -> ~/.claude/
```

### Skill Sync Data Flow

```
~/.haoshoku.json: { skillSources: ["https://github.com/user/repo"] }
    |
    v
skill_manager: loadConfig()
    |
    v
For each URL: cloneOrPullRepo(url, update)
    | (git clone --depth 1)
    v
~/.cache/haoshoku/owner-repo/skills/{skill}/SKILL.md  (cache)
    |
    v
mergeSkills(sources): first-source-wins by skill name
    |
    v
~/.claude/skills/{skill} -- symlink --> cache   (deploy)

mergeAgents(sources):
~/.claude/agents/{agent}.md -- symlink --> cache
```

### Configuration Sync Data Flow

```
configs/{tool}/       (version-controlled templates in haoshoku repo)
    | copyFile / copyDirRecursive
    v
~/.config/{tool}/     (live deployment target)

Backup direction (inverse):
~/.config/{tool}/     (live)
    | copyFile (+ sanitize for zed)
    v
configs/{tool}/       (commit back to repo)
```

---

## Component Boundaries

| Boundary | Direction | Communication | Rule |
|----------|-----------|---------------|------|
| CLI to Orchestrator | one-way | pass `{ osType, features[] }` | CLI must not contain setup logic |
| Orchestrator to OS Adapter | one-way | method calls on adapter object | Orchestrator never checks `osType` string after adapter is created |
| Feature to OS Adapter | one-way | `osAdapter.installPackage(name)` | Features never call `paru` or `apt` directly |
| Feature to Runtime | one-way | `runtime.shell.run()` etc. | Features never import `bun` or `node:fs` directly |
| Skill Manager to Runtime | one-way | `runtime.shell.spawnSync()` | Eliminates `Bun.spawnSync` calls blocking Node compat |
| Helpers to Configs dir | read-only | `fs.readFileSync(configsPath)` | Config templates are never written by helpers |
| OS Scripts to Common dir | read-only | package list files | Never write to `common/` at runtime |

---

## Build Order (Dependency Graph)

This determines phase ordering for implementation:

```
Phase 1: Runtime abstraction layer
  src/runtime/shell.js
  src/runtime/fs.js
  src/runtime/prompt.js
  (No dependencies — pure wrappers over Bun APIs)

Phase 2: OS adapter layer
  src/os/base.js  (interface)
  src/os/arch.js
  src/os/debian.js
  (Depends on: runtime/shell.js)

Phase 3: Refactor helpers -> features
  src/features/fish.js
  src/features/git.js
  src/features/claude.js   <- configure_claude.js migrated
  src/features/skills.js   <- skill_manager.js migrated
  src/features/zed.js
  src/features/kde.js
  src/features/docker.js
  src/features/firewall.js
  (Depends on: os adapter, runtime)

Phase 4: Orchestrator
  src/orchestrator.js
  (Depends on: all features, os adapters)

Phase 5: Thin CLI entry
  haoshoku.js refactor
  (Depends on: orchestrator)

Phase 6: Tests
  tests/features/*.test.js  (mock runtime, mock adapter)
  tests/os/*.test.js         (mock shell)
  (Depends on: injectable interfaces from Phases 1-3)
```

---

## Anti-Patterns (Current Codebase)

### Anti-Pattern 1: OS-Coupled Features

**What people do:** Feature logic lives inside `cachyos.js` — e.g., `configureFishShell()` calls `paru -S fish` directly. The Debian equivalent duplicates the logic but calls `apt install fish`.

**Why it's wrong:** Feature parity is maintained by copy-paste. Every new feature requires two edits. The current "Active" requirement — feature parity between CachyOS and Debian — is difficult because of this coupling.

**Do this instead:** A `fish.js` feature calls `osAdapter.installPackage("fish")`. The adapter handles `paru` vs `apt`. One feature file serves all distros.

### Anti-Pattern 2: Untestable Bun.spawnSync Direct Calls

**What people do:** Feature code calls `Bun.spawnSync(["which", cmd])` directly (found in `configure_claude.js`, `skill_manager.js`, `configure_git.js`, `debian_server.js`).

**Why it's wrong:** Cannot be mocked in tests. The existing test suite acknowledges this: "We can't easily mock the entire module imports in Bun test yet." Tests degrade to "does the configs directory exist?" rather than testing logic.

**Do this instead:** Wrap Bun APIs in `src/runtime/shell.js`. Inject the shell runtime into features. Tests inject a recording mock.

### Anti-Pattern 3: Dispatch Logic in CLI Entry Point

**What people do:** `haoshoku.js` contains a long if-else chain checking every `options.*` flag and calling the corresponding function. Adding a new flag means editing the entry point.

**Why it's wrong:** CLI entry point grows unboundedly. Hard to test the dispatch logic. Hard to add combinations (e.g., `--claude --skills` as an atomic operation).

**Do this instead:** CLI passes a normalized feature list to the orchestrator. The orchestrator owns dispatch and dependency resolution.

### Anti-Pattern 4: Scattered PROJECT_ROOT Resolution

**What people do:** `cachyos.js` uses `path.resolve(__dirname, "..", "..")` for `PROJECT_ROOT`. `configure_claude.js` does the same. Debian uses `fileURLToPath(import.meta.url)` correctly; CachyOS does not.

**Why it's wrong:** `__dirname` is not available in ESM modules without `fileURLToPath` conversion. The inconsistency causes runtime errors when running from different contexts. Every helper re-derives the same root path.

**Do this instead:** Centralize `PROJECT_ROOT` in `src/paths.js` and export named constants for `CONFIGS_DIR`, `COMMON_DIR`, etc. All modules import from there.

---

## Integration Points

### External Dependencies

| Integration | Pattern | Notes |
|-------------|---------|-------|
| Bun.spawn / Bun.spawnSync | Wrap in `runtime/shell.js` | Current direct usage blocks Node compat and testability |
| git (CLI) | Shell run via runtime | skill_manager depends on PATH git; validate with `ensureGit()` (already done) |
| curl installers | Shell run via runtime | Rust, Foundry, NodeSource — piped to bash, no Bun API equivalent |
| prompts (npm) | Wrap in `runtime/prompt.js` | `drainStdin()` hack in utils.js can be isolated here |
| Claude Code installer | Shell run via runtime | curl-pipe-bash pattern, standard |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `skill_manager` and `configure_claude` | `configure_claude` imports `syncSkills` | Acceptable — skills are a prerequisite for Claude config. Keep as-is after migration. |
| OS scripts and helpers | OS scripts call helpers directly | After refactor: orchestrator calls both as features in sequence |
| `haoshoku.js` and `CACHE_DIR` | Entry point checks `existsSync(CACHE_DIR)` before `--claude` | After refactor: move this dependency-check logic into orchestrator |

---

## Scalability Considerations

This is a CLI tool, not a service. "Scale" means number of distros and features supported.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 2 distros (current) | Monolithic os_scripts is manageable but already shows strain (feature parity gap) |
| 3-4 distros (add Ubuntu, Fedora) | OS adapter pattern becomes essential — without it every feature must be duplicated per distro |
| 10+ features per distro | Orchestrator with dependency graph prevents ordering bugs (e.g., install fish before configuring fisher plugins) |

---

## Sources

- Chezmoi architecture documentation: [https://www.chezmoi.io/developer-guide/architecture/](https://www.chezmoi.io/developer-guide/architecture/)
- Chezmoi design decisions (single source of truth, abstraction scope): [https://www.chezmoi.io/user-guide/frequently-asked-questions/design/](https://www.chezmoi.io/user-guide/frequently-asked-questions/design/)
- Dotfiles ecosystem overview: [https://dotfiles.github.io/inspiration/](https://dotfiles.github.io/inspiration/)
- Awesome dotfiles resource list: [https://github.com/webpro/awesome-dotfiles](https://github.com/webpro/awesome-dotfiles)
- ArchWiki dotfiles patterns: [https://wiki.archlinux.org/title/Dotfiles](https://wiki.archlinux.org/title/Dotfiles)
- Direct codebase analysis: `/home/xzat/personal/haoshoku/` (all source files)

---
*Architecture research for: Linux setup/dotfiles toolkit (haoshoku)*
*Researched: 2026-03-18*
