# Pitfalls Research

**Domain:** Linux setup/dotfiles provisioning toolkit (multi-distro, Bun/JS)
**Researched:** 2026-03-18
**Confidence:** HIGH — based on direct code audit + community knowledge

---

## Critical Pitfalls

### Pitfall 1: Hardcoded "main" Branch in git fetch/reset

**What goes wrong:**
`updateRepo()` in `skill_manager.js` runs `git fetch origin main` and `git reset --hard origin/main`. If a skill repo uses `master`, `trunk`, or any other default branch name, the fetch silently fails and the stale cache is kept — no skill update, no error loud enough to act on.

**Why it happens:**
The GitHub default changed to `main` years ago, but older repos, self-hosted repos, and community repos may still use `master`. The code was written for a personal repo where the branch was known.

**How to avoid:**
Detect the default branch dynamically before fetch:
```js
const headResult = Bun.spawnSync(["git", "remote", "show", "origin"], { cwd: repoPath });
// parse HEAD branch from output, fallback to "main"
```
Or use `git fetch origin` (no branch arg) followed by `git reset --hard FETCH_HEAD` — this follows whatever the remote default is.

**Warning signs:**
- `--skills-update` reports success but skills are clearly stale
- `git log` on a cached repo shows the same commit after repeated updates
- Error message "couldn't find remote ref main" in stderr (currently swallowed)

**Phase to address:** Skill manager robustness phase / current milestone fix

---

### Pitfall 2: Bun.spawnSync / Bun.spawn Leaking into Published npm Package

**What goes wrong:**
The package is published to npm as `haoshoku` but requires Bun runtime. Any user who installs via `npm install -g haoshoku` and runs via Node.js gets an immediate `Bun is not defined` crash. The README shows both install methods as equivalent, which is misleading.

**Why it happens:**
Bun's built-in `Bun.spawnSync` and `import { spawn } from "bun"` are runtime globals with no Node.js polyfill. The code migrated from Python to JS/Bun (v2.3.0) without accounting for npm consumers.

**How to avoid:**
Two mutually exclusive strategies:
1. **Dual shebang + Node compat**: Replace `Bun.spawnSync` with `child_process.spawnSync` from Node's stdlib (available in Bun too). Replace `import { spawn } from "bun"` with `import { spawn } from "child_process"` via Node compat. This unblocks npm global install.
2. **Bun-only honest packaging**: Remove the `npm install -g` path from documentation. Add `engines: { bun: ">=1.0.0" }` to `package.json`. Make the shebang `#!/usr/bin/env bun` the canonical contract.

Mixing the two approaches (publish to npm, require Bun) is the worst of both worlds.

**Warning signs:**
- `package.json` has no `engines` field restricting to Bun
- README shows `npm install -g haoshoku` without a Bun prerequisite warning
- `configure_claude.js` uses `Bun.spawnSync` directly (not via a wrapper)

**Phase to address:** Runtime portability / npm compat milestone

---

### Pitfall 3: Fish Shell PPA is Ubuntu-Specific — Fails on Plain Debian

**What goes wrong:**
`debian_server.js` tries `add-apt-repository ppa:fish-shell/release-3` on Debian systems. PPAs are a Launchpad/Ubuntu mechanism. On plain Debian, `add-apt-repository` either doesn't exist or cannot resolve Launchpad URLs. The code falls back to `apt install fish` from default repos, which ships Fish 3.x on Debian 12 but will be outdated or absent on older Debian.

**Why it happens:**
The PPA approach was copy-adapted from Ubuntu knowledge without verifying Debian compatibility. Fish 4.x ships for Debian via the openSUSE Build Service, not Launchpad.

**How to avoid:**
Detect whether the distro is Ubuntu vs Debian from `/etc/os-release` (`ID=ubuntu` vs `ID=debian`). For Debian, use the openSUSE Build Service repo:
```bash
echo 'deb http://download.opensuse.org/repositories/shells:/fish:/release:/4/Debian_12/ /' \
  | sudo tee /etc/apt/sources.list.d/shells:fish:release:4.list
curl -fsSL https://download.opensuse.org/repositories/shells:fish:release:4/Debian_12/Release.key \
  | gpg --dearmor | sudo tee /etc/apt/trusted.gpg.d/shells_fish_release_4.gpg > /dev/null
sudo apt update && sudo apt install fish
```

**Warning signs:**
- `add-apt-repository` exits non-zero on Debian (check logs)
- Fish installed is version 3.x when 4.x was expected
- `software-properties-common` install fails (often absent on minimal Debian)

**Phase to address:** Debian flow parity milestone

---

### Pitfall 4: Debian Flow Missing git config Step

