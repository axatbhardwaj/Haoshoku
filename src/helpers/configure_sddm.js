import { userInfo } from "node:os";
import { log } from "../common/utils.js";

const SCRIPT_PATH = "/usr/share/sddm/themes/caelestia/scripts/sync.sh";
const USERNAME_RE = /^[A-Za-z0-9_.-]+$/;
const DEFAULT_SUDOERS_PATH = "/etc/sudoers.d/caelestia-sddm-sync";

/**
 * Generate the sudoers rule line for a username.
 *
 * Scoped to exactly `sync.sh --posthook` — least privilege; the auto path
 * always passes --posthook, so a bare `sudo sync.sh` correctly still requires
 * a password.
 *
 * Throws on any username that doesn't match /^[A-Za-z0-9_.-]+$/ — a malformed
 * username would produce a malformed sudoers line, which would make sudo
 * refuse to run entirely.
 *
 * @param {string} username
 * @returns {string}
 */
export function sddmSudoersLine(username) {
	if (typeof username !== "string" || !USERNAME_RE.test(username)) {
		throw new Error(
			`Invalid username for sudoers rule: ${JSON.stringify(username)}`,
		);
	}
	return `${username} ALL=(root) NOPASSWD: ${SCRIPT_PATH} --posthook`;
}

// POSIX shell single-quote escape: wraps the string in '...' with embedded
// quotes encoded as '\''. Safe for any string value embedded literally in
// the shell script.
function shellEscape(s) {
	return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * Generate the shell script for the single `sudo sh -c` transaction that
 * installs the sudoers drop-in.
 *
 * The transaction runs entirely inside one elevated shell so cleanup never
 * needs a second `sudo` — which would be refused if a malformed sudoers file
 * went live (sudo parses every file in /etc/sudoers.d/ before running ANY
 * command; a parse error blocks everything).
 *
 * Flow:
 *   1. mktemp + chmod 0440 on the candidate
 *   2. visudo -c -f <tmpfile> — validate BEFORE install
 *   3. install -o root -g root -m 0440 <tmpfile> <sudoersPath>
 *   4. visudo -c (full set) — re-validate live
 *   5. on failure of (4): rm the drop-in INSIDE this shell, exit non-zero
 *
 * @param {{ line: string, sudoersPath: string }} opts
 * @returns {string}
 */
export function sddmSudoersInstallScript({ line, sudoersPath }) {
	return [
		"set -e",
		"tmp=$(mktemp)",
		`trap 'rm -f "$tmp"' EXIT`,
		`printf '%s\\n' ${shellEscape(line)} > "$tmp"`,
		`chmod 0440 "$tmp"`,
		`visudo -c -f "$tmp"`,
		`install -o root -g root -m 0440 "$tmp" ${shellEscape(sudoersPath)}`,
		"if ! visudo -c; then",
		`  rm -f ${shellEscape(sudoersPath)}`,
		"  exit 1",
		"fi",
	].join("\n");
}

/**
 * Default runner: executes argv via Bun.spawn and returns the exit code.
 * Uses argv (not a shell string) so the script body in argv[3] is passed
 * literally to `sh -c` — no double-shell quoting concerns.
 *
 * @param {string[]} argv
 * @returns {Promise<{ exitCode: number }>}
 */
async function defaultRunner(argv) {
	const proc = Bun.spawn(argv, { stdout: "inherit", stderr: "inherit" });
	const exitCode = await proc.exited;
	return { exitCode };
}

/**
 * Write the caelestia-sddm posthook sudoers drop-in for the current user.
 *
 * Resolves the invoking user from `opts.username` ?? SUDO_USER ??
 * os.userInfo().username — the SUDO_USER fallback ensures the real user is
 * used when Haoshoku itself was invoked via sudo (otherwise os.userInfo()
 * would return root).
 *
 * Refuses to write a rule for `root`, an empty username, or one that fails
 * the sudoers username regex — a passwordless rule for root is pointless
 * and a malformed sudoers line would make sudo refuse to run.
 *
 * The privileged work happens in ONE sudo invocation:
 *   sudo sh -c '<sddmSudoersInstallScript output>'
 *
 * Non-fatal: any failure logs a warning and returns. A login-screen feature
 * must not abort an OS setup. Mirrors `configureLockfix`.
 *
 * @param {{
 *   username?: string,
 *   sudoersPath?: string,
 *   runner?: (argv: string[]) => Promise<{ exitCode: number }>,
 * }} opts
 */
export async function configureSddm(opts = {}) {
	const {
		username: usernameOverride,
		sudoersPath = DEFAULT_SUDOERS_PATH,
		runner = defaultRunner,
	} = opts;

	const username =
		usernameOverride ?? process.env.SUDO_USER ?? userInfo().username;

	if (!username || username === "root") {
		log.warning(
			`caelestia-sddm posthook: refusing to write sudoers rule for "${username || ""}" — skipping.`,
		);
		return;
	}

	let line;
	try {
		line = sddmSudoersLine(username);
	} catch (err) {
		log.warning(`caelestia-sddm posthook: ${err.message} — skipping.`);
		return;
	}

	const script = sddmSudoersInstallScript({ line, sudoersPath });

	log.info(`Configuring caelestia-sddm posthook (sudoers for ${username})…`);
	try {
		const { exitCode } = await runner(["sudo", "sh", "-c", script]);
		if (exitCode === 0) {
			log.success("caelestia-sddm posthook sudoers rule installed.");
		} else {
			log.warning(
				`caelestia-sddm posthook setup exited ${exitCode} — login screen will not auto-sync. Re-run \`haoshoku --sddm-posthook\` to retry.`,
			);
		}
	} catch (err) {
		log.warning(
			`caelestia-sddm posthook setup failed (${err?.message ?? err}) — login screen will not auto-sync.`,
		);
	}
}
