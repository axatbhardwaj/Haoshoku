import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { log, runCommand } from "../common/utils.js";

const PLUGIN_NAME = "haoshoku-activities-placement";
const ACTIVITY_SERVICE = "org.kde.ActivityManager";
const ACTIVITY_PATH = "/ActivityManager/Activities";
const ACTIVITY_INTERFACE = "org.kde.ActivityManager.Activities";
const DESIRED_ACTIVITIES = ["flux", "defi", "palmUSD"];
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Measured on Plasma 6.7.3 Wayland:
// `brave --user-data-dir=<fresh> --class=brave-probe` exposes KWin
// resourceClass `brave-probe`, while
// `--profile-directory=Default --class=<anything>` is routed through Chromium's
// existing singleton and remains `brave-browser`. The separate data directories
// are therefore required for the measured brave-flux/brave-defi classes to exist.
const WINDOW_CLASSES = {
	notion: "brave-dcokohelbbehjlcjjfmhfbpdgfjcoopf-Default",
	spotify: "Spotify",
	agents: "kitty-agents",
	braveFlux: "brave-flux",
	discord: "discord",
	whatsapp: "brave-web.whatsapp.com__-Default",
	telegram: "org.telegram.desktop",
	signal: "signal",
	braveDefi: "brave-defi",
	teams: "teams-for-linux",
};

const RULES = [
	["haoshoku-notion", "notion", "all", "Notion"],
	["haoshoku-spotify", "spotify", "all", "Spotify"],
	["haoshoku-agents", "agents", "all", "Agents"],
	["haoshoku-brave-flux", "braveFlux", "flux", "Brave Flux"],
	["haoshoku-discord", "discord", "flux", "Discord"],
	["haoshoku-whatsapp", "whatsapp", "flux", "WhatsApp"],
	["haoshoku-telegram", "telegram", "flux", "Telegram"],
	["haoshoku-signal", "signal", "flux", "Signal"],
	["haoshoku-brave-defi", "braveDefi", "defi", "Brave DeFi"],
	["haoshoku-teams", "teams", "defi", "Teams"],
];

const RETIRED_RULE_IDS = new Set([
	"haoshoku-brave",
	"haoshoku-brave-work",
	...RULES.map(([id]) => id),
]);

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT_SOURCE = path.join(
	PROJECT_ROOT,
	"configs",
	"kwin",
	"scripts",
	PLUGIN_NAME,
);

function splitLines(content) {
	if (/\r(?!\n)/.test(content)) {
		throw new Error("kwinrulesrc contains unsupported line endings");
	}
	const lines = [];
	const matcher = /([^\r\n]*)(\r\n|\n|$)/g;
	let consumed = 0;
	for (const match of content.matchAll(matcher)) {
		if (match[0] === "") break;
		const start = match.index;
		const end = start + match[0].length;
		lines.push({
			text: match[1],
			eol: match[2],
			start,
			end,
		});
		consumed = end;
	}
	if (consumed !== content.length) {
		throw new Error("kwinrulesrc contains unsupported line endings");
	}
	return lines;
}

function leadingCommentBoundary(lines, headerLineIndex) {
	let boundary = headerLineIndex;
	let foundComment = false;
	while (boundary > 0) {
		const text = lines[boundary - 1].text.trimStart();
		if (text.startsWith("#") || text.startsWith(";")) {
			foundComment = true;
			boundary -= 1;
			continue;
		}
		if (text === "") {
			boundary -= 1;
			continue;
		}
		break;
	}
	return foundComment ? boundary : headerLineIndex;
}

function parseSections(content) {
	const lines = splitLines(content);
	const sections = [];
	const names = new Set();
	for (const [index, line] of lines.entries()) {
		const trimmedStart = line.text.trimStart();
		if (!trimmedStart.startsWith("[")) continue;
		if (trimmedStart !== line.text) {
			throw new Error(`Malformed INI section header: ${line.text}`);
		}
		const name = line.text.slice(1, -1);
		if (!/^(?:\[[^[\]]+\])+$/.test(line.text)) {
			throw new Error(`Malformed INI section header: ${line.text}`);
		}
		if (names.has(name)) {
			throw new Error(`Duplicate INI section: ${name}`);
		}
		names.add(name);
		sections.push({ name, lineIndex: index, start: line.start });
	}
	for (const [index, section] of sections.entries()) {
		const nextLineIndex = sections[index + 1]?.lineIndex;
		const bodyEndIndex =
			nextLineIndex === undefined
				? lines.length
				: leadingCommentBoundary(lines, nextLineIndex);
		section.end = lines[bodyEndIndex]?.start ?? content.length;
		section.headerEnd = lines[section.lineIndex].end;
		section.bodyLines = lines.slice(section.lineIndex + 1, bodyEndIndex);
	}
	return { lines, sections };
}

