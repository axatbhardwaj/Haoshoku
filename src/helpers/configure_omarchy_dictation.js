import fs from "node:fs";
import { homedir, hostname as systemHostname } from "node:os";
import path from "node:path";
import { checkOmarchyV4 } from "../common/omarchy_version.js";
import { PROJECT_ROOT } from "../common/paths.js";
import {
	commandExists,
	log,
	readDeviceType,
	runCommand,
	runCommandCapture,
} from "../common/utils.js";

const ORB = "io.github.nodrej.speech-orb";
const REQUIRE = 'require("hypr.haoshoku.dictation")';

function replaceWithBackup(file, desired) {
	if (fs.existsSync(file)) {
		if (fs.readFileSync(file, "utf8") === desired) return;
		let backup = `${file}.bak.${Date.now()}`;
		while (fs.existsSync(backup)) backup += ".1";
		fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
	}
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const temporary = `${file}.tmp.${process.pid}`;
	fs.writeFileSync(temporary, desired);
	fs.renameSync(temporary, file);
}

/** Retire old dictation everywhere; install the desktop backend only on io/iobook. */
export async function configureOmarchyDictation({
	home = homedir(),
	hostname = systemHostname(),
	deviceType = readDeviceType(home),
	env = process.env,
	commandExistsImpl = commandExists,
	captureCommandImpl = runCommandCapture,
	runCommandImpl = runCommand,
} = {}) {
	const capture = (command) => captureCommandImpl(command, { env });
	const run = async (command) => {
		if (!(await runCommandImpl(command, { env, check: false })))
			throw new Error(`Dictation setup failed: ${command}`);
	};
	try {
		if (await commandExistsImpl("systemctl")) {
			const service = await capture(
				"systemctl --user show voxtype.service --property=LoadState --value",
			);
			const state = service.stdout.trim();
			if (state === "loaded")
				await run("systemctl --user disable --now voxtype.service");
			else if (state !== "not-found" && state !== "masked")
				throw new Error(
					"Could not determine voxtype.service state; retirement deferred.",
				);
		}

		const isOmarchy = await commandExistsImpl("omarchy");
		if (isOmarchy) {
			const snapshot = await capture("omarchy plugin list --json");
			if (snapshot.exitCode !== 0)
				throw new Error("Could not list Omarchy plugins; retirement deferred.");
			const plugins = JSON.parse(snapshot.stdout);
			if (
				!Array.isArray(plugins) ||
				!plugins.some((plugin) => plugin?.id?.startsWith("omarchy."))
			)
				throw new Error(
					"Omarchy plugin snapshot is not ready; retirement deferred.",
				);
			if (plugins.some((plugin) => plugin.id === ORB && plugin.enabled))
				await run(`omarchy plugin disable ${ORB}`);
		}

		const host = hostname.split(".")[0];
		const desktop =
			(host === "io" && deviceType === "pc") ||
			(host === "iobook" && deviceType === "laptop");
		if (!isOmarchy || !desktop) return { ok: true, desktop: false };
		const gate = await checkOmarchyV4({ captureCommandImpl, env });
		if (!gate.ok) return { ok: false, desktop: false, message: gate.message };
		const main = path.join(home, ".config/hypr/hyprland.lua");
		if (!fs.existsSync(main))
			throw new Error(`Omarchy Lua config missing: ${main}`);

		// setup-user resets preferences: the official installer is for new installs only.
		if (!(await commandExistsImpl("superwhisper")))
			await run("omarchy-install-dictation-superwhisper --background");
		await run("systemctl --user enable --now superwhisper.service");
		await run("superwhisper shortcuts set hold none");
		await run("omarchy-dictation-use superwhisper");

		replaceWithBackup(
			path.join(home, ".config/hypr/haoshoku/dictation.lua"),
			fs.readFileSync(
				path.join(PROJECT_ROOT, "configs/omarchy/haoshoku/dictation.lua"),
				"utf8",
			),
		);
		const original = fs.readFileSync(main, "utf8");
		const newline = original.includes("\r\n") ? "\r\n" : "\n";
		const lines = original
			.split(/\r\n|\n|\r/)
			.filter((line) => line !== REQUIRE);
		let text = lines.join(newline);
		if (text && !text.endsWith(newline)) text += newline;
		// Load after personal bindings so an existing generic F9 pair is replaced once.
		replaceWithBackup(main, `${text}${REQUIRE}${newline}`);
		if (env.HYPRLAND_INSTANCE_SIGNATURE) await run("hyprctl reload");
		return { ok: true, desktop: true };
	} catch (error) {
		log.warning(error.message);
		return { ok: false, message: error.message };
	}
}
