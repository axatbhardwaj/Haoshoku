import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

function parse(text) {
	return Bun.TOML.parse(text);
}

function statusLine(text, bundle = false) {
	const config = parse(text);
	if (
		bundle &&
		(Object.keys(config).join() !== "tui" ||
			Object.keys(config.tui ?? {}).join() !== "status_line")
	) {
		throw new Error(
			"Codex status-line bundle must contain only tui.status_line",
		);
	}
	const value = config.tui?.status_line;
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new Error("Codex tui.status_line must be an array of strings");
	}
	return value;
}

export function exportCodexStatusLine(text) {
	if (parse(text).tui?.status_line === undefined) return null;
	return `[tui]\nstatus_line = ${JSON.stringify(statusLine(text))}\n`;
}

export function mergeCodexStatusLine(live, bundle) {
	const desired = statusLine(bundle, true);
	const parsed = parse(live);
	// A textual edit cannot safely locate table headers inside multiline strings.
	if (live.includes('"""') || live.includes("'''")) {
		throw new Error("Ambiguous multiline TOML; Codex config left unchanged");
	}
	const lines = live.split("\n");
	const sections = [];
	for (let i = 0; i < lines.length; i++) {
		const header = lines[i].match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
		if (header) sections.push({ name: header[1].trim(), start: i });
	}
	if (sections.filter((section) => section.name === "tui").length > 1) {
		throw new Error("Ambiguous duplicate [tui] table");
	}
	const tui = sections.find((section) => section.name === "tui");
	const replacement = `${tui ? "status_line" : "tui.status_line"} = ${JSON.stringify(desired)}`;
	const start = tui ? tui.start + 1 : 0;
	const end = tui
		? (sections.find((section) => section.start > tui.start)?.start ??
			lines.length)
		: (sections[0]?.start ?? lines.length);
	const matches = [];
	for (let i = start; i < end; i++) {
		if (
			(tui
				? /^\s*(?:status_line|["']status_line["'])\s*=/
				: /^\s*tui\.status_line\s*=/
			).test(lines[i])
		)
			matches.push(i);
	}
	if (
		matches.length > 1 ||
		(parsed.tui?.status_line !== undefined && matches.length === 0)
	) {
		throw new Error("Ambiguous tui.status_line assignment");
	}
	if (matches.length) {
		let last = matches[0];
		if (!lines[last].includes("]")) {
			while (++last < end && !lines[last].includes("]")) {}
			if (last >= end) throw new Error("Ambiguous multiline status line");
		}
		lines.splice(matches[0], last - matches[0] + 1, replacement);
	} else if (tui) {
		lines.splice(end, 0, replacement);
	} else if (parsed.tui) {
		if (/^\s*tui\s*=/m.test(live)) {
			throw new Error("Ambiguous inline tui table");
		}
		lines.splice(end, 0, replacement);
	} else {
		return validateMerge(
			`${live}${live && !live.endsWith("\n") ? "\n" : ""}\n[tui]\nstatus_line = ${JSON.stringify(desired)}\n`,
			parsed,
			desired,
		);
	}
	return validateMerge(lines.join("\n"), parsed, desired);
}

function validateMerge(merged, original, desired) {
	const result = parse(merged);
	const expected = {
		...original,
		tui: { ...original.tui, status_line: desired },
	};
	if (!isDeepStrictEqual(result, expected))
		throw new Error("Codex footer merge failed validation");
	return merged;
}

export function writeCodexStatusLine(livePath, bundlePath) {
	const bundle = fs.readFileSync(bundlePath, "utf8");
	let stat = null;
	try {
		stat = fs.lstatSync(livePath);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	if (stat && (!stat.isFile() || stat.isSymbolicLink())) {
		throw new Error("Codex config must be a regular file, not a symlink");
	}
	const live = stat ? fs.readFileSync(livePath, "utf8") : "";
	const merged = mergeCodexStatusLine(live, bundle);
	if (merged === live) return;
	if (stat) {
		const primaryBackup = `${livePath}.bak`;
		const backup = fs.existsSync(primaryBackup)
			? `${primaryBackup}.${randomUUID()}`
			: primaryBackup;
		fs.writeFileSync(backup, live, { flag: "wx", mode: 0o600 });
	}
	const temp = path.join(
		path.dirname(livePath),
		`.${path.basename(livePath)}.${randomUUID()}.tmp`,
	);
	try {
		fs.writeFileSync(temp, merged, { flag: "wx", mode: 0o600 });
		fs.chmodSync(temp, stat?.mode & 0o600 || 0o600);
		fs.renameSync(temp, livePath);
	} finally {
		fs.rmSync(temp, { force: true });
	}
}