function preferredEol(content) {
	return content.includes("\r\n") ? "\r\n" : "\n";
}

function parseGeneral(section, content) {
	if (!section) return { rules: [], block: null };
	const rulesLines = section.bodyLines.filter((line) =>
		line.text.startsWith("rules="),
	);
	const countLines = section.bodyLines.filter((line) =>
		line.text.startsWith("count="),
	);
	if (rulesLines.length > 1 || countLines.length > 1) {
		throw new Error("Ambiguous duplicate rules/count key in [General]");
	}

	const rulesValue = rulesLines[0]?.text.slice("rules=".length) ?? "";
	const rules = rulesValue === "" ? [] : rulesValue.split(",");
	if (
		rules.some((rule) => rule === "") ||
		new Set(rules).size !== rules.length
	) {
		throw new Error("Ambiguous [General] rules list");
	}
	return {
		rules,
		block: content.slice(section.start, section.end),
		rulesLine: rulesLines[0],
		countLine: countLines[0],
	};
}

function replaceRanges(content, replacements) {
	let result = "";
	let cursor = 0;
	for (const replacement of [...replacements].sort(
		(a, b) => a.start - b.start,
	)) {
		if (replacement.start < cursor) throw new Error("Overlapping INI edits");
		result += content.slice(cursor, replacement.start);
		result += replacement.content;
		cursor = replacement.end;
	}
	return result + content.slice(cursor);
}

function renderGeneral(section, parsed, rules, content, eol) {
	const count = String(rules.length);
	if (!section)
		return `[General]${eol}rules=${rules.join(",")}${eol}count=${count}${eol}`;

	const replacements = [];
	for (const [line, value] of [
		[parsed.rulesLine, `rules=${rules.join(",")}`],
		[parsed.countLine, `count=${count}`],
	]) {
		if (!line) continue;
		replacements.push({
			start: line.start - section.start,
			end: line.end - section.start,
			content: `${value}${line.eol}`,
		});
	}

	let block = replaceRanges(
		content.slice(section.start, section.end),
		replacements,
	);
	const missing = [];
	if (!parsed.rulesLine) missing.push(`rules=${rules.join(",")}`);
	if (!parsed.countLine) missing.push(`count=${count}`);
	if (missing.length > 0) {
		if (block !== "" && !block.endsWith("\n")) block += eol;
		block += `${missing.join(eol)}${eol}`;
	}
	return block;
}

function appendSection(content, block, eol) {
	let result = content;
	if (result !== "" && !result.endsWith("\n")) result += eol;
	if (result !== "" && !result.endsWith(`${eol}${eol}`)) result += eol;
	return result + block;
}

function validateRuleInputs(activityIds, classMap, allActivityIds) {
	for (const name of DESIRED_ACTIVITIES) {
		if (!UUID_PATTERN.test(activityIds[name] ?? "")) {
			throw new Error(`Invalid activity UUID for ${name}`);
		}
	}
	if (
		!Array.isArray(allActivityIds) ||
		allActivityIds.some((id) => !UUID_PATTERN.test(id)) ||
		new Set(allActivityIds).size !== allActivityIds.length ||
		DESIRED_ACTIVITIES.some(
			(name) => !allActivityIds.includes(activityIds[name]),
		)
	) {
		throw new Error("Invalid all-activity UUID list");
	}
	for (const [, classKey] of RULES) {
		if (typeof classMap[classKey] !== "string" || classMap[classKey] === "") {
			throw new Error(`Missing window class for ${classKey}`);
		}
	}
}

