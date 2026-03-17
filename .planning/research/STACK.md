# Stack Research

**Domain:** Linux provisioning/dotfiles CLI toolkit (Bun/JavaScript)
**Researched:** 2026-03-18
**Confidence:** HIGH (core runtime/tooling verified via official sources), MEDIUM (library alternatives)

---

## Current Stack Assessment

The existing stack is already well-chosen for this domain. This document evaluates what to keep,
what to upgrade, and what gaps need filling — particularly around testing, cross-distro parity, and
the npm portability problem.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Bun | 1.3.x (1.3.9 current) | Runtime + test runner + package manager | Native TS, built-in test runner, fast spawn, no separate test dep needed. Bun.spawn is the right primitive for system provisioning — it's faster than Node child_process and handles stdio inheritance cleanly. |
| Commander.js | 14.x (14.0.2) | CLI argument/flag parsing | Most downloaded Node CLI arg parser (~70M weekly downloads). v14 adds option groups for help organization — directly useful for haoshoku's growing flag count. Requires Node 20+ (irrelevant since Bun runtime is used). |
| chalk | 5.x (5.6.2) | Terminal color output | ESM-native since v5. Used correctly in an ESM project (Bun). No reason to downgrade to v4. chalk is the reference implementation for terminal colors — more feature-complete than picocolors/kleur for complex formatting. |
| ora | 9.x (9.3.0) | Terminal spinner for long-running operations | ESM-native since v6. 55M+ weekly downloads. Used for package installs, git clones, AUR builds — exactly the slow async operations this CLI runs. |
| Biome | 2.x (2.3.11) | Lint + format (replaces ESLint + Prettier) | Single binary, 50-100x faster than ESLint+Prettier. Already in use. v2 adds type-aware linting without the TypeScript compiler — catches more bugs. Keep it. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| prompts | 2.4.2 | Interactive CLI prompts (select, confirm, text) | Keep for interactive flows. However, it has a known stdin drain issue (already worked around in utils.js). Acceptable as-is. |
| figlet | 1.9.4 | ASCII art banner | Keep. Used once at startup. No maintenance concern. |
| gradient-string | 3.0.0 | Gradient color text for banner | Keep. Purely cosmetic, zero risk. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `bun test` | Test runner | Built-in, no extra install. Supports `mock.module()`, `spyOn()`, `mock()`, `--preload` for test setup. As of Bun 1.1+, module mocking is stable and supports mocking the `"bun"` module itself via `mock.module("bun", ...)` — this is the path to testing spawn-heavy code. |
| `bunfig.toml` | Test configuration | Add `[test] preload = ["./tests/setup.ts"]` to preload spawn mocks before module imports. This is the correct pattern for testing CLI code that calls Bun.spawn. |
| Biome | Lint + format | `bun run lint` / `bun run format`. No tsconfig needed — Biome handles JS natively. |

---

## The npm Portability Problem

**Current state:** haoshoku imports `{ spawn } from "bun"` and `Bun.spawn` directly. When installed
globally via `npm install -g haoshoku`, the bin executes with the Node.js runtime, which cannot
resolve the `"bun"` module import. This is a hard blocker for npm portability.

**Options (in order of effort):**

1. **Wrap all Bun APIs behind a compatibility shim** — Create `src/common/process.js` that exports
   `spawn` by detecting runtime (`typeof Bun !== "undefined"`) and delegating to `child_process`
   on Node. Most Bun.spawn usage in haoshoku is fire-and-forget with stdio:inherit, which maps
   directly to Node `child_process.spawnSync` or `execSync`. **Recommended path.**

2. **Add a shebang enforcement** — Keep `#!/usr/bin/env bun` and document "requires Bun" clearly.
   Simplest, already done. Accept the limitation.

3. **Migrate to Node-compatible APIs only** — Drop `import { spawn } from "bun"`, use
   `node:child_process` throughout. Bun runs Node APIs natively. No portability issue. But loses
   Bun-specific optimizations (marginal for a setup script).

**Recommendation:** Option 3 is the cleanest long-term solution. `node:child_process.spawn` with
`stdio: 'inherit'` and `await` on `'close'` event behaves identically to Bun.spawn for haoshoku's
use case. This unblocks npm install without sacrificing anything meaningful.

---

## Testing Strategy

**The core testing problem:** haoshoku's business logic is almost entirely side effects — spawning
system commands, reading/writing files, cloning git repos. These are hard to unit test without
mocking the runtime itself.

**Recommended approach: Three-tier testing**

| Tier | What | How |
|------|------|-----|
| Unit | Pure functions (detectOS, parseOsRelease, path construction, config serialization) | bun:test directly, no mocks needed |
| Integration (mocked) | Spawn calls, file operations | `mock.module("bun", () => ({ spawn: mock(...) }))` in `--preload` setup. Mock `node:fs` for file write tests. |
| Smoke (real) | Full OS flow on the actual distro | Run manually or in a GitHub Actions self-hosted runner on CachyOS/Debian. Not automated in CI. |

**Key: Dependency injection pattern for testability.** Currently `runCommand` is called directly from
OS scripts. If `runCommand` is passed as a parameter (or imported from a mockable module path),
tests can swap it out without touching the spawn mock directly. This is lower-friction than trying
to mock the `"bun"` module itself.

Example refactor that unlocks testing:

