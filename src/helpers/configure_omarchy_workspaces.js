import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { log, runCommand } from "../common/utils.js";

const ROOT = path.resolve(import.meta.dir, "..", "..");
const OVERLAY = path.join(ROOT, "configs", "omarchy", "workspaces.conf");
const SCRIPT = path.join(
	ROOT,
	"configs",
	"scripts",
	"haoshoku-special-workspace",
);
const SOURCE_LINE = "source = ~/.config/hypr/haoshoku-workspaces.conf";

export async function configureOmarchyWorkspaces({
	home = homedir(),
	fsImpl = fs,
	now = Date.now,
	runCommandImpl = runCommand,
	env = process.env,
} = {}) {
	const hyprDir = path.join(home, ".config", "hypr");
	const main = path.join(hyprDir, "hyprland.conf");
	if (!fsImpl.existsSync(main))
		throw new Error(`Omarchy Hyprland config not found: ${main}`);

	const destination = path.join(hyprDir, "haoshoku-workspaces.conf");
	const desired = fsImpl.readFileSync(OVERLAY);
	let overlayChanged = false;
	if (
		!fsImpl.existsSync(destination) ||
		!fsImpl.readFileSync(destination).equals(desired)
	) {
		if (fsImpl.existsSync(destination))
			fsImpl.copyFileSync(destination, `${destination}.bak.${now()}`);
		fsImpl.writeFileSync(destination, desired);
		overlayChanged = true;
	}

	const binDir = path.join(home, ".local", "bin");
	const scriptDestination = path.join(binDir, "haoshoku-special-workspace");
	fsImpl.mkdirSync(binDir, { recursive: true });
	const scriptDesired = fsImpl.readFileSync(SCRIPT);
	const scriptChanged =
		!fsImpl.existsSync(scriptDestination) ||
		!fsImpl.readFileSync(scriptDestination).equals(scriptDesired);
	if (scriptChanged) fsImpl.writeFileSync(scriptDestination, scriptDesired);
	fsImpl.chmodSync(scriptDestination, 0o755);

	let mainText = fsImpl.readFileSync(main, "utf8");
	const sourceChanged = !mainText.split(/\r?\n/).includes(SOURCE_LINE);
	if (sourceChanged) {
		if (mainText && !mainText.endsWith("\n")) mainText += "\n";
		fsImpl.writeFileSync(
			main,
			`${mainText}\n# Haoshoku workspace behavior (Omarchy visuals remain unchanged)\n${SOURCE_LINE}\n`,
		);
	}

	let validated = false;
	if (env.HYPRLAND_INSTANCE_SIGNATURE) {
		validated =
			Boolean(await runCommandImpl("hyprctl reload")) &&
			Boolean(await runCommandImpl("hyprctl configerrors"));
	} else
		log.info(
			"Hyprland is not active; workspace validation is deferred to login.",
		);
	return { overlayChanged, scriptChanged, sourceChanged, validated };
}
