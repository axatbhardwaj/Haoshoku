import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.join(import.meta.dir, "..");
const configPath = path.join(repoRoot, "configs", "omarchy", "workspaces.conf");
const bindingsConfigPath = path.join(
	repoRoot,
	"configs",
	"omarchy",
	"bindings.conf",
);
const swapsPath = path.join(
	repoRoot,
	"configs",
	"omarchy",
	"keybinding-swaps.json",
);
const omarchyBindingsPath = path.join(
	process.env.HOME ?? "",
	".local",
	"share",
	"omarchy",
	"default",
	"hypr",
	"bindings",
);
const omarchyAppBindingsPath = path.join(
	process.env.HOME ?? "",
	".local",
	"share",
	"omarchy",
	"config",
	"hypr",
	"bindings.conf",
);
const allowedReasons = new Set([
	"workspace_collision",
	"modifier_reordering",
	"displaced_by_app_launcher",
	"displaced_by_workspace_toggle",
	"deleted_by_user",
	"reclaimed_by_overlay",
	"superseded_by_workspace_toggle",
]);
const swapsDocument = JSON.parse(fs.readFileSync(swapsPath, "utf8"));
// These workspace toggles intentionally stack with Omarchy's numbered binds.
const intentionalAdditiveBindings = new Set([
	canonicalKeyCombination("SUPER", "code:11"),
	canonicalKeyCombination("SUPER", "code:13"),
	canonicalKeyCombination("SUPER", "code:14"),
	canonicalKeyCombination("SUPER", "code:19"),
]);
// Stock app binds intentionally left unchanged must be listed here with a reason.
// There are currently none: every stock key is explicitly rebound or unbound.
const intentionalStockAppBindings = new Set([]);

function repoConfigPath(configFile) {
	if (
		typeof configFile !== "string" ||
		configFile.startsWith("~") ||
		path.isAbsolute(configFile)
	)
		return null;

	const resolved = path.resolve(repoRoot, configFile);
	const relative = path.relative(repoRoot, resolved);
	return relative.startsWith("..") || path.isAbsolute(relative)
		? null
		: resolved;
}

function parseBinding(binding) {
	const fields = binding.split(",").map((field) => field.trim());
	return {
		keyCombination: `${fields[0].replace(/^bindd?\s*=\s*/, "")}, ${fields[1]}`,
		description: fields[2],
		dispatcher: fields[3],
		argument: fields.slice(4).join(", "),
	};
}

function relocatedBinding(swap) {
	const description = parseBinding(swap.previous_binding).description;
	const argument = swap.moved_to_arg ? `, ${swap.moved_to_arg}` : "";
	return `bindd = ${swap.moved_to}, ${description}, ${swap.moved_to_dispatcher}${argument}`;
}

function canonicalKeyCombination(modifiers, key) {
	return `${modifiers.trim().split(/\s+/).toSorted().join(" ")}, ${key.trim()}`;
}

function bindingOperation(line) {
	const match = line.match(/^(unbind|bindd?)\s*=\s*([^,]+),\s*([^,]+)/);
	if (!match) return null;
	return {
		type: match[1],
		keyCombination: canonicalKeyCombination(match[2], match[3]),
	};
}

function resurrectedStockBindings(defaultLines, overlayText) {
	const overlayKeys = new Set(
		overlayText
			.split(/\r?\n/)
			.map(bindingOperation)
			.filter(Boolean)
			.map((operation) => operation.keyCombination),
	);
	return defaultLines.flatMap((line) => {
		const operation = bindingOperation(line);
		if (
			!operation ||
			operation.type === "unbind" ||
			overlayKeys.has(operation.keyCombination) ||
			intentionalStockAppBindings.has(operation.keyCombination)
		)
			return [];
		return [{ keyCombination: operation.keyCombination, stockBinding: line }];
	});
}

function omarchyDefaultBindingLines() {
	const defaultConfigFiles = fs
		.readdirSync(omarchyBindingsPath, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".conf"))
		.map((entry) => path.join(omarchyBindingsPath, entry.name));
	defaultConfigFiles.unshift(omarchyAppBindingsPath);
	return defaultConfigFiles.flatMap((configFile) =>
		fs.readFileSync(configFile, "utf8").split(/\r?\n/),
	);
}

