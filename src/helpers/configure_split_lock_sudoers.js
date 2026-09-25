import fs from "node:fs";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";

import { log, runCommand } from "../common/utils.js";

// Lets `haoshoku-gaming-workspace place` lift the kernel's split-lock penalty for the
// length of a game launch without a password prompt. The rule names the two exact
// sysctl invocations the wrapper makes and nothing else, so it cannot be used to set
// any other kernel parameter.
export const SPLIT_LOCK_SUDOERS_FILE = "/etc/sudoers.d/haoshoku-split-lock";

const SYSCTL = "/usr/bin/sysctl -q -w kernel.split_lock_mitigate";
const USERNAME_RE = /^[a-z_][a-z0-9_-]*$/;

export function splitLockSudoersRule(username) {
	if (!USERNAME_RE.test(username)) {
		throw new TypeError(`Refusing unexpected username: ${username}`);
	}
	return [
		"# Managed by Haoshoku: lets haoshoku-gaming-workspace lift the split-lock",
		"# penalty while a game runs and restore it afterwards.",
		`${username} ALL=(root) NOPASSWD: ${SYSCTL}=0, ${SYSCTL}=1`,
		"",
	].join("\n");
}

export async function configureSplitLockSudoers({
	username = userInfo().username,
	tmpDir = tmpdir(),
	fsImpl = fs,
	runCommandImpl = runCommand,
	nonInteractiveSudo = false,
} = {}) {
	const sudo = nonInteractiveSudo ? "sudo -n" : "sudo";
	const stageDir = fsImpl.mkdtempSync(path.join(tmpDir, "haoshoku-sudoers-"));
	const stage = path.join(stageDir, "haoshoku-split-lock");

	try {
		fsImpl.writeFileSync(stage, splitLockSudoersRule(username), {
			mode: 0o600,
		});

		// A malformed sudoers drop-in can lock sudo out entirely, so nothing is
		// installed until visudo accepts the exact bytes.
		if (!(await runCommandImpl(`${sudo} visudo -cf '${stage}'`))) {
			log.warning(
				"visudo rejected the split-lock sudoers rule; not installed.",
			);
			return false;
		}
		if (
			!(await runCommandImpl(
				`${sudo} install -o root -g root -m 0440 '${stage}' '${SPLIT_LOCK_SUDOERS_FILE}'`,
			))
		) {
			log.warning("Could not install the split-lock sudoers rule.");
			return false;
		}

		log.success(
			"Games launched through haoshoku-gaming-workspace now run without the split-lock penalty.",
		);
		return true;
	} finally {
		fsImpl.rmSync(stageDir, { recursive: true, force: true });
	}
}
