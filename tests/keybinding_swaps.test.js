import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.join(import.meta.dir, "..");
const configPath = path.join(repoRoot, "configs", "omarchy", "workspaces.conf");
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
const allowedReasons = new Set([
	"workspace_collision",
	"modifier_reordering",
	"displaced_by_app_launcher",
	"displaced_by_workspace_toggle",
]);
const swapsDocument = JSON.parse(fs.readFileSync(swapsPath, "utf8"));

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

let omarchyDefaultsAvailable = true;
try {
	fs.accessSync(omarchyBindingsPath, fs.constants.R_OK);
} catch {
	omarchyDefaultsAvailable = false;
}

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

	(omarchyDefaultsAvailable ? it : it.skip)(
		"aligns every swap with Omarchy defaults, including scratchpad special-workspace arguments",
		() => {
			const defaultBindings = fs
				.readdirSync(omarchyBindingsPath, { withFileTypes: true })
				.filter((entry) => entry.isFile() && entry.name.endsWith(".conf"))
				.flatMap((entry) =>
					fs
						.readFileSync(path.join(omarchyBindingsPath, entry.name), "utf8")
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

	for (const swap of swapsDocument.swaps) {
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
});
