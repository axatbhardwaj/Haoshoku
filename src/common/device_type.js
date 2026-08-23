import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import promptsLib from "prompts";

import { log } from "./utils.js";

const HOME = homedir();

/**
 * Prompt the user for which device type this machine is (PC / laptop / skip).
 * On PC/laptop, persists `{ deviceType: <value> }` into
 * ~/.haoshoku.json (merged with any existing keys — e.g. custom settings).
 * On skip/cancel, returns null and does NOT touch the file; downstream routing
 * retains a valid stored device type or its PC default when none is stored.
 * An unavailable prompt likewise does not write. Its return value reports the
 * stored valid type or PC to direct callers; full-setup routing reads persisted
 * config independently and therefore does not treat that return as run state.
 *
 * The answer routes Omarchy monitor/workspace prefs plus
 * device-specific audio tuning.
 */
export async function promptDeviceType({
	configPath = path.join(HOME, ".haoshoku.json"),
	promptFn = promptsLib,
	isTTY,
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
	const initial = ["pc", "laptop"].includes(config.deviceType)
		? choices.findIndex(({ value }) => value === config.deviceType)
		: 0;

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