```js
// src/common/runner.js — mockable seam
export const runner = {
  run: runCommand,  // points to real implementation
};

// In tests:
mock.module("../common/runner.js", () => ({
  runner: { run: mock(async () => true) }
}));
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Commander.js | yargs | yargs is better for complex subcommand CLIs with deep nesting (e.g., git-style). haoshoku is flat flags, so Commander's simpler API wins. |
| Commander.js | @oclif/core | oclif is plugin-based and suited for large multi-command CLIs distributed as npm orgs. Overkill here. |
| prompts | @clack/prompts | @clack/prompts has a more polished UX (grouped steps, progress indicators). Use if adding a guided setup wizard flow. For the current flag-based model, prompts is sufficient. |
| prompts | @inquirer/prompts | Actively maintained Inquirer rewrite. Better maintained than the legacy `prompts` package. Worth considering if prompts causes future issues (stdin drain bug is a known problem). |
| ora | nanospinner | Use nanospinner if bundle size matters. For a provisioning CLI that isn't bundled for the browser, ora's extra features (persistent text, promise wrapping) are worth keeping. |
| Biome | ESLint + Prettier | Use ESLint if you need community plugins (e.g., security rules, import ordering with eslint-import-resolver). Biome is correct for a pure JS/TS CLI project. |
| bun:test | vitest | Use vitest if the project migrates to a Node-compatible runtime. bun:test is faster and has no config overhead when already using Bun. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `Bun.spawnSync` | Blocks the event loop; problematic for long-running commands (AUR builds, large downloads). Already causes the npm portability issue. | `Bun.spawn` (async) or `node:child_process` |
| `enquirer` | Unmaintained since 2021. No ESM support. | `prompts` (current) or `@clack/prompts` |
| Legacy `inquirer` (v8 and below) | CommonJS-only, unmaintained. | `@inquirer/prompts` if switching prompt libraries |
| `shelljs` | Synchronous by design, slow, wraps everything in a shell. Adds complexity vs direct spawn. | `node:child_process` or Bun.spawn |
| `execa` | Excellent library, but adds a dep for something Bun.spawn already handles. | Bun.spawn / node:child_process |
| Auto-mocking (`__mocks__/`) | Not supported in bun:test as of 1.3.x. Will silently fail. | `mock.module()` with `--preload` |

---

## Stack Patterns by Variant

**If adding a guided interactive setup wizard (no flags, step-by-step):**
- Replace `prompts` with `@clack/prompts`
- Its grouped step API (`group()`, `tasks()`) maps directly to haoshoku's provision phases
- Significantly better UX than raw confirm/select loops

**If migrating to Node-compatible runtime for npm portability:**
- Replace `import { spawn } from "bun"` with `import { spawn } from "node:child_process"`
- Replace `Bun.spawn` with node:child_process equivalents
- Keep all other deps — they are runtime-agnostic
- bun:test continues to work (Bun runs node: APIs natively)

**If adding CI test coverage for provisioning logic:**
- Add `bunfig.toml` with `[test] preload = ["./tests/mocks/setup.js"]`
- The setup file mocks `"bun"` module's spawn, and `"node:fs"` write operations
- Enables testing haoshoku's orchestration logic without running real system commands

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| chalk@5.6.2 | Bun 1.3.x (ESM) | ESM-only, works correctly with `"type": "module"` in package.json. Incompatible with CJS require(). |
| commander@14.0.2 | Bun 1.3.x | Dual ESM/CJS. No compatibility issues. |
| ora@9.0.0 | Bun 1.3.x | ESM-only since v6. Works in Bun ESM context. |
| @biomejs/biome@2.3.11 | Any | Native binary, runtime-agnostic. |
| prompts@2.4.2 | Bun 1.3.x | CJS package. Bun handles CJS interop. Known stdin drain issue after subprocess runs — already mitigated with `drainStdin()` in utils.js. |

---

## Installation

```bash
# Current deps (already installed)
bun add chalk commander figlet gradient-string ora prompts

# Dev
bun add -D @biomejs/biome

# If switching to @clack/prompts (optional upgrade)
bun remove prompts
bun add @clack/prompts

# If adding @inquirer/prompts (alternative to prompts)
bun remove prompts
bun add @inquirer/prompts
```

---

## Sources

- [Bun 1.3.9 release notes](https://endoflife.date/bun) — current stable version confirmed (HIGH confidence)
- [Bun test mocking docs](https://bun.sh/docs/test/mocks) — `mock.module()`, `spyOn()`, preload pattern (HIGH confidence)
- [Commander.js changelog](https://github.com/tj/commander.js/blob/master/CHANGELOG.md) — v14 features, Node 20 requirement (HIGH confidence)
- [ora npm](https://www.npmjs.com/package/ora) — v9.3.0 current, ESM since v6 (HIGH confidence)
- [@biomejs/biome v2 announcement](https://biomejs.dev/blog/biome-v2/) — v2.3.11 current, type-aware linting (HIGH confidence)
- [nanospinner vs ora comparison](https://npmtrends.com) — download trends, feature comparison (MEDIUM confidence)
- [prompts stdin drain issue](https://github.com/terkelg/prompts/issues) — known issue, already mitigated in codebase (MEDIUM confidence)
- [Bun Node.js compatibility](https://bun.com/docs/runtime/nodejs-compat) — node:child_process compatibility (HIGH confidence)

---

*Stack research for: Haoshoku — Linux provisioning/dotfiles CLI toolkit*
*Researched: 2026-03-18*