**What goes wrong:**
`runCachyOSSetup()` calls `configureGit()` (prompted). `runDebianServerSetup()` does not. A freshly provisioned Debian server has no global `user.email`/`user.name`, causing every `git commit` to fail or use system defaults.

**Why it happens:**
The Debian flow was built for server hardening first (SSH, UFW, fail2ban, Docker) and developer tooling was added later without full parity review.

**How to avoid:**
Add a `configureGit()` call (behind the same prompt) to `runDebianServerSetup()`. Also audit what other CachyOS-only steps are developer-relevant and whether they belong in a shared "dev environment" module.

**Warning signs:**
- `git commit` on Debian server shows "Please tell me who you are" error
- CachyOS and Debian flows diverge in tested features list
- No test coverage for `runDebianServerSetup()` calling `configureGit`

**Phase to address:** Debian flow parity milestone

---

### Pitfall 5: curl | bash Installer Pattern — Silent Failures and Security Surface

**What goes wrong:**
Multiple curl-pipe-bash patterns are used: `curl -fsSL https://sh.rustup.rs | sh`, `curl -fsSL https://get.docker.com | sh`, NodeSource's `curl -fsSL ... | sudo bash -`, and the Claude Code installer. If the upstream URL serves a 404 or a CDN error page, bash silently executes the error HTML. The `-f` flag in curl causes it to exit non-zero on HTTP errors, but several invocations use curl flags that don't guarantee safe failure.

**Why it happens:**
curl-pipe-bash is the de facto installer pattern for open-source tools. It's convenient but trades safety for simplicity.

**How to avoid:**
- Verify the curl exit code independently from bash; use `set -e` or check `$?` after each pipe step
- Download installer to a temp file, optionally inspect, then execute — avoids partial-download execution
- Add `--fail-with-body` to curl so non-200 responses are distinguishable
- Log the URL and expected behavior before executing so failure is diagnosable

**Warning signs:**
- Setup completes with "success" but rustup/Docker isn't actually installed
- Installer page returns a 301/redirect that bash then executes as shell commands
- Network outage during setup produces undiagnosable failures mid-script

**Phase to address:** Reliability / error handling milestone

---

### Pitfall 6: No Dry-Run Mode — Destructive Operations Run Without Preview

**What goes wrong:**
Running `haoshoku` without `--dry-run` immediately begins installing packages, writing config files, adding PPA repos, and modifying `/etc/fail2ban/jail.local`. On an existing, partially-configured machine, this can overwrite configs the user has customized. On a misidentified OS (auto-detection via `/etc/os-release`), the wrong flow runs entirely.

**Why it happens:**
The project was built for fresh-machine provisioning where destructive writes are expected. The standalone flag architecture (`--claude`, `--skills`, etc.) partially mitigates this, but the full OS flows have no preview mode.

**How to avoid:**
Implement a `--dry-run` flag that replaces all file writes and shell command executions with log output. The `runCommand` wrapper is the single chokepoint — gating it on `options.dryRun` is low-effort and high-value. Similarly, wrap `fs.copyFileSync`, `fs.writeFileSync`, and symlink operations.

**Warning signs:**
- Users running haoshoku on existing machines report config overwrite surprise
- No way to audit what the script would do before committing
- OS auto-detection mismatch (e.g., Ubuntu detected as debian-server) triggers the wrong packages

**Phase to address:** Safety / dry-run milestone

---

### Pitfall 7: syncSkills Exits process.exit(1) When All Sources Fail — Blocks Subsequent Steps

**What goes wrong:**
When `syncSkills()` fails to clone/pull all sources (network down, auth failure, invalid URL), it calls `process.exit(1)`. If `syncSkills` is called mid-setup (e.g., from `--claude` flow or end of OS setup), the entire provisioning is aborted with no cleanup and no indication of what succeeded.

**Why it happens:**
The `process.exit` was added for clear CLI exit codes, which is correct for standalone `--skills` invocations. But `syncSkills` is also called as a subroutine inside larger flows where exit is inappropriate.

**How to avoid:**
Separate the "fail loudly" exit-code contract from the "return error" contract. Make `syncSkills` return a status object `{ succeeded: number, failed: string[] }` and let callers decide whether to abort. Reserve `process.exit` for the top-level CLI handler.

**Warning signs:**
- Debian server setup completes package installs but aborts before Claude config
- Error log shows "All skill sources failed to sync" but no partial success summary
- No test for the flow where skills fail inside the OS setup chain

**Phase to address:** Error handling / resilience milestone

---

### Pitfall 8: NodeSource Setup Script Is Deprecated

**What goes wrong:**
`installNodejs()` in `debian_server.js` uses `curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo bash -`. NodeSource's installation scripts are officially deprecated as of 2023–2024. The scripts may install wrong versions (e.g., 16.x setup installing 18.x) or fail with GPG key errors on newer Debian releases.

