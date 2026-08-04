import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { log, runCommand } from "../common/utils.js";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..", "..");
const MONITOR_TEMPLATE = path.join(
	PROJECT_ROOT,
	"configs",
	"omarchy",
	"monitors.conf",
);

export async function configureOmarchyMonitors({
	home = homedir(),
	fsImpl = fs,
	now = Date.now,
	runCommandImpl = runCommand,
	env = process.env,
} = {}) {
	const destination = path.join(home, ".config", "hypr", "monitors.conf");
	const desired = fsImpl.readFileSync(MONITOR_TEMPLATE);
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
