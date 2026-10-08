import path from "node:path";
import { writeServiceDropIn } from "./t3_tailscale.js";

export const OP_ENV_PATH = ".config/op/service-account.env";
export const OP_DROP_IN = "haoshoku-op.conf";
export const OP_DROP_CONTENT = `[Service]\nEnvironmentFile=-%h/${OP_ENV_PATH}\n`;
export const OP_ENV_FIX =
	"Fix ~/.config/op/service-account.env: use a regular file owned by your user, mode 0600, containing only the single line OP_SERVICE_ACCOUNT_TOKEN=<token> (one trailing newline allowed), or delete it.";

// lstat distinguishes true absence from dangling links and other unsafe inputs.
// Return only a status; never pass token contents to logging or file writers.
export function checkOpEnvironment(home, fsImpl, uid = process.getuid()) {
	const file = path.join(home, OP_ENV_PATH);
	let stat;
	try {
		stat = fsImpl.lstatSync(file);
	} catch (error) {
		return error.code === "ENOENT" ? "absent" : "invalid";
	}
	if (!stat.isFile() || (stat.mode & 0o7777) !== 0o600 || stat.uid !== uid)
		return "invalid";
	try {
		return /^OP_SERVICE_ACCOUNT_TOKEN=[^\s\0]+\n?$/.test(
			fsImpl.readFileSync(file, "utf8"),
		)
			? "valid"
			: "invalid";
	} catch {
		return "invalid";
	}
}

/** Called only after iobox T3 service setup succeeds. */
export async function configureT3Op({ home, fsImpl, runCommandImpl, logger }) {
	logger.info(
		"Token rotation or later creation requires: systemctl --user restart t3code",
	);
	const status = checkOpEnvironment(home, fsImpl);
	if (status === "absent") {
		logger.info(
			`Create ~/.config/op/service-account.env before retrying. ${OP_ENV_FIX}`,
		);
		return;
	}
	if (status === "invalid") {
		logger.warning(OP_ENV_FIX);
		return;
	}
	if (writeServiceDropIn(home, OP_DROP_IN, OP_DROP_CONTENT, fsImpl)) {
		for (const command of [
			"systemctl --user daemon-reload",
			"systemctl --user restart t3code",
		]) {
			if (!(await runCommandImpl(command)))
				throw new Error(`Failed: ${command}`);
		}
	}
}
