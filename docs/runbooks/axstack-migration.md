# Axstack migration runbook

Migration guidance aligned with [the approved T3 Code replacement](https://github.com/axatbhardwaj/Haoshoku/issues/104), [setup reconciliation #63](https://github.com/axatbhardwaj/Haoshoku/issues/63) and its Claude/Codex M1–M3 addendum. This is not a record of completed host migration. The repository change does not authorize live-host mutation. If host rollout is separately approved, complete release verification and per-host checks below, then execute IO before VPS.

## Release and execution gate

The later instruction to complete the work and release authorizes the owning T3
driver to complete the GitHub/npm/Linux binary release after the merged T1–T7 changes.
It supersedes the historical human-only merge and no-release gates in the
[frozen specification](../specs/2026-10-07-setup-reconciliation-r2.md) and
[dated plan](../plans/2026-10-07-setup-reconciliation.md). Preserve those historical
bodies and approvals. This authority still excludes live-host installation,
migration, configuration, credentials and integration changes.

At the 2026-10-08 release-preparation snapshot, all seven reviewed source PRs are merged:
[PR130](https://github.com/axatbhardwaj/Haoshoku/pull/130),
[PR132](https://github.com/axatbhardwaj/Haoshoku/pull/132),
[PR134](https://github.com/axatbhardwaj/Haoshoku/pull/134),
[PR135](https://github.com/axatbhardwaj/Haoshoku/pull/135),
[PR136](https://github.com/axatbhardwaj/Haoshoku/pull/136),
[PR137](https://github.com/axatbhardwaj/Haoshoku/pull/137) and
[PR138](https://github.com/axatbhardwaj/Haoshoku/pull/138).
The merged changes are prepared as 12.3.0. At this dated snapshot, tag, npm and
Linux binary publication and verification remain pending with the driver.
This is source-release guidance, not proof of publication or host migration.
The driver must verify actual published bytes before claiming release completion.

At the same snapshot, [#65](https://github.com/axatbhardwaj/Haoshoku/issues/65) and
[#66](https://github.com/axatbhardwaj/Haoshoku/issues/66) are closed as completed.
[#63](https://github.com/axatbhardwaj/Haoshoku/issues/63) remains open pending
release and deferred host work. [#67](https://github.com/axatbhardwaj/Haoshoku/issues/67) and
[#68](https://github.com/axatbhardwaj/Haoshoku/issues/68) remain open and deferred
for separately authorized host work. Closed
[#64](https://github.com/axatbhardwaj/Haoshoku/issues/64), merged
[PR69](https://github.com/axatbhardwaj/Haoshoku/pull/69), and closed
[axstack#19](https://github.com/axatbhardwaj/axstack/issues/19) are historical source
evidence, not live-host proof. Superseded
[PR86](https://github.com/axatbhardwaj/Haoshoku/pull/86) is closed;
obsolete [PR72](https://github.com/axatbhardwaj/Haoshoku/pull/72) is closed unmerged
and linked to its merged replacement PR136. These dated tracker states do not
establish live installation, authentication or tool discovery.

For future authorized migration, record the reviewed merged commits and actual
release artifacts separately. Resolve npm latest once, retain the exact selected
Axstack name, version, tarball URL and `dist.integrity`, and verify the downloaded
bytes with SHA-512 before extraction or execution. Historical Axstack 0.5.0 and
its SHA-256 are discovery evidence, not a current release pin. Revalidate the
selected package's CLI help and required owned-instruction support.

One driver on IO coordinates the run. One executor mutates a host at a time. Record its session, host and item list privately. Never run the complete OS setup as a shortcut for this migration: unrelated desktop and service operations are outside the task.

Do not proceed if the required release is unavailable, downloaded bytes differ, the intended host is ambiguous, the target contains conflicting ownership, or dependent active work cannot tolerate retirement. Continue safe checks on independent items and report the held item explicitly.

### Select and verify the exact npm tarball

Run this preparation recipe in Bash with Python 3, npm and curl available. It
downloads and verifies a package; it does not install or execute that package.
Keep the private selection record and tarball together for later review.

```bash
set -euo pipefail
umask 077
AXSTACK_RELEASE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/axstack-release.XXXXXXXX")
export AXSTACK_RELEASE_DIR
# This is the only latest lookup in this recipe.
npm view axstack@latest name version dist --json > "$AXSTACK_RELEASE_DIR/selected.json"
python3 - "$AXSTACK_RELEASE_DIR" <<'PY'
import base64, json, pathlib, re, sys, urllib.parse
root = pathlib.Path(sys.argv[1])
m = json.loads((root / "selected.json").read_text())
url = urllib.parse.urlsplit(m["dist"]["tarball"])
integrity = m["dist"]["integrity"]
if (m["name"] != "axstack"
    or not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?", m["version"])
    or url.scheme != "https" or url.hostname != "registry.npmjs.org"
    or url.username or url.password or url.query or url.fragment
    or not re.fullmatch(r"sha512-[A-Za-z0-9+/]{86}==", integrity)):
    raise SystemExit("Unsupported release metadata; stop before download")
digest = base64.b64decode(integrity[7:], validate=True)
if len(digest) != 64 or base64.b64encode(digest).decode() != integrity[7:]:
    raise SystemExit("Invalid SHA-512 integrity")
(root / "tarball-url").write_text(m["dist"]["tarball"])
PY
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
  "$(cat "$AXSTACK_RELEASE_DIR/tarball-url")" --output "$AXSTACK_RELEASE_DIR/axstack.tgz"
python3 - "$AXSTACK_RELEASE_DIR" <<'PY'
import base64, hashlib, hmac, json, pathlib, sys, tarfile
root = pathlib.Path(sys.argv[1])
m = json.loads((root / "selected.json").read_text())
archive = root / "axstack.tgz"
actual = "sha512-" + base64.b64encode(hashlib.sha512(archive.read_bytes()).digest()).decode()
if not hmac.compare_digest(actual, m["dist"]["integrity"]):
    raise SystemExit("Tarball integrity mismatch; do not extract or execute")
# Read identity without extracting or running package code.
with tarfile.open(archive, "r:gz") as package:
    manifests = [e for e in package.getmembers() if e.name == "package/package.json"]
    if len(manifests) != 1 or not manifests[0].isfile() or manifests[0].size > 1048576:
        raise SystemExit("Unsupported package manifest")
    identity = json.load(package.extractfile(manifests[0]))
if (identity.get("name"), identity.get("version")) != (m["name"], m["version"]):
    raise SystemExit("Selected and downloaded package identity differ")
record = {"name": m["name"], "version": m["version"],
          "tarball": m["dist"]["tarball"], "dist.integrity": m["dist"]["integrity"],
          "downloadedIntegrity": actual, "archive": str(archive.resolve())}
with (root / "verified.json").open("x") as output:
    json.dump(record, output, indent=2)
    output.write("\n")
print("Verified selected tarball; retain", root / "verified.json")
PY
```

Stop on any failure. Never substitute a later `latest`, a different tarball or
an existing cached release directory for this record. Recheck these exact bytes
before any later extraction. A successful hash comparison proves consistency
with the selected registry metadata, not independent review or live behavior.
Review the selected version and CLI contract before authorized execution.

Normal `haoshoku --axstack` resolves latest once per invocation and verifies a
new download internally. It can keep an existing version/release directory;
that path does not re-download and re-verify its installed bytes. It is not a
pinned continuation of this recipe. If it is used in a separate authorized run,
capture that invocation's actual selection and installed-byte evidence afresh.
For migration tied to this record, use the retained archive and the absolute
CLI/bundle paths of that exact verified package for subsequent `--help`,
`--version`, `check` and approved `install --harness claude|codex` commands.
Do not use an unverified PATH shim or run another latest install between them.

## Private evidence and recovery bundle

Use a new private run directory on each host, with access restricted to its owner. Record configuration values only as needed for restoration; never paste credentials, prompts, session records or full configuration into issues, logs or screenshots.

Before each change, preserve exact relevant bytes, permissions, link destinations, installed package identity, manifest bindings and service/schedule state. Backups that contain credentials remain private. Capture hashes and existence for protected files so before/after comparisons do not expose their content. Record absence too, so rollback can distinguish a newly created artifact.

| Field | Required content |
| --- | --- |
| Item | Exact path, unit instance or schedule identity, kept privately |
| Role | Agreed retired role, retained prerequisite, or unknown |
| Provenance | Shipped-byte match, exact installation receipt, or unit plus verified helper-byte match |
| Current state | Existence, enabled/active state, relevant consumers and ownership binding |
| Replacement | Installed feature and its verification evidence |
| Disposition | Preserve, retire, or hold with a reason |
| Recovery | Backup reference and bounded restoration action |
| Executor | Actual session and host |
| Result | Before/after checks, remaining dependencies and limitations |

Names or markers alone do not prove ownership. A retained T3 Code unit can be Haoshoku-owned and must still be retained. A failed provenance or dependency check leaves the item intact and its retirement incomplete.

## Inventory before changing anything

1. Verify host identity and CLI paths/versions for Axstack, Claude Code, Codex, T3 Code, Bun and gh/gh-stack. Resolve wrappers to their package location without executing installation or exposing environment files.
2. Inspect each existing Axstack manifest and its profile-file binding. Retain an existing shared-directory binding; do not pass the same profile file to an installation in another skills root. Preserve independently managed OpenCode targets.
3. Inventory Claude/Codex instruction files, skill roots, old task/theme configuration and installed legacy helpers. Check independently installed skills separately; Haoshoku no longer installs Matt Pocock skills or visual-explainer. Normal and repeated setup leaves skill directories and links intact; any removal requires separate host-migration authority.
4. Inventory exact user/system service instances, enabled state and consumers. Template presence is not an active instance. Keep the T3 Code runtime and phone connectivity.
5. Inventory existing legacy schedules through their supported runtime interface before manual retirement. Haoshoku no longer manages task lifecycle or schedule mappings. Preserve schedules unless positive evidence establishes approved legacy ownership.
6. Inventory AI-only desktop/editor entries and extra applications. Mixed files and independently installed applications are not removed wholesale. Keep unrelated desktop behavior and necessary T3 Code access.

The preparation snapshot found IO's Claude Remote Control and stay-awake unit bytes matching bundled templates. It found three mapped VPS schedules among eight active schedules, and unverified system Claude services. These are historical findings to recheck, not permanent allowlists.

## Install and verify replacement

After separate host authorization, use the selected verified Axstack package
with explicit Claude and Codex targets as described above. Preserve
user-managed/newer installations and existing model choices; do not force
adoption or downgrade. Keep the package name, version, tarball URL and SHA-512
record bound to all execution and installed-byte evidence.

Verify the installed release identity and package bytes. Run `axstack check` for prerequisites, then separately prove skill discovery from the selected harnesses. Verify that each instruction pointer resolves to the installed Axstack entry and that the model/profile choices have not been replaced by stale defaults.

Axstack must preserve text outside its owned instruction block. Existing unmarked routing prose remains unowned: archive and replace only a verified legacy section as an explicit migration action. Personal preferences stay byte-identical. Duplicate/malformed markers or edited/unknown blocks hold conversion; never use force as a generic migration fix.

T3 Code owns orchestration; Haoshoku no longer supplies model-routing profiles. Existing legacy host configuration remains intact, as listed in the [migration note](../../README.md#existing-host-migration). For any separately approved manual configuration change, use the runtime's documented activation path and verify live readback. Preserve active agents. If activation requires a disruptive restart, record deferred activation and hold dependent cleanup; file installation alone is not success.

## Retire verified legacy items

Only proceed after replacement checks pass for the affected capability.

- **Skills and configuration:** archive positively identified legacy entries outside every active discovery root. Remove only verified managed links. Preserve independently installed specialist skills, credentials, sessions and unrelated instructions. Do not wipe `.agents`, `.claude`, `.codex` or other runtime data roots.
- **Services:** verify the exact instance and current consumer graph. Stop the approved legacy instance, disable future activation, archive its verified unit/helper/settings, reload the relevant service manager and read back inactive/disabled or absent state. Never stop the driver transport or required T3 Code runtime. Shared binaries/user data remain unless separately proven safe and in scope.
- **Schedules:** verify exact object identity, legacy purpose and lack of current dependencies. Save a private restorable definition, pause the schedule, verify it is paused, then retire it only when restoration and consumer checks are complete. Preserve unmapped/custom schedules. Do not use a name match or delete/recreate unrelated objects.
- **Desktop/editor integration:** apply narrow approved entry removal, preserving general files and bindings. Load the installed `omarchy` skill instructions before live desktop customization; if unavailable, hold that desktop step. Recheck affected behavior; no desktop restart merely to simplify evidence collection.

Hermes stays on Debian for Telegram transport through `hermes send`, as specified in [the approved T3 migration](https://github.com/axatbhardwaj/Haoshoku/issues/104). Haoshoku checks its existing private Telegram configuration and running gateway without deploying a relay plugin or changing existing plugin data and relay markers. T3 Code is the retained orchestration runtime. Follow the [single-backend preflight](../../README.md#t3-single-backend-preflight) before its service setup. Verify its service, Tailscale HTTPS route, and desktop/phone pairing before retiring legacy access. Unknown system Claude services remain intact until positive provenance establishes that they are in scope.

The current retirement selection is Matt Pocock skills, visual-explainer, Claude
Remote Control, stay-awake and PR watch. Their future installer routes are
retired; reruns do not remove live copies. The broader September removal list
is superseded: retain Claude/Codex, Axstack, Git/gh/gh-stack, shared instructions
and unrelated desktop/editor setup, as well as T3 and Hermes. Do not use the old
list to expand a host migration.

For [tailnet-only SSH](../../README.md#debian-tailnet-ssh-firewall), verify running
Tailscale, reported addresses and `tailscale0` before firewall changes. Existing
public SSH rules remain intact and make hardening incomplete until a separately
authorized operator migration. Repository fixtures prove ordering and failure
propagation, not live Debian compatibility or a safe public-SSH cutover.

[Executor server setup](../../README.md#opt-in-executor-server) is opt-in and
separate from [Claude/Codex client registration](../../README.md#opt-in-executor-clients).
Provision Docker/Compose and external DNS/TLS/nginx first. The server preserves
manual/conflicting deployments and checks matching managed reruns read-only.
Its loopback/public health and OAuth metadata verification has at most five
attempts (four retries), not authenticated integration proof. Owner, account,
API-key, policy, integration and OAuth onboarding stay manual. Client setup
writes only auth environment references in the intended ordinary user's effective
homes; future T3 processes must inherit those homes and the complete Bearer value.
Offline native readback is proven for Claude 2.1.292 and Codex 0.160.1; live
authentication, tool discovery and T3 inheritance still require separate proof.

## Failure and recovery

If replacement fails, do not begin legacy cleanup. Preserve the functioning installation and report the exact failed step. If a later migration action fails, stop that item, compare actual state with the saved snapshot and restore only this run's changes when safe. Do not restore a whole configuration file over newer concurrent user changes.

Restore archived assets with their original permissions and link destinations. Restore service enablement/activity only when it existed before and no newer host change conflicts. Schedule restoration must account for object identity; if only recreation is supported, record the new identity and repair only this run's references before claiming recovery. Never blindly replay schedule creation after an ambiguous response.

A failed restore is a recovery hold with named affected items. Do not count a backup's existence, command exit code, or partial service state as successful recovery.

## Host acceptance and completion

Verify after the final mutation, and retain separate evidence for:

- release/installed bytes and CLI versions;
- actual Claude/Codex skill and instruction discovery;
- live T3 Code orchestration, agent continuity and phone connectivity;
- retired items absent from active discovery/activation;
- preserved items and protected configuration unchanged;
- schedules and services in their intended final state;
- repeated reviewed setup unable to restore the old AI workflow.

Publish only a sanitized summary: counts retired/preserved/held, checks passed, release identities and remaining gaps. Keep exact host IDs, paths, definitions and backups private. Mark IO complete only when its applicable checks pass; then start VPS. A held item is explicitly incomplete and prevents a blanket claim of complete legacy retirement. Close the overall capability only after required PR merges, release evidence and both host acceptance receipts exist.