/**
 * Replace only Haoshoku-owned KWin rule blocks while preserving all unrelated
 * bytes, including comments, duplicate unrelated keys, spacing, and EOL style.
 */
export function updateKwinRulesContent(
	original,
	activityIds,
	classMap,
	allActivityIds = Object.values(activityIds),
) {
	validateRuleInputs(activityIds, classMap, allActivityIds);
	const eol = preferredEol(original);
	const hadTrailingEol = original === "" || original.endsWith("\n");
	const { sections } = parseSections(original);
	const generalSection = sections.find(({ name }) => name === "General");
	const parsedGeneral = parseGeneral(generalSection, original);
	const unrelatedRules = parsedGeneral.rules.filter(
		(rule) => !RETIRED_RULE_IDS.has(rule),
	);
	const managedRules = RULES.map(([id]) => id);
	const rules = [...unrelatedRules, ...managedRules];
	const replacements = sections
		.filter(({ name }) => RETIRED_RULE_IDS.has(name))
		.map(({ start, end }) => ({ start, end, content: "" }));
	if (generalSection) {
		replacements.push({
			start: generalSection.start,
			end: generalSection.end,
			content: renderGeneral(
				generalSection,
				parsedGeneral,
				rules,
				original,
				eol,
			),
		});
	}

	let result = replaceRanges(original, replacements);
	if (!generalSection) {
		result = appendSection(
			result,
			renderGeneral(null, parsedGeneral, rules, original, eol),
			eol,
		);
	}

	const allActivities = allActivityIds.join(",");
	for (const [id, classKey, activityName, description] of RULES) {
		const activity =
			activityName === "all" ? allActivities : activityIds[activityName];
		const block = [
			`[${id}]`,
			`Description=Haoshoku ${description}`,
			`wmclass=${classMap[classKey]}`,
			"wmclassmatch=1",
			`activity=${activity}`,
			"activityrule=2",
			"",
		].join(eol);
		result = appendSection(result, block, eol);
	}

	if (!hadTrailingEol && result.endsWith(eol)) {
		result = result.slice(0, -eol.length);
	}
	return result;
}

/** Capture an argv command without risking a stdout/stderr pipe deadlock. */
export async function captureCommand(args) {
	const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
	const stdout = new Response(proc.stdout).text();
	const stderr = new Response(proc.stderr).text();
	const [exitCode, capturedStdout, capturedStderr] = await Promise.all([
		proc.exited,
		stdout,
		stderr,
	]);
	return { exitCode, stdout: capturedStdout, stderr: capturedStderr };
}

function activityCommand(method, ...args) {
	return [
		"qdbus6",
		ACTIVITY_SERVICE,
		ACTIVITY_PATH,
		`${ACTIVITY_INTERFACE}.${method}`,
		...args,
	];
}

async function queryActivities(runCapture) {
	const listed = await runCapture(activityCommand("ListActivities"));
	if (listed.exitCode !== 0 || listed.stdout.trim() === "") {
		throw new Error("Could not list KDE activities");
	}
	const ids = listed.stdout.trim().split(/\r?\n/);
	if (
		ids.some((id) => !UUID_PATTERN.test(id)) ||
		new Set(ids).size !== ids.length
	) {
		throw new Error("KDE returned a malformed activity list");
	}

	const names = new Map();
	for (const id of ids) {
		const named = await runCapture(activityCommand("ActivityName", id));
		const name = named.stdout.trim();
		if (named.exitCode !== 0 || name === "" || /[\r\n]/.test(name)) {
			throw new Error(`Could not resolve KDE activity ${id}`);
		}
		if (names.has(name))
			throw new Error(`Duplicate KDE activity name: ${name}`);
		names.set(name, id);
	}
	return names;
}

async function provisionActivities(runCapture) {
	const names = await queryActivities(runCapture);
	for (const name of DESIRED_ACTIVITIES) {
		if (names.has(name)) continue;
		const added = await runCapture(activityCommand("AddActivity", name));
		const id = added.stdout.trim();
		if (
			added.exitCode !== 0 ||
			!UUID_PATTERN.test(id) ||
			[...names.values()].includes(id)
		) {
			throw new Error(`Could not create KDE activity ${name}`);
		}
		names.set(name, id);
	}
	const confirmed = await queryActivities(runCapture);
	for (const name of DESIRED_ACTIVITIES) {
		if (confirmed.get(name) !== names.get(name)) {
			throw new Error(`Could not confirm KDE activity ${name}`);
		}
	}
	return {
		activityIds: Object.fromEntries(
			DESIRED_ACTIVITIES.map((name) => [name, confirmed.get(name)]),
		),
		allActivityIds: [...confirmed.values()],
	};
}