**Why it happens:**
The NodeSource pipe-bash method was the standard approach for years. The deprecation was not widely announced and the old script URLs still work, making the failure non-obvious until the wrong Node version lands.

**How to avoid:**
Use the NodeSource manual repository method (which remains supported) or switch to `nvm` / `fnm` for user-space Node management. The recommended replacement per NodeSource docs:
```bash
apt-get install -y nodejs  # after adding the deb repo manually
```
Or use `fnm` (fast Node manager) which is what the Fish shell plugin `nvm.fish` expects anyway.

**Warning signs:**
- `node --version` shows unexpected LTS version after install
- GPG key verification error during `apt install nodejs`
- NodeSource GitHub issue tracker shows multiple "deprecated" labels on the setup scripts

**Phase to address:** Debian flow parity / dependency modernization milestone

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `Bun.spawnSync` directly in helper modules (not wrapped) | Simple, native API | Blocks Node compat, testing is harder | Only if Bun-only is the documented contract |
| Hardcoded `"main"` branch in git operations | Works for personal repos | Silent update failures on `master`/`trunk` repos | Never — dynamic detection is 3 lines |
| `process.exit(1)` inside library functions | Clear exit codes | Kills parent process, untestable as unit | Only in CLI entry point handlers |
| curl-pipe-bash for tool installers | Matches upstream install docs | Silent failures, security surface | Acceptable short-term; wrap with error detection |
| Fish PPA from Launchpad on all Debian-like systems | One code path | Fails on plain Debian silently | Never — distro check is cheap |
| Skipping git config in Debian flow | Shorter setup script | git unusable post-provision | Never if developer environment is the goal |
| No dry-run in full OS flows | Simpler code | Dangerous on existing machines | Never for a tool claiming npm publishability |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Fish shell (Debian) | Using Ubuntu PPA on plain Debian | Check `ID` in `/etc/os-release`; use openSUSE Build Service for Debian |
| NodeSource Node.js | Pipe-bash setup script (deprecated) | Manual deb repo add or switch to `fnm` |
| Claude Code installer | `curl -fsSL https://claude.ai/install.sh` — undocumented, may change | Verify URL is still canonical; check exit code; add version pin |
| GSD via `npx get-shit-done-cc@latest` | `@latest` always re-fetches; no reproducibility | Consider pinning version or adding a version check |
| ssh-agent in git config setup | Starting agent via `Bun.spawn` sets `SSH_AUTH_SOCK` in Node process env but not in the user's shell session | Document that users need to start `ssh-agent` in their shell; the JS process env change is invisible post-exit |
| git `includeIf "gitdir:..."` | Path must end with `/` for directory matching; missing slash = no match | Already correct in code; add a test/validation step |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Installing packages one-by-one from file list | Setup takes 20+ minutes on slow connections | Batch install with a single `paru -S $(cat list) --noconfirm` call | Every run — `installPackagesFromFile` loops package-by-package |
| Shallow clone then `git fetch origin main` | Shallow fetch of wrong branch causes unnecessary network round-trip | Use `git fetch origin` without branch arg then `git reset --hard FETCH_HEAD` | On every `--skills-update` for non-main repos |
| Fisher plugin install one-by-one via `fish -c "fisher install ..."` | Each invocation starts a new Fish process; slow on minimal systems | Use `fisher install plugin1 plugin2 plugin3` in one call | Each setup run |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| `curl URL \| sudo bash` for Docker installer | Full root code execution from remote URL | Download to temp file, inspect, then execute; use Docker's apt repo instead |
| `ssh-keygen ... -N ""` (no passphrase) | SSH key unprotected at rest | Prompt for passphrase or document the tradeoff explicitly |
| Writing `fail2ban/jail.local` to `/tmp` first then `sudo mv` | `/tmp` is world-writable; another process could replace the file in the window | Use `sudo tee` or write directly via a subprocess with elevated permissions |
| `configs/claude/claude.json` in version control | May contain API keys or session tokens | `.gitignore` must cover this; the backup command should warn if sensitive content detected |
| Fish config deployed with hardcoded paths (`$HOME`) | Paths break for different users | Use `$HOME` env var or `~` in configs, not hardcoded `/home/username` |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No progress indication during long package installs | User doesn't know if hung or running | `withSpinner` already used — extend it to all long-running batch operations |
| `"ACTION REQUIRED"` warning at end of git config buried in success logs | User misses it, SSH keys never added to GitHub | Print a distinct, boxed post-setup checklist at the very end |
| Skills sync runs silently when 0 sources configured | User runs `--skills`, sees "Merged 0 skills" — doesn't know why | Detect empty `skillSources` array and print onboarding instructions |
| Sudo prompt appears mid-script after other output | User not watching, script stalls | Call `sudo -v` (already done in CachyOS) at start of every flow that needs sudo |
| Debian flow has fewer prompts — feels less complete | Users expect feature parity | Add the same prompts for git config, KDE-equivalent choices on Debian |
| No post-run summary | User doesn't know what succeeded vs skipped | Print a summary table at end of full OS flow |

