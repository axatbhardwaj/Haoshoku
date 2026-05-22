const SCRIPT_PATH = "/usr/share/sddm/themes/caelestia/scripts/sync.sh";
const USERNAME_RE = /^[A-Za-z0-9_.-]+$/;

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
