import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { log, readDeviceType, runCommand } from "../common/utils.js";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..", "..");

/**
 * Deploy the device-specific monitor template to the generic live filename.
 * `pc` and `laptop` select monitors-pc.conf and monitors-laptop.conf;
 * unknown, unset, or malformed deviceType falls back to `pc` (safer default).
 */
export async function configureOmarchyMonitors({
	home = homedir(),
	projectRoot = PROJECT_ROOT,
	fsImpl = fs,
	now = Date.now,
	runCommandImpl = runCommand,
	env = process.env,
} = {}) {
	const deviceType = readDeviceType(home);
	const monitorTemplate = path.join(
		projectRoot,
		"configs",
		"omarchy",
		`monitors-${deviceType}.conf`,
	);
	const destination = path.join(home, ".config", "hypr", "monitors.conf");
	const desired = fsImpl.readFileSync(monitorTemplate);
	fsImpl.mkdirSync(path.dirname(destination), { recursive: true });

	let changed = false;
	let backup = null;
	if (
		!fsImpl.existsSync(destination) ||
		!fsImpl.readFileSync(destination).equals(desired)
	) {
		if (fsImpl.existsSync(destination)) {
			backup = `${destination}.bak.${now()}`;
			fsImpl.copyFileSync(destination, backup);
			log.info(`Backed up existing monitors.conf to ${backup}`);
		}
		fsImpl.writeFileSync(destination, desired);
		changed = true;
		log.info("Restored Omarchy monitor layout.");
	}

	let validated = false;
	if (env.HYPRLAND_INSTANCE_SIGNATURE) {
		const reloaded = await runCommandImpl("hyprctl reload");
		const clean = await runCommandImpl("hyprctl configerrors");
		validated = Boolean(reloaded && clean);
	} else {
		log.info(
			"Hyprland is not active; monitor validation is deferred to login.",
		);
	}

	return { changed, backup, validated };
}