---

## "Looks Done But Isn't" Checklist

- [ ] **Skills sync:** Runs without error but repos use `master` — verify with `git branch -a` in cache dir
- [ ] **Fish as default shell:** `chsh` succeeds in script but `$SHELL` still shows `/bin/bash` until re-login — inform user explicitly
- [ ] **Docker group membership:** `usermod -aG docker $USER` applied but effective only after logout — script warns, but user often ignores
- [ ] **ssh-agent:** Started within JS process, keys added — but `SSH_AUTH_SOCK` not propagated to user's new terminal sessions
- [ ] **git config include paths:** Created at `~/personal/.gitconfig.personal` — but only applies to repos inside `~/personal/`; any repo elsewhere has no identity
- [ ] **Fail2ban:** Config written and service restarted — but `fail2ban-client status sshd` should be run to confirm it's actually monitoring
- [ ] **UFW enabled:** `ufw enable` run but `ufw status` should confirm rules are active and SSH port is open before enabling (risk of locking self out)
- [ ] **NodeSource Node.js:** Install appears to succeed — but `node --version` may show wrong version; add a version check assertion after install
- [ ] **Bun runtime check:** Package published to npm — but no `engines` field; `npm install -g haoshoku` gives no warning before runtime crash

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Wrong branch in git fetch | LOW | `cd ~/.cache/haoshoku/<repo>; git fetch origin; git reset --hard FETCH_HEAD` |
| npm install + Node runtime crash | LOW | `bun install -g haoshoku` instead; fix documentation |
| Fish PPA failed on Debian | LOW | Add openSUSE Build Service repo manually, `apt install fish` |
| process.exit mid-provisioning | MEDIUM | Rerun haoshoku; idempotent checks (commandExists) prevent double-installs for most steps |
| NodeSource wrong Node version | MEDIUM | `apt remove nodejs`, add correct deb repo manually, reinstall |
| UFW locked out SSH | HIGH | Requires console/VNC access to server; `sudo ufw disable` then re-add ssh rule before re-enable |
| Config overwrite (no dry-run) | HIGH | Restore from backup (--claude-backup / --zed-backup); no automated rollback exists yet |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Hardcoded "main" branch | Skill manager robustness | Run `--skills-update` against a repo with `master` branch; confirm update succeeds |
| Bun.spawnSync npm portability | Runtime compat milestone | Run `node haoshoku.js --help` without Bun; confirm no crash |
| Fish PPA on plain Debian | Debian flow parity | Run Debian flow on a `debian:12` Docker container; confirm Fish installs |
| Missing git config in Debian | Debian flow parity | Run Debian flow; confirm `~/.gitconfig` exists with user identity |
| curl-pipe-bash silent failures | Reliability / error handling | Simulate 404 from installer URLs; confirm error is logged and exit code non-zero |
| No dry-run mode | Safety milestone | `haoshoku --dry-run --os debian-server`; confirm no filesystem changes |
| process.exit in library function | Error handling / resilience | Unit test `syncSkills` with all sources invalid; confirm returns error vs exits |
| NodeSource deprecation | Debian dependency modernization | Install Debian flow in clean VM; confirm correct Node LTS version installed |

---

## Sources

- Direct code audit: `src/os_scripts/debian_server.js`, `src/helpers/skill_manager.js`, `src/common/utils.js`, `src/helpers/configure_claude.js`, `src/helpers/configure_git.js`
- Project context: `.planning/PROJECT.md`, `CHANGELOG.md`
- NodeSource deprecation: https://github.com/nodesource/distributions/discussions/1639
- Fish shell on Debian: https://tracker.debian.org/pkg/fish — openSUSE Build Service for Debian packages
- Fish shell Ubuntu PPA: https://launchpad.net/~fish-shell/+archive/ubuntu/release-4
- Bun Node.js compatibility: https://bun.com/docs/runtime/nodejs-compat
- curl-pipe-bash security: https://lukespademan.com/blog/the-dangers-of-curlbash/ and https://www.lesinskis.com/dont-pipe-curl-into-bash.html
- Idempotency in shell scripts: https://arslan.io/2019/07/03/how-to-write-idempotent-bash-scripts/
- Milestone context: Known issues listed in `milestone_context` (Bun portability, Fish PPA, main branch, Debian gaps, no dry-run)

---
*Pitfalls research for: Linux setup/dotfiles provisioning toolkit (Haoshoku)*
*Researched: 2026-03-18*
