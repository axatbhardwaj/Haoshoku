import {
	commandExists,
	log,
	runCommand,
	runCommandCapture,
} from "../common/utils.js";

/**
 * Turn off voxtype's own on-screen display so it does not overlap the
 * Speech Orb Omarchy plugin, which replaces it. Restarts the daemon only
 * when the setting actually changed and the service is already running.
 */
export async function configureVoxtypeOsd({
	commandExistsImpl = commandExists,
	captureCommandImpl = runCommandCapture,
	runCommandImpl = runCommand,
} = {}) {
	if (!(await commandExistsImpl("voxtype"))) {
		log.info("voxtype is unavailable; skipping OSD configuration.");
		return { changed: false };
	}

	const current = await captureCommandImpl("voxtype config get osd.enabled");
	if (current.exitCode === 0 && current.stdout.trim() === "false") {
		return { changed: false };
	}

	if (!(await runCommandImpl("voxtype config set osd.enabled false"))) {
		log.warning("Could not disable the voxtype OSD — continuing.");
		return { changed: false };
	}

	await runCommandImpl("systemctl --user try-restart voxtype.service", {
		check: false,
	});
	log.success("Disabled the voxtype OSD in favour of the Speech Orb plugin.");
	return { changed: true };
}
