import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { commandExists, log, runCommand } from "../common/utils.js";

const PROJECT_ROOT_DEFAULT = path.resolve(import.meta.dir, "..", "..");

export async function configureOmazed({
	home = homedir(),
	projectRoot = PROJECT_ROOT_DEFAULT,
	fsImpl = fs,
	now = Date.now,
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

	const zedDir = path.join(home, ".config", "zed");
	const settingsPath = path.join(zedDir, "settings.json");
	const settingsExisted = fsImpl.existsSync(settingsPath);
	const originalSettings = settingsExisted
		? fsImpl.readFileSync(settingsPath, "utf8")
		: null;
	const originalSettingsMode = settingsExisted
		? fsImpl.statSync(settingsPath).mode & 0o777
		: null;
	let settingsChanged = false;
	try {
		const settings = settingsExisted ? Bun.JSONC.parse(originalSettings) : {};
		if (settings.theme !== "Omazed") {
			fsImpl.mkdirSync(zedDir, { recursive: true });
			if (settingsExisted) {
				fsImpl.copyFileSync(settingsPath, `${settingsPath}.bak.${now()}`);
			}
			settings.theme = "Omazed";
			const temporary = `${settingsPath}.haoshoku-tmp`;
			fsImpl.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`);
			if (originalSettingsMode !== null) {
				fsImpl.chmodSync(temporary, originalSettingsMode);
			}
			fsImpl.renameSync(temporary, settingsPath);
			settingsChanged = true;
		}
	} catch (error) {
		log.warning(
			`Could not safely update Zed settings for Omazed (${error.message}); skipping setup.`,
		);
		return { configured: false, retiredLegacyTheme: false };
	}

	if (!(await runCommandImpl("omazed setup"))) {
		if (settingsChanged) {
			if (settingsExisted) fsImpl.writeFileSync(settingsPath, originalSettings);
			else fsImpl.rmSync(settingsPath, { force: true });
		}
		log.warning(
			"Omazed setup failed; keeping the existing Zed theme unchanged.",
		);
		return { configured: false, retiredLegacyTheme: false };
	}

	try {
		const glassHelper = "haoshoku-zed-glass";
		const hookSource = path.join(
			projectRoot,
			"configs",
			"omarchy",
			"hooks",
			"theme-set.d",
			glassHelper,
		);
		const hookDestination = path.join(
			home,
			".config",
			"omarchy",
			"hooks",
			"theme-set.d",
			glassHelper,
		);
		fsImpl.mkdirSync(path.dirname(hookDestination), { recursive: true });

		const desired = fsImpl.readFileSync(hookSource);
		if (
			!fsImpl.existsSync(hookDestination) ||
			!fsImpl.readFileSync(hookDestination).equals(desired)
		) {
			const temporary = `${hookDestination}.haoshoku-tmp`;
			fsImpl.writeFileSync(temporary, desired);
			fsImpl.renameSync(temporary, hookDestination);
		}

		fsImpl.chmodSync(hookDestination, 0o755);
	} catch (error) {
		log.warning(
			`Could not safely deploy the Zed theme hook for Omazed (${error.message}); continuing.`,
		);
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
