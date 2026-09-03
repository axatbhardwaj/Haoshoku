import { userInfo } from "node:os";
import { commandExists, log, runCommand } from "../common/utils.js";

export const HERDR_INSTALL_COMMAND =
	"curl -fsSL https://herdr.dev/install.sh | sh";
const CHANNEL_COMMAND = "herdr channel set stable";

/**
 * Install herdr (the agent session layer) and keep its server alive across
 * SSH logouts via systemd lingering.
 *
 * Never upgrades an existing install: pre-1.0 protocol bumps restart the
 * server and kill running agent panes, so upgrades stay a manual
 * `herdr update` with no agents running. The herdr server itself starts on
 * first attach, so no unit file is needed.
 *
 * @returns {Promise<"configured" | "failed">}
 */
export async function configureHerdr({
	userName = userInfo().username,
	run = runCommand,
	commandExistsImpl = commandExists,
	logImpl = log,
} = {}) {
	if (await commandExistsImpl("herdr")) {
		logImpl.info(
			"herdr already installed — leaving the version untouched. Upgrade manually with `herdr update` when no agents are running.",
		);
	} else {
		logImpl.info("Installing herdr...");
		if (!(await run(HERDR_INSTALL_COMMAND))) {
			logImpl.warning("herdr install failed — retry with: haoshoku --herdr");
			return "failed";
		}
	}

	if (!(await run(CHANNEL_COMMAND))) {
		logImpl.warning(
			"Could not pin herdr to the stable channel — run manually: herdr channel set stable",
		);
	}

	const lingerHint = `loginctl enable-linger ${userName}`;
	if (await run(lingerHint)) {
		logImpl.success(
			`Enabled systemd user lingering for ${userName}; herdr sessions survive SSH logout.`,
		);
	} else {
		logImpl.warning(
			`Could not enable systemd user lingering. Run manually:\n  ${lingerHint}`,
		);
	}
	return "configured";
}
