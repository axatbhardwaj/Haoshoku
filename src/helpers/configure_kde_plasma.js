import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { log, runCommand } from "../common/utils.js";

const APP_SHORTCUTS = [
	["brave-flux", "Brave Flux", "brave --profile-directory=Default", "Meta+B"],
	[
		"brave-work",
		"Brave Work",
		'brave --profile-directory="Profile 1"',
		"Meta+W",
	],
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

function installLaunchers(home) {
	const applications = path.join(home, ".local", "share", "applications");
	fs.mkdirSync(applications, { recursive: true });
	const retiredBrowserLauncher = path.join(
		applications,
		"haoshoku-browser.desktop",
	);
	if (fs.existsSync(retiredBrowserLauncher)) fs.rmSync(retiredBrowserLauncher);
	for (const [id, name, command, shortcut] of APP_SHORTCUTS) {
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
} = {}) {
	setIniValues(
		path.join(home, ".config", "kglobalshortcutsrc"),
		shortcutUpdates(),
	);
	installLaunchers(home);

	if (reload) {
		await run("kbuildsycoca6", { check: false });
		await run("qdbus6 org.kde.KWin /KWin reconfigure", { check: false });
	}
	log.success(
		"KDE Plasma launchers installed and conflicting shortcuts unbound (existing unrelated settings preserved).",
	);
}