function duplicateBindings(defaultLines, overlayTexts) {
	const active = new Map();
	for (const line of defaultLines) {
		const operation = bindingOperation(line);
		if (operation?.type === "bind" || operation?.type === "bindd")
			active.set(operation.keyCombination, line);
	}

	const duplicates = [];
	for (const overlay of overlayTexts) {
		for (const line of overlay.split(/\r?\n/)) {
			const operation = bindingOperation(line);
			if (!operation) continue;
			if (operation.type === "unbind") {
				active.delete(operation.keyCombination);
				continue;
			}
			if (
				active.has(operation.keyCombination) &&
				!intentionalAdditiveBindings.has(operation.keyCombination)
			) {
				duplicates.push({
					keyCombination: operation.keyCombination,
					previous: active.get(operation.keyCombination),
					duplicate: line,
				});
			}
			active.set(operation.keyCombination, line);
		}
	}
	return duplicates;
}

function expectNoDuplicateBindings(defaultLines, overlayTexts) {
	expect(duplicateBindings(defaultLines, overlayTexts)).toEqual([]);
}

let omarchyDefaultsAvailable = true;
try {
	fs.accessSync(omarchyBindingsPath, fs.constants.R_OK);
	fs.accessSync(omarchyAppBindingsPath, fs.constants.R_OK);
} catch {
	omarchyDefaultsAvailable = false;
}
if (!omarchyDefaultsAvailable)
	console.info(
		"Skipping Omarchy duplicate-key checks: stock binding paths are unavailable.",
	);
const omarchyAppBindingsAvailable = fs.existsSync(omarchyAppBindingsPath);
if (!omarchyAppBindingsAvailable)
	console.info(
		`Skipping Omarchy stock-bind resurrection check: seed file is unavailable at ${omarchyAppBindingsPath}.`,
	);

