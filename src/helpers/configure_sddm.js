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
