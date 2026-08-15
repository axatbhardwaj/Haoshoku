import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const overlayDirectory = path.join(repoRoot, "configs", "omarchy", "haoshoku");
const overlayPaths = [
	path.join(overlayDirectory, "bindings.lua"),
	path.join(overlayDirectory, "workspaces-pc.lua"),
	path.join(overlayDirectory, "workspaces-laptop.lua"),
];
const swapsPath = path.join(
	repoRoot,
	"configs",
	"omarchy",
	"keybinding-swaps.json",
);
const specialWorkspacePath = path.join(
	repoRoot,
	"configs",
	"scripts",
	"haoshoku-special-workspace",
);

function readExistingOverlays() {
	return overlayPaths.flatMap((file) =>
		fs.existsSync(file)
			? [{ file, source: fs.readFileSync(file, "utf8") }]
			: [],
	);
}

function unbindCalls(source) {
	return [...source.matchAll(/hl\.unbind\("([^"]+)"\)/g)].map(([call]) => call);
}

function count(source, pattern) {
	return source.match(pattern)?.length ?? 0;
}

function balancedLuaDelimiters(source) {
	const pairs = { ")": "(", "]": "[", "}": "{" };
	const opening = new Set(Object.values(pairs));
	const stack = [];
	let quote = null;
	let escaped = false;
	let lineComment = false;

	for (let index = 0; index < source.length; index += 1) {
		const character = source[index];
		const next = source[index + 1];

		if (lineComment) {
			if (character === "\n") lineComment = false;
			continue;
		}
		if (quote) {
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === quote) quote = null;
			continue;
		}
		if (character === "-" && next === "-") {
			lineComment = true;
			index += 1;
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			continue;
		}
		if (opening.has(character)) stack.push(character);
		else if (character in pairs && stack.pop() !== pairs[character]) {
			return `unmatched ${character}`;
		}
	}

	if (quote) return `unterminated ${quote} string`;
	if (stack.length > 0) return `unclosed ${stack.at(-1)}`;
	return null;
}

function checkLuaSyntax(file) {
	const luac = Bun.which("luac");
	if (luac) {
		const result = Bun.spawnSync([luac, "-p", file], {
			stdout: "pipe",
			stderr: "pipe",
		});
		return {
			tool: "luac -p",
			exitCode: result.exitCode,
			output: `${result.stdout.toString()}${result.stderr.toString()}`.trim(),
		};
	}

	const lua = Bun.which("lua5.4") ?? Bun.which("lua");
	if (lua) {
		const result = Bun.spawnSync(
			[lua, "-e", "assert(loadfile(arg[1]))", file],
			{ stdout: "pipe", stderr: "pipe" },
		);
		return {
			tool: "lua loadfile",
			exitCode: result.exitCode,
			output: `${result.stdout.toString()}${result.stderr.toString()}`.trim(),
		};
	}

	const error = balancedLuaDelimiters(fs.readFileSync(file, "utf8"));
	return {
		tool: "balanced delimiter fallback",
		exitCode: error ? 1 : 0,
		output: error ?? "",
	};
}

describe("Omarchy v4 Lua overlay", () => {
	it("links every distinct Lua unbind to exactly one registry entry in both directions", () => {
		const missingLuaFiles = overlayPaths
			.filter((file) => !fs.existsSync(file))
			.map((file) => path.relative(repoRoot, file));
		const luaUnbinds = [
			...new Set(
				readExistingOverlays().flatMap(({ source }) => unbindCalls(source)),
			),
		].sort();
		const swaps = JSON.parse(fs.readFileSync(swapsPath, "utf8")).swaps;
		const registryCounts = new Map();
		const missingRegistryFields = [];

		for (const [index, swap] of swaps.entries()) {
			if (typeof swap.hl_unbind !== "string") {
				missingRegistryFields.push(index);
				continue;
			}
			registryCounts.set(
				swap.hl_unbind,
				(registryCounts.get(swap.hl_unbind) ?? 0) + 1,
			);
		}

		expect({
			missingLuaFiles,
			missingRegistryFields,
			luaWithoutExactlyOneRegistryEntry: luaUnbinds.filter(
				(call) => registryCounts.get(call) !== 1,
			),
			staleRegistryEntries: [...registryCounts].flatMap(
				([call, occurrences]) =>
					!luaUnbinds.includes(call) || occurrences !== 1
						? [{ call, occurrences }]
						: [],
			),
		}).toEqual({
			missingLuaFiles: [],
			missingRegistryFields: [],
			luaWithoutExactlyOneRegistryEntry: [],
			staleRegistryEntries: [],
		});
	});

	it("parses every overlay with the strongest available Lua syntax checker", () => {
		const results = overlayPaths.map((file) => {
			if (!fs.existsSync(file)) {
				return {
					file: path.relative(repoRoot, file),
					tool: "unavailable",
					exitCode: 1,
					output: "file does not exist",
				};
			}
			return {
				file: path.relative(repoRoot, file),
				...checkLuaSyntax(file),
			};
		});

		expect(results).toEqual(
			overlayPaths.map((file) => ({
				file: path.relative(repoRoot, file),
				tool: Bun.which("luac")
					? "luac -p"
					: (Bun.which("lua5.4") ?? Bun.which("lua"))
						? "lua loadfile"
						: "balanced delimiter fallback",
				exitCode: 0,
				output: "",
			})),
		);
	});

	it("accounts for the translated directive inventory without adding PC monitor workspace rules", () => {
		const inventory = Object.fromEntries(
			readExistingOverlays().map(({ file, source }) => [
				path.basename(file),
				{
					unbind: count(source, /^hl\.unbind\(/gm),
					bind: count(source, /^o\.bind\(/gm),
					window: count(source, /^o\.window\(/gm),
					workspace: count(source, /^hl\.workspace_rule\(/gm),
					execOnStart: count(source, /^o\.exec_on_start\(/gm),
					env: count(source, /^hl\.env\(/gm),
				},
			]),
		);

		expect(inventory).toEqual({
			"bindings.lua": {
				unbind: 30,
				bind: 20,
				window: 0,
				workspace: 0,
				execOnStart: 0,
				env: 0,
			},
			"workspaces-pc.lua": {
				unbind: 3,
				bind: 24,
				window: 24,
				workspace: 0,
				execOnStart: 2,
				env: 1,
			},
			"workspaces-laptop.lua": {
				unbind: 3,
				bind: 24,
				window: 24,
				workspace: 11,
				execOnStart: 2,
				env: 0,
			},
		});
	});

	it("propagates a failed hyprctl dispatch", () => {
		const directory = fs.mkdtempSync(
			path.join(os.tmpdir(), "haoshoku-dispatch-failure-"),
		);
		temporaryDirectories.push(directory);
		const hyprctl = path.join(directory, "hyprctl");
		fs.writeFileSync(
			hyprctl,
			`#!/usr/bin/env bash
if [[ "$1" == "dispatch" ]]; then
  exit 42
fi
if [[ "$1 $2" == "clients -j" ]]; then
  printf '[]\\n'
fi
`,
		);
		fs.chmodSync(hyprctl, 0o755);

		const result = Bun.spawnSync(
			["bash", specialWorkspacePath, "numbered", "4", "discord"],
			{
				env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
				stdout: "pipe",
				stderr: "pipe",
			},
		);

		expect(result.exitCode).toBe(42);
	});
});

const temporaryDirectories = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});
