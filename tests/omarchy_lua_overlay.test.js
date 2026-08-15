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

function filesBelow(directory) {
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) return filesBelow(entryPath);
		return entry.isFile() ? [entryPath] : [];
	});
}

function unbindCalls(source) {
	return [...source.matchAll(/hl\.unbind\("([^"]+)"\)/g)].map(([call]) => call);
}

const modifierOrder = new Map(
	["SUPER", "CTRL", "SHIFT", "ALT"].map((modifier, index) => [modifier, index]),
);

function canonicalLuaChord(chord) {
	const parts = chord.split(" + ");
	const key = parts.pop();
	return [
		...parts.toSorted(
			(left, right) => modifierOrder.get(left) - modifierOrder.get(right),
		),
		key,
	].join(" + ");
}

function luaBindingOperations(source, owner) {
	const executableSource = source.replace(/--.*$/gm, "");
	return [
		...executableSource.matchAll(/(hl\.unbind|o\.bind)\(\s*"([^"]+)"/g),
	].map(([, operation, chord]) => ({
		chord: canonicalLuaChord(chord),
		owner,
		type: operation === "hl.unbind" ? "unbind" : "bind",
	}));
}

function workspaceReclaimState(
	bindingsSource,
	workspaceSource,
	effectiveOrder,
) {
	const bindingsOperations = luaBindingOperations(
		bindingsSource,
		"bindings.lua",
	);
	const workspaceOperations = luaBindingOperations(
		workspaceSource,
		"workspace overlay",
	);
	const bindingsUnbound = new Set(
		bindingsOperations
			.filter(({ type }) => type === "unbind")
			.map(({ chord }) => chord),
	);
	const bindingsBound = new Set(
		bindingsOperations
			.filter(({ type }) => type === "bind")
			.map(({ chord }) => chord),
	);
	const workspaceBound = new Set(
		workspaceOperations
			.filter(({ type }) => type === "bind")
			.map(({ chord }) => chord),
	);
	const reclaimed = [...workspaceBound]
		.filter((chord) => bindingsUnbound.has(chord))
		.toSorted();
	const active = new Map();
	for (const operations of effectiveOrder) {
		for (const operation of operations) {
			if (operation.type === "unbind") active.delete(operation.chord);
			else active.set(operation.chord, operation.owner);
		}
	}

	return {
		boundInBindings: reclaimed.filter((chord) => bindingsBound.has(chord)),
		notOwnedByWorkspaceAfterLoad: reclaimed.filter(
			(chord) => active.get(chord) !== "workspace overlay",
		),
		reclaimed,
	};
}

function deletedKeyViolations(overlays, swaps) {
	const operations = overlays.flatMap(({ owner, source }) =>
		luaBindingOperations(source, owner),
	);
	return swaps
		.filter(({ reason }) => reason === "deleted_by_user")
		.flatMap((swap) => {
			const chord = canonicalLuaChord(
				swap.hl_unbind.match(/^hl\.unbind\("([^"]+)"\)$/)?.[1] ?? "",
			);
			const unboundIn = operations
				.filter(
					(operation) =>
						operation.type === "unbind" && operation.chord === chord,
				)
				.map(({ owner }) => owner);
			const reboundIn = operations
				.filter(
					(operation) => operation.type === "bind" && operation.chord === chord,
				)
				.map(({ owner }) => owner);
			return unboundIn.length > 0 && reboundIn.length === 0
				? []
				: [{ chord, reboundIn, unboundIn }];
		});
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
	it("spells every Lua unbind in canonical modifier order", () => {
		const noncanonical = readExistingOverlays().flatMap(({ file, source }) =>
			[...source.matchAll(/hl\.unbind\("([^"]+)"\)/g)].flatMap(([, chord]) => {
				const canonical = canonicalLuaChord(chord);
				return chord === canonical
					? []
					: [{ canonical, chord, file: path.basename(file) }];
			}),
		);

		expect(noncanonical).toEqual([]);
	});

	it("loads bindings before every workspace-overlay reclaim", () => {
		const bindingsSource = fs.readFileSync(overlayPaths[0], "utf8");

		for (const workspacePath of overlayPaths.slice(1)) {
			const workspaceSource = fs.readFileSync(workspacePath, "utf8");
			const bindingsOperations = luaBindingOperations(
				bindingsSource,
				"bindings.lua",
			);
			const workspaceOperations = luaBindingOperations(
				workspaceSource,
				"workspace overlay",
			);
			const state = workspaceReclaimState(bindingsSource, workspaceSource, [
				bindingsOperations,
				workspaceOperations,
			]);
			const reversedLoadState = workspaceReclaimState(
				bindingsSource,
				workspaceSource,
				[workspaceOperations, bindingsOperations],
			);

			expect(state.reclaimed, path.basename(workspacePath)).toContain(
				"SUPER + SHIFT + G",
			);
			expect(state.boundInBindings, path.basename(workspacePath)).toEqual([]);
			expect(
				state.notOwnedByWorkspaceAfterLoad,
				path.basename(workspacePath),
			).toEqual([]);
			expect(
				reversedLoadState.notOwnedByWorkspaceAfterLoad,
				`${path.basename(workspacePath)} reversed-order mutation`,
			).toEqual(state.reclaimed);
		}
	});

	it("keeps every deleted_by_user chord suppressed across all Lua overlays", () => {
		const overlays = readExistingOverlays().map(({ file, source }) => ({
			owner: path.basename(file),
			source,
		}));
		const swaps = JSON.parse(fs.readFileSync(swapsPath, "utf8")).swaps;
		const resurrectedSource = `${overlays[1].source}\no.bind("SUPER + SHIFT + A", "Regression mutation", "false")\n`;

		expect(deletedKeyViolations(overlays, swaps)).toEqual([]);
		expect(
			deletedKeyViolations(
				[
					overlays[0],
					{ ...overlays[1], source: resurrectedSource },
					overlays[2],
				],
				swaps,
			),
		).toContainEqual({
			chord: "SUPER + SHIFT + A",
			reboundIn: ["workspaces-pc.lua"],
			unboundIn: ["bindings.lua"],
		});
	});

	it("unbinds the stock Google Maps chord before both stash-window bindings", () => {
		const workspaceResults = overlayPaths.slice(1).map((file) => ({
			file: path.basename(file),
			unbindImmediatelyPrecedesBind:
				/hl\.unbind\("SUPER \+ SHIFT \+ S"\)\s*o\.bind\(\s*"SUPER \+ SHIFT \+ S"/.test(
					fs.readFileSync(file, "utf8"),
				),
		}));
		const swap = JSON.parse(fs.readFileSync(swapsPath, "utf8")).swaps.find(
			(entry) => entry.hl_unbind === 'hl.unbind("SUPER + SHIFT + S")',
		);

		expect(workspaceResults).toEqual([
			{
				file: "workspaces-pc.lua",
				unbindImmediatelyPrecedesBind: true,
			},
			{
				file: "workspaces-laptop.lua",
				unbindImmediatelyPrecedesBind: true,
			},
		]);
		expect(swap).toEqual({
			config_file: "configs/omarchy/haoshoku/workspaces-pc.lua",
			key_combination_taken: "SUPER SHIFT, S",
			hl_unbind: 'hl.unbind("SUPER + SHIFT + S")',
			previous_binding:
				'bindd = SUPER SHIFT, S, Google Maps, exec, omarchy-launch-or-focus-webapp "Google Maps" "https://maps.google.com/"',
			moved_from_dispatcher: "exec",
			moved_from_arg:
				'omarchy-launch-or-focus-webapp "Google Maps" "https://maps.google.com/"',
			reason: "superseded_by_workspace_toggle",
		});
	});

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
		const missingConfigFiles = [];

		for (const [index, swap] of swaps.entries()) {
			if (
				typeof swap.config_file !== "string" ||
				!fs.existsSync(path.join(repoRoot, swap.config_file))
			)
				missingConfigFiles.push({ index, configFile: swap.config_file });
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
			missingConfigFiles,
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
			missingConfigFiles: [],
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

	it("contains no legacy Omarchy theme-state path under configs", () => {
		const stalePath = Buffer.from("~/.config/omarchy/current");
		const staleFiles = filesBelow(path.join(repoRoot, "configs"))
			.filter((file) => fs.readFileSync(file).includes(stalePath))
			.map((file) => path.relative(repoRoot, file));

		expect(staleFiles).toEqual([]);
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
				unbind: 4,
				bind: 24,
				window: 24,
				workspace: 0,
				execOnStart: 2,
				env: 1,
			},
			"workspaces-laptop.lua": {
				unbind: 4,
				bind: 24,
				window: 24,
				workspace: 11,
				execOnStart: 2,
				env: 0,
			},
		});
	});

	it("does not treat hyprctl dispatch exit status as a failure signal", () => {
		const directory = fs.mkdtempSync(
			path.join(os.tmpdir(), "haoshoku-dispatch-failure-"),
		);
		temporaryDirectories.push(directory);
		const hyprctl = path.join(directory, "hyprctl");
		fs.writeFileSync(
			hyprctl,
			`#!/usr/bin/env bash
if [[ "$1" == "dispatch" ]]; then
  printf 'invalid dispatcher\n' >&2
  exit 0
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

		expect(result.exitCode).toBe(0);
		expect(result.stderr.toString()).toContain("invalid dispatcher");
	});
});

const temporaryDirectories = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});
