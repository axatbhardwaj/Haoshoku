import { expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const fromCodes = (...codes) => String.fromCharCode(...codes);
const bounded = (value) =>
	new RegExp(`(?:^|[^a-z0-9])${value}(?:[^a-z0-9]|$)`, "i");
const RETIRED_PATTERNS = [
	{
		label: "retired product identifier",
		pattern: bounded(fromCodes(100, 118, 97, 110, 100, 118, 97)),
	},
	{
		label: "retired primary-role token",
		pattern: bounded(fromCodes(118, 97, 100, 105)),
	},
	{
		label: "retired short secondary-role token",
		pattern: bounded(fromCodes(112, 114, 97, 116)),
	},
	{
		label: "retired full secondary-role token",
		pattern: bounded(fromCodes(112, 114, 97, 116, 105, 118, 97, 100, 105)),
	},
];

function maintainedPaths() {
	const listed = Bun.spawnSync(
		["git", "ls-files", "-co", "--exclude-standard", "-z"],
		{ cwd: PROJECT_ROOT },
	);
	expect(listed.exitCode).toBe(0);
	return [...new Set(listed.stdout.toString().split("\0").filter(Boolean))];
}

function maintainedText(relativePath) {
	const absolutePath = path.join(PROJECT_ROOT, relativePath);
	const stat = fs.lstatSync(absolutePath);
	if (stat.isSymbolicLink()) return fs.readlinkSync(absolutePath);
	if (!stat.isFile()) return "";
	const contents = fs.readFileSync(absolutePath);
	if (contents.includes(0)) return "";
	return contents.toString("utf8");
}

it("keeps maintained files free of retired orchestration vocabulary", () => {
	const violations = [];
	for (const relativePath of maintainedPaths()) {
		const normalized = maintainedText(relativePath)
			.replace(/\[([a-z0-9])\]/gi, "$1")
			.toLowerCase();
		for (const token of RETIRED_PATTERNS) {
			if (token.pattern.test(normalized)) {
				violations.push(`${relativePath}: ${token.label}`);
			}
		}
	}

	expect(violations, violations.join("\n")).toEqual([]);
});
