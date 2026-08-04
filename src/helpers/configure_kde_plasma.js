import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { log, runCommand } from "../common/utils.js";

const APP_SHORTCUTS = [
	["terminal", "Terminal", "kitty", "Meta+T"],
	["files", "Files", "dolphin", "Meta+E"],
	["editor", "Editor", "zeditor", "Meta+C"],
	[
		"agents",
		"Agents",
		"kitty --class=kitty-agents --title=agents fish -C 'claude -r io'",
		"Meta+A",
	],
	["claude", "Claude", "claude-desktop", "Meta+I"],
	["music", "Spotify", "spotify", "Meta+M"],
	["microphone", "Toggle microphone", "mic-toggle", "Meta+Shift+M"],
];

function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readKdeActivitiesOptIn(home) {
	const stateFile = path.join(home, ".haoshoku.json");
	if (!fs.existsSync(stateFile)) return false;
	try {
		const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
		if (!isPlainObject(state)) throw new TypeError("expected a JSON object");
		return state.kdeActivities === true;
	} catch (err) {
		log.warning(
			`Malformed ~/.haoshoku.json at ${stateFile}; treating KDE Activities as not opted in (${err?.message ?? err})`,
		);
		return false;
	}
}

function persistKdeActivitiesOptIn(home, enabled) {
	const stateFile = path.join(home, ".haoshoku.json");
	let state = {};
	if (fs.existsSync(stateFile)) {
		try {
			const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
			if (!isPlainObject(parsed)) throw new TypeError("expected a JSON object");
			state = parsed;
		} catch (err) {
			log.warning(
				`Malformed ~/.haoshoku.json at ${stateFile}; replacing it while updating KDE Activities (${err?.message ?? err})`,
			);
		}
	}
	state.kdeActivities = enabled;
	fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

function appShortcuts(home, kdeActivities) {
	const brave = kdeActivities
		? [
				[
					"brave-flux",
					"Brave Flux",
					`brave --user-data-dir=${path.join(home, ".local", "share", "haoshoku", "brave-flux")} --class=brave-flux`,
					"Meta+B",
				],
				[
					"brave-defi",
					"Brave DeFi",
					`brave --user-data-dir=${path.join(home, ".local", "share", "haoshoku", "brave-defi")} --class=brave-defi`,
					"Meta+W",
				],
			]
		: [
				[
					"brave-flux",
					"Brave Flux",
					"brave --profile-directory=Default",
					"Meta+B",
				],
				[
					"brave-work",
					"Brave Work",
					'brave --profile-directory="Profile 1"',
					"Meta+W",
				],
			];
	return [...brave, ...APP_SHORTCUTS];
}

function firstCapture(file) {
	if (!fs.existsSync(file)) return;
	const backup = `${file}.haoshoku-first-capture`;
	try {
		fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
	} catch (err) {
		if (err?.code !== "EEXIST") throw err;
	}
}

function parseIni(content) {
	const sections = new Map();
	let current = "";
	sections.set(current, []);
	for (const line of content.split("\n")) {
		const match = line.match(/^\[([^\]]+)\]$/);
		if (match) {
			current = match[1];
			if (!sections.has(current)) sections.set(current, []);
		} else {
			sections.get(current).push(line);
		}
	}
	return sections;
}

function setIniValues(file, updates) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const original = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
	const sections = parseIni(original);
	for (const [section, values] of Object.entries(updates)) {
		if (!sections.has(section)) sections.set(section, []);
		const lines = sections.get(section);
		for (const [key, value] of Object.entries(values)) {
			const prefix = `${key}=`;
			const index = lines.findIndex((line) => line.startsWith(prefix));
			const next = `${prefix}${value}`;
			if (index === -1) lines.push(next);
			else lines[index] = next;
		}
	}

	const rendered = [...sections.entries()]
		.flatMap(([section, lines], index) => {
			const heading = section ? [`[${section}]`] : [];
			const body = lines.filter(
				(line, i, all) => line !== "" || i !== all.length - 1,
			);
			return [...(index > 0 ? [""] : []), ...heading, ...body];
		})
		.join("\n")
		.replace(/^\n+/, "")
		.concat("\n");
	if (rendered !== original) {
		firstCapture(file);
		fs.writeFileSync(file, rendered);
	}
}

function shortcutUpdates() {
	const kwin = {
		_k_friendly_name: "KWin",
		"Edit Tiles": "none,none,Toggle Tiles Editor",
		Overview: "none,none,Toggle Overview",
		KrohnkiteIncrease: "none,none,Krohnkite: Increase",
		KrohnkiteMonocleLayout: "none,none,Krohnkite: Monocle Layout",
	};
	const plasma = {
		_k_friendly_name: "Plasma",
		"next activity": "none,none,Walk through activities",
	};
	const power = {
		_k_friendly_name: "Power Management",
		powerProfile: "Battery,Battery,Switch Power Profile",
	};
	return { kwin, org_kde_powerdevil: power, plasmashell: plasma };
}

function installLaunchers(home, kdeActivities) {
	const applications = path.join(home, ".local", "share", "applications");
	fs.mkdirSync(applications, { recursive: true });
	const retiredLaunchers = [
		"haoshoku-browser.desktop",
		kdeActivities
			? "haoshoku-brave-work.desktop"
			: "haoshoku-brave-defi.desktop",
	];
	for (const retired of retiredLaunchers) {
		const target = path.join(applications, retired);
		if (fs.existsSync(target)) fs.rmSync(target);
	}
	for (const [id, name, command, shortcut] of appShortcuts(
		home,
		kdeActivities,
	)) {
		const target = path.join(applications, `haoshoku-${id}.desktop`);
		const content = [
			"[Desktop Entry]",
			"Type=Application",
			`Name=Haoshoku ${name}`,
			`Exec=${command}`,
			`X-KDE-Shortcuts=${shortcut}`,
			"NoDisplay=true",
			"",
		].join("\n");
		if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== content) {
			firstCapture(target);
			fs.writeFileSync(target, content, { mode: 0o644 });
		}
	}
}

/** Install Haoshoku's app launchers and merge its shortcut unbindings into KDE Plasma. */
export async function syncKdePlasma({
	home = homedir(),
	reload = true,
	run = runCommand,
	enableActivities = false,
	disableActivities = false,
} = {}) {
	if (enableActivities && disableActivities) {
		throw new Error("Cannot enable and disable KDE Activities together");
	}
	if (enableActivities || disableActivities) {
		persistKdeActivitiesOptIn(home, enableActivities);
	}
	const kdeActivities = disableActivities
		? false
		: enableActivities || readKdeActivitiesOptIn(home);
	setIniValues(
		path.join(home, ".config", "kglobalshortcutsrc"),
		shortcutUpdates(),
	);
	installLaunchers(home, kdeActivities);

	if (reload) {
		await run("kbuildsycoca6", { check: false });
		await run("qdbus6 org.kde.KWin /KWin reconfigure", { check: false });
	}
	log.success(
		"KDE Plasma launchers installed and conflicting shortcuts unbound (existing unrelated settings preserved).",
	);
}
