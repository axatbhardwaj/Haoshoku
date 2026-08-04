import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { commandExists, log, runCommand } from "../common/utils.js";

export async function configureOmazed({
	home = homedir(),
	fsImpl = fs,
	commandExistsImpl = commandExists,
	runCommandImpl = runCommand,
} = {}) {
	if (
		!(await commandExistsImpl("omarchy")) ||
		!(await commandExistsImpl("omazed"))
	) {
		log.info("Omazed or Omarchy is unavailable; skipping Zed theme sync.");
		return { configured: false, retiredLegacyTheme: false };
	}

	if (!(await runCommandImpl("omazed setup"))) {
		log.warning(
			"Omazed setup failed; keeping the existing Zed theme unchanged.",
		);
		return { configured: false, retiredLegacyTheme: false };
	}

	const legacyTheme = path.join(
		home,
		".config",
		"zed",
		"themes",
		"caelestia.json",
	);
	const retiredLegacyTheme = fsImpl.existsSync(legacyTheme);
	if (retiredLegacyTheme) {
		fsImpl.rmSync(legacyTheme);
		log.info("Removed the retired Caelestia Zed theme.");
	}

	return { configured: true, retiredLegacyTheme };
}
