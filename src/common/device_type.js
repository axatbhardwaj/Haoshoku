import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import promptsLib from "prompts";

import { log } from "./utils.js";

const HOME = homedir();
const PORTABLE_CHASSIS_TYPES = new Set([8, 9, 10, 14, 30, 31, 32]);
const DESKTOP_CHASSIS_TYPES = new Set([
	3, 4, 5, 6, 7, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 33, 34, 35, 36,
]);

/** Detect laptop/PC topology from Linux's DMI and power-supply sysfs data. */
export function detectDeviceType({
	chassisTypePath = "/sys/class/dmi/id/chassis_type",
	powerSupplyPath = "/sys/class/power_supply",
	fsImpl = fs,
} = {}) {
	try {
		const chassisType = Number(
			fsImpl.readFileSync(chassisTypePath, "utf8").trim(),
		);
		if (PORTABLE_CHASSIS_TYPES.has(chassisType)) return "laptop";
		if (DESKTOP_CHASSIS_TYPES.has(chassisType)) return "pc";
	} catch {
		// Fall through to battery detection when DMI is absent (for example ARM).
	}

	try {
		for (const entry of fsImpl.readdirSync(powerSupplyPath)) {
			const type = fsImpl
				.readFileSync(path.join(powerSupplyPath, entry, "type"), "utf8")
				.trim()
				.toLowerCase();
			if (type === "battery") return "laptop";
		}
	} catch {
		// Detection is advisory; an interactive prompt remains the fallback.
	}
	return null;
}

/**
 * Resolve device type in priority order: explicit CLI override, stored value,
 * Linux hardware detection, then an interactive PC/laptop/skip fallback.
 * Detected or selected values are merged into ~/.haoshoku.json; skip and
 * unavailable prompts do not write a fallback. Downstream helpers read the
 * persisted value independently.
 */
export async function promptDeviceType({
	configPath = path.join(HOME, ".haoshoku.json"),
	promptFn = promptsLib,
	isTTY,
	detectDeviceTypeImpl = detectDeviceType,
	forcedDeviceType,
} = {}) {
	let config = {};
	let replacementWarning;
	if (fs.existsSync(configPath)) {
		try {
			const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				config = parsed;
			} else {
				replacementWarning = `~/.haoshoku.json at ${configPath} must contain an object; replacing it while saving deviceType.`;
			}
		} catch (err) {
			replacementWarning = `Malformed ~/.haoshoku.json at ${configPath}; replacing it while saving deviceType (${err?.message ?? err})`;
			config = {};
		}
	}

	const persist = (deviceType) => {
		if (replacementWarning) log.warning(replacementWarning);
		config.deviceType = deviceType;
		fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
		return deviceType;
	};
	if (forcedDeviceType === "pc" || forcedDeviceType === "laptop") {
		return persist(forcedDeviceType);
	}
	if (config.deviceType === "pc" || config.deviceType === "laptop") {
		log.info(`Using stored deviceType ${config.deviceType}.`);
		return config.deviceType;
	}

	let detectedDeviceType = null;
	try {
		detectedDeviceType = detectDeviceTypeImpl();
	} catch (err) {
		log.warning(
			`Automatic device-type detection failed (${err?.message ?? err}).`,
		);
	}
	if (detectedDeviceType === "pc" || detectedDeviceType === "laptop") {
		log.info(`Automatically detected deviceType ${detectedDeviceType}.`);
		return persist(detectedDeviceType);
	}

	const canPrompt =
		isTTY ?? (promptFn !== promptsLib || Boolean(process.stdin.isTTY));
	const unavailablePromptResult = (reason) => {
		const deviceType =
			config.deviceType === "pc" || config.deviceType === "laptop"
				? config.deviceType
				: "pc";
		const source =
			deviceType === config.deviceType
				? `returning stored deviceType ${deviceType}`
				: "returning deviceType pc";
		log.warning(
			`${reason}; ${source} without saving it; full setup routing reads persisted config independently.`,
		);
		return deviceType;
	};
	if (!canPrompt) {
		return unavailablePromptResult("No interactive terminal available");
	}
	const choices = [
		{ title: "Main PC", value: "pc" },
		{ title: "Laptop", value: "laptop" },
		{ title: "Skip — don't persist", value: null },
	];
	const initial = 0;

	let response;
	try {
		response = await promptFn({
			type: "select",
			name: "device",
			message:
				"Which device is this? (routes monitor, workspace, and audio configs)",
			choices,
			initial: initial >= 0 ? initial : 0,
		});
	} catch (err) {
		return unavailablePromptResult(
			`Device type prompt failed (${err?.message ?? err})`,
		);
	}

	if (!response || response.device === undefined || response.device === null) {
		return null;
	}

	return persist(response.device);
}