function firstCapture(file) {
	if (!fs.existsSync(file)) return;
	try {
		fs.copyFileSync(
			file,
			`${file}.haoshoku-first-capture`,
			fs.constants.COPYFILE_EXCL,
		);
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
	}
}

function writeIfChanged(file, content) {
	if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) return;
	fs.mkdirSync(path.dirname(file), { recursive: true });
	firstCapture(file);
	fs.writeFileSync(file, content);
}

function installPlacementScript(home) {
	const destination = path.join(
		home,
		".local",
		"share",
		"kwin",
		"scripts",
		PLUGIN_NAME,
	);
	for (const relative of ["metadata.json", "contents/code/main.js"]) {
		writeIfChanged(
			path.join(destination, relative),
			fs.readFileSync(path.join(SCRIPT_SOURCE, relative), "utf8"),
		);
	}
	return path.join(destination, "contents", "code", "main.js");
}

function setIniValue(content, sectionName, key, value) {
	const eol = preferredEol(content);
	const { sections } = parseSections(content);
	const section = sections.find(({ name }) => name === sectionName);
	if (!section) {
		return appendSection(
			content,
			`[${sectionName}]${eol}${key}=${value}${eol}`,
			eol,
		);
	}

	const keyLines = section.bodyLines.filter((line) =>
		line.text.startsWith(`${key}=`),
	);
	if (keyLines.length > 1) {
		throw new Error(`Ambiguous duplicate ${key} key in [${sectionName}]`);
	}
	if (keyLines.length === 1) {
		const line = keyLines[0];
		return replaceRanges(content, [
			{
				start: line.start,
				end: line.end,
				content: `${key}=${value}${line.eol}`,
			},
		]);
	}

	let block = content.slice(section.start, section.end);
	if (block !== "" && !block.endsWith("\n")) block += eol;
	block += `${key}=${value}${eol}`;
	return replaceRanges(content, [
		{ start: section.start, end: section.end, content: block },
	]);
}

function enablePlacementScript(home) {
	const kwinrc = path.join(home, ".config", "kwinrc");
	const original = fs.existsSync(kwinrc) ? fs.readFileSync(kwinrc, "utf8") : "";
	writeIfChanged(
		kwinrc,
		setIniValue(original, "Plugins", `${PLUGIN_NAME}Enabled`, "true"),
	);
}

/** Provision KDE activities and install their activity and output rules. */
export async function syncKdeActivities({
	home = homedir(),
	run = runCommand,
	runCapture = captureCommand,
	reload = true,
} = {}) {
	const rulesFile = path.join(home, ".config", "kwinrulesrc");
	const original = fs.existsSync(rulesFile)
		? fs.readFileSync(rulesFile, "utf8")
		: "";

	try {
		const parsed = parseSections(original);
		parseGeneral(
			parsed.sections.find(({ name }) => name === "General"),
			original,
		);
		const { activityIds, allActivityIds } =
			await provisionActivities(runCapture);
		const rules = updateKwinRulesContent(
			original,
			activityIds,
			WINDOW_CLASSES,
			allActivityIds,
		);
		const scriptFile = installPlacementScript(home);
		enablePlacementScript(home);
		writeIfChanged(rulesFile, rules);

		if (reload) {
			await run("qdbus6 org.kde.KWin /KWin reconfigure", { check: false });
			await run(
				`qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript ${PLUGIN_NAME}`,
				{ check: false },
			);
			await run(
				`qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.loadScript ${scriptFile} ${PLUGIN_NAME}`,
				{ check: false },
			);
			await run("qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.start", {
				check: false,
			});
		}
		log.success("KDE activities, activity rules, and output placement synced.");
		return true;
	} catch (error) {
		log.warning(`KDE activity sync stopped: ${error.message}`);
		return false;
	}
}