describe("Omarchy keybinding swaps", () => {
	it("keeps the scratchpad special-workspace relocation faithful", () => {
		const scratchpadSwap = swapsDocument.swaps.find(
			(swap) => swap.key_combination_taken === "SUPER, S",
		);
		const relocatedLine = fs
			.readFileSync(configPath, "utf8")
			.split("\n")
			.find((line) => line.startsWith(`bindd = ${scratchpadSwap.moved_to},`));

		expect({
			previousBinding: scratchpadSwap.previous_binding,
			movedFrom: `${scratchpadSwap.moved_from_dispatcher}, ${scratchpadSwap.moved_from_arg}`,
			movedTo: `${scratchpadSwap.moved_to_dispatcher}, ${scratchpadSwap.moved_to_arg}`,
			configured: relocatedLine,
		}).toEqual({
			previousBinding:
				"bindd = SUPER, S, Toggle scratchpad, togglespecialworkspace, scratchpad",
			movedFrom: "togglespecialworkspace, scratchpad",
			movedTo: "togglespecialworkspace, scratchpad",
			configured:
				"bindd = SUPER CTRL SHIFT, S, Toggle scratchpad, togglespecialworkspace, scratchpad",
		});
	});

	it("validates every swap against the extensible registry schema", () => {
		expect(Number.isInteger(swapsDocument.schema_version)).toBe(true);
		expect(swapsDocument.schema_version).toBeGreaterThan(0);
		expect(Array.isArray(swapsDocument.swaps)).toBe(true);

		for (const swap of swapsDocument.swaps) {
			expect(swap.config_file).toEqual(expect.any(String));
			expect(swap.config_file.length).toBeGreaterThan(0);
			expect(swap.previous_binding).toEqual(expect.any(String));
			expect(swap.previous_binding.length).toBeGreaterThan(0);
			expect(swap.key_combination_taken).toEqual(expect.any(String));
			expect(swap.key_combination_taken.length).toBeGreaterThan(0);
			expect(swap.key_combination_taken).toMatch(/^[A-Z]+(?: [A-Z]+)*, \S+$/);
			if (
				swap.reason === "deleted_by_user" ||
				swap.reason === "reclaimed_by_overlay" ||
				swap.reason === "superseded_by_workspace_toggle"
			) {
				expect(swap.moved_to).toBeUndefined();
				expect(swap.moved_to_dispatcher).toBeUndefined();
				expect(swap.moved_to_arg).toBeUndefined();
				expect(swap.moved_from_dispatcher).toEqual(expect.any(String));
				expect(swap.moved_from_dispatcher.length).toBeGreaterThan(0);
				expect(swap.moved_from_arg).toEqual(expect.any(String));
				expect(allowedReasons.has(swap.reason)).toBe(true);
				continue;
			}
			expect(swap.moved_to).toEqual(expect.any(String));
			expect(swap.moved_to.length).toBeGreaterThan(0);
			expect(swap.moved_to).toMatch(/^[A-Z]+(?: [A-Z]+)*, \S+$/);
			expect(swap.moved_from_dispatcher).toEqual(expect.any(String));
			expect(swap.moved_from_dispatcher.length).toBeGreaterThan(0);
			expect(swap.moved_to_dispatcher).toEqual(expect.any(String));
			expect(swap.moved_to_dispatcher.length).toBeGreaterThan(0);
			expect(swap.moved_from_arg).toEqual(expect.any(String));
			expect(swap.moved_to_arg).toEqual(expect.any(String));
			expect(allowedReasons.has(swap.reason)).toBe(true);
		}

		const externalSwapCount = swapsDocument.swaps.filter(
			(swap) => !repoConfigPath(swap.config_file),
		).length;
		console.info(
			`Keybinding registry: ${swapsDocument.swaps.length} swaps total; ${externalSwapCount} external ordering checks skipped`,
		);
	});

	it("records the direct ChatGPT launcher as deleted while preserving Grok", () => {
		const deletedChatgpt = swapsDocument.swaps.find(
			(swap) => swap.key_combination_taken === "SUPER SHIFT, A",
		);
		expect(deletedChatgpt).toEqual({
			config_file: "configs/omarchy/bindings.conf",
			key_combination_taken: "SUPER SHIFT, A",
			previous_binding:
				'bindd = SUPER SHIFT, A, ChatGPT, exec, omarchy-launch-webapp "https://chatgpt.com"',
			moved_from_dispatcher: "exec",
			moved_from_arg: 'omarchy-launch-webapp "https://chatgpt.com"',
			reason: "deleted_by_user",
		});

		const bindings = fs.readFileSync(bindingsConfigPath, "utf8");
		expect(bindings).toContain("unbind = SUPER SHIFT, A");
		expect(bindings).not.toContain(deletedChatgpt?.previous_binding);
		expect(bindings).toContain(
			'bindd = SUPER SHIFT ALT, A, Grok, exec, omarchy-launch-webapp "https://grok.com"',
		);
	});

	(omarchyDefaultsAvailable ? it : it.skip)(
		"aligns every swap with Omarchy defaults, including scratchpad special-workspace arguments",
		() => {
			const defaultConfigFiles = fs
				.readdirSync(omarchyBindingsPath, { withFileTypes: true })
				.filter((entry) => entry.isFile() && entry.name.endsWith(".conf"))
				.map((entry) => path.join(omarchyBindingsPath, entry.name));
			if (fs.existsSync(omarchyAppBindingsPath))
				defaultConfigFiles.push(omarchyAppBindingsPath);
			const defaultBindings = defaultConfigFiles.flatMap((configFile) =>
				fs
					.readFileSync(configFile, "utf8")
					.split("\n")
					.map((line) => line.trim())
					.filter((line) => /^bindd?\s*=/.test(line))
					.map((line) => line.replace(/,\s*#.*$/, "").replace(/,\s*$/, "")),
			);

			for (const swap of swapsDocument.swaps) {
				const recorded = parseBinding(swap.previous_binding);
				const omarchyBinding = defaultBindings.find((binding) => {
					const parsed = parseBinding(binding);
					return (
						parsed.keyCombination === recorded.keyCombination &&
						parsed.description === recorded.description
					);
				});
				expect(omarchyBinding).toBeDefined();
				const omarchy = parseBinding(omarchyBinding);

				expect(swap.previous_binding).toBe(omarchyBinding);
				expect(swap.moved_from_dispatcher).toBe(omarchy.dispatcher);
				expect(swap.moved_from_arg).toBe(omarchy.argument);
			}
		},
	);

	const swapsByRepoConfig = Map.groupBy(
		swapsDocument.swaps.filter((swap) => repoConfigPath(swap.config_file)),
		(swap) => swap.config_file,
	);
	for (const [configFile, swaps] of swapsByRepoConfig) {
		it(`documents every unbind in ${configFile}`, () => {
			const config = fs.readFileSync(repoConfigPath(configFile), "utf8");
			const unbinds = [...config.matchAll(/^unbind\s*=\s*(.+)$/gm)].map(
				([, combination]) => combination.trim(),
			);
			const documented = swaps.map((swap) => swap.key_combination_taken);
			expect(documented.toSorted()).toEqual(unbinds.toSorted());
		});
	}

	it("keeps every deleted_by_user key unbound across both overlays", () => {
		const overlays = [
			["configs/omarchy/bindings.conf", bindingsConfigPath],
			["configs/omarchy/workspaces.conf", configPath],
		];

		for (const swap of swapsDocument.swaps.filter(
			(swap) => swap.reason === "deleted_by_user",
		)) {
			const deletedKey = bindingOperation(
				`unbind = ${swap.key_combination_taken}`,
			).keyCombination;
			const reboundLines = overlays.flatMap(([configFile, overlayPath]) =>
				fs
					.readFileSync(overlayPath, "utf8")
					.split(/\r?\n/)
					.flatMap((line, index) => {
						const operation = bindingOperation(line);
						return operation?.type !== "unbind" &&
							operation?.keyCombination === deletedKey
							? [`${configFile}:${index + 1}: ${line}`]
							: [];
					}),
			);
			const unboundLines = fs
				.readFileSync(repoConfigPath(swap.config_file), "utf8")
				.split(/\r?\n/)
				.filter((line) => {
					const operation = bindingOperation(line);
					return (
						operation?.type === "unbind" &&
						operation.keyCombination === deletedKey
					);
				});

			expect(unboundLines).toEqual([`unbind = ${swap.key_combination_taken}`]);
			expect(reboundLines).toEqual([]);
		}
	});

	it("records every migrated app-binding unbind", () => {
		const config = fs.existsSync(bindingsConfigPath)
			? fs.readFileSync(bindingsConfigPath, "utf8")
			: "";
		const unbinds = [...config.matchAll(/^unbind\s*=\s*(.+)$/gm)]
			.map(([, combination]) => combination.trim())
			.toSorted();
		const documented = swapsDocument.swaps
			.filter((swap) => swap.config_file === "configs/omarchy/bindings.conf")
			.map((swap) => swap.key_combination_taken)
			.toSorted();

		expect(documented).toEqual(unbinds);
	});

	(omarchyAppBindingsAvailable ? it : it.skip)(
		"requires every stock app bind to be rebound, unbound, or allowlisted",
		() => {
			const stockBindings = fs
				.readFileSync(omarchyAppBindingsPath, "utf8")
				.split(/\r?\n/);
			const overlay = fs.readFileSync(bindingsConfigPath, "utf8");

			expect(resurrectedStockBindings(stockBindings, overlay)).toEqual([]);
		},
	);

	(omarchyDefaultsAvailable ? it : it.skip)(
		"detects a removed unbind and accepts the restored overlay",
		() => {
			const defaults = omarchyDefaultBindingLines();
			const bindingsOverlay = fs.readFileSync(bindingsConfigPath, "utf8");
			const workspacesOverlay = fs.readFileSync(configPath, "utf8");
			const mutatedOverlay = bindingsOverlay.replace(
				"unbind = SUPER, RETURN\n",
				"",
			);

			expect(mutatedOverlay).not.toBe(bindingsOverlay);
			expect(() =>
				expectNoDuplicateBindings(defaults, [
					mutatedOverlay,
					workspacesOverlay,
				]),
			).toThrow("SUPER, RETURN");
			expect(() =>
				expectNoDuplicateBindings(defaults, [
					bindingsOverlay,
					workspacesOverlay,
				]),
			).not.toThrow();
			console.info(
				"Mutation proof: removing SUPER, RETURN unbind fails with SUPER, RETURN; restoring it passes.",
			);
		},
	);

	(omarchyDefaultsAvailable ? it : it.skip)(
		"prevents duplicate keys when app and workspace overlays follow Omarchy defaults",
		() => {
			expectNoDuplicateBindings(omarchyDefaultBindingLines(), [
				fs.readFileSync(bindingsConfigPath, "utf8"),
				fs.readFileSync(configPath, "utf8"),
			]);
		},
	);

	for (const swap of swapsDocument.swaps.filter((swap) => swap.moved_to)) {
		const resolvedConfigPath = repoConfigPath(swap.config_file);
		if (!resolvedConfigPath) {
			it.skip(`skips repo ordering checks for external swap ${swap.config_file} ${swap.key_combination_taken}`, () => {});
			continue;
		}

		it(`orders the unbind and relocation before the claimed ${swap.key_combination_taken} slot`, () => {
			const lines = fs.readFileSync(resolvedConfigPath, "utf8").split("\n");
			const unbindIndex = lines.indexOf(
				`unbind = ${swap.key_combination_taken}`,
			);
			const relocationIndex = lines.indexOf(relocatedBinding(swap));
			const claimedSlotIndex = lines.findIndex((line) =>
				line.startsWith(`bindd = ${swap.key_combination_taken},`),
			);

			expect(unbindIndex).toBeGreaterThan(-1);
			expect(relocationIndex).toBe(unbindIndex + 1);
			expect(claimedSlotIndex).toBeGreaterThan(relocationIndex);
		});
	}

	for (const swap of swapsDocument.swaps.filter(
		(swap) => swap.reason === "reclaimed_by_overlay",
	)) {
		it(`orders the unbind before reclaimed ${swap.key_combination_taken}`, () => {
			const lines = fs
				.readFileSync(repoConfigPath(swap.config_file), "utf8")
				.split("\n");
			const unbindIndex = lines.indexOf(
				`unbind = ${swap.key_combination_taken}`,
			);
			const claimedSlotIndex = lines.findIndex((line) => {
				const operation = bindingOperation(line);
				return (
					operation?.type !== "unbind" &&
					operation?.keyCombination === swap.key_combination_taken
				);
			});

			expect(unbindIndex).toBeGreaterThan(-1);
			if (claimedSlotIndex >= 0) {
				expect(claimedSlotIndex).toBe(unbindIndex + 1);
				return;
			}

			const workspaceClaim = fs
				.readFileSync(configPath, "utf8")
				.split("\n")
				.find((line) => {
					const operation = bindingOperation(line);
					return (
						operation?.type !== "unbind" &&
						operation?.keyCombination === swap.key_combination_taken
					);
				});
			expect(workspaceClaim).toBeDefined();
		});
	}

	for (const swap of swapsDocument.swaps.filter(
		(swap) => swap.reason === "superseded_by_workspace_toggle",
	)) {
		it(`orders the unbind before the replacement ${swap.key_combination_taken} workspace toggle`, () => {
			const bindingLines = fs
				.readFileSync(repoConfigPath(swap.config_file), "utf8")
				.split("\n");
			const workspaceLines = fs.readFileSync(configPath, "utf8").split("\n");
			const unbindIndex = bindingLines.indexOf(
				`unbind = ${swap.key_combination_taken}`,
			);
			const staleBindIndex = bindingLines.findIndex((line) =>
				line.startsWith(`bindd = ${swap.key_combination_taken},`),
			);
			const replacementIndex = workspaceLines.findIndex((line) =>
				line.startsWith(`bindd = ${swap.key_combination_taken},`),
			);

			expect(unbindIndex).toBeGreaterThan(-1);
			expect(staleBindIndex).toBe(-1);
			expect(replacementIndex).toBeGreaterThan(-1);
		});
	}
});
