import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.join(import.meta.dir, "..");
const swaps = JSON.parse(
	fs.readFileSync(
		path.join(repoRoot, "configs", "omarchy", "keybinding-swaps.json"),
		"utf8",
	),
).swaps;
const allowedReasons = new Set([
	"workspace_collision",
	"modifier_reordering",
	"displaced_by_app_launcher",
	"displaced_by_workspace_toggle",
	"deleted_by_user",
	"reclaimed_by_overlay",
	"relocated_to_different_key",
	"superseded_by_workspace_toggle",
]);
const overlaySources = new Map(
	[
		"configs/omarchy/haoshoku/bindings.lua",
		"configs/omarchy/haoshoku/workspaces-pc.lua",
		"configs/omarchy/haoshoku/workspaces-laptop.lua",
	].map((configFile) => [configFile, sourceFor(configFile)]),
);

function sourceFor(configFile) {
	return fs.readFileSync(path.join(repoRoot, configFile), "utf8");
}

function luaChord(keyCombination) {
	const [modifiers, key] = keyCombination.split(", ");
	return `${modifiers.split(" ").join(" + ")} + ${key}`;
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

function sourceBindingIndex(source, chord) {
	return [...source.matchAll(/o\.bind\(\s*"([^"]+)"/g)].find(
		([, boundChord]) => canonicalLuaChord(boundChord) === canonicalLuaChord(chord),
	)?.index ?? -1;
}

function relocationBlock(source, chord) {
	const index = sourceBindingIndex(source, chord);
	return index < 0 ? "" : source.slice(index, index + 400);
}

const dispatcherSemantics = {
	exec: (block, swap) => block.includes(swap.moved_to_arg),
	fullscreen: (block) => block.includes("hl.dsp.window.fullscreen"),
	layoutmsg: (block, swap) => block.includes(`hl.dsp.layout("${swap.moved_to_arg}")`),
	pseudo: (block) => block.includes("hl.dsp.window.pseudo()"),
	togglegroup: (block) => block.includes("hl.dsp.group.toggle()"),
	togglefloating: (block) =>
		block.includes('hl.dsp.window.float({ action = "toggle" })'),
	togglespecialworkspace: (block, swap) =>
		block.includes(`hl.dsp.workspace.toggle_special("${swap.moved_to_arg}")`),
	killactive: (block) => block.includes("hl.dsp.window.close()"),
};

describe("Omarchy keybinding swaps", () => {
	it("routes every registry entry to a shipped Lua overlay", () => {
		const allowed = new Set([
			"configs/omarchy/haoshoku/bindings.lua",
			"configs/omarchy/haoshoku/workspaces-pc.lua",
			"configs/omarchy/haoshoku/workspaces-laptop.lua",
		]);

		for (const swap of swaps) {
			expect(allowed.has(swap.config_file), swap.key_combination_taken).toBe(
				true,
			);
			expect(fs.existsSync(path.join(repoRoot, swap.config_file))).toBe(true);
		}
	});

	it("keeps every recorded unbind in its owner Lua source", () => {
		for (const swap of swaps) {
			expect(sourceFor(swap.config_file), swap.key_combination_taken).toContain(
				swap.hl_unbind,
			);
		}
	});

	it("places each relocated replacement after its Lua unbind", () => {
		for (const swap of swaps.filter((swap) => swap.moved_to)) {
			const source = sourceFor(swap.config_file);
			const unbindIndex = source.indexOf(swap.hl_unbind);
			const replacement = sourceBindingIndex(source, luaChord(swap.moved_to));
			expect(unbindIndex, swap.key_combination_taken).toBeGreaterThan(-1);
			expect(replacement, swap.moved_to).toBeGreaterThan(unbindIndex);
		}
	});

	it("retains the registry schema and the dispatcher semantics of every relocation", () => {
		for (const swap of swaps) {
			expect(allowedReasons.has(swap.reason), swap.key_combination_taken).toBe(
				true,
			);
			expect(swap.previous_binding).toEqual(expect.any(String));
			expect(swap.moved_from_dispatcher).toEqual(expect.any(String));
			expect(swap.moved_from_arg).toEqual(expect.any(String));

			if (!swap.moved_to) {
				expect(swap.moved_to_dispatcher).toBeUndefined();
				expect(swap.moved_to_arg).toBeUndefined();
				continue;
			}

			expect(swap.moved_to_dispatcher).toEqual(expect.any(String));
			expect(swap.moved_to_arg).toEqual(expect.any(String));
			const semantic = dispatcherSemantics[swap.moved_to_dispatcher];
			expect(semantic, swap.moved_to_dispatcher).toEqual(expect.any(Function));
			expect(
				semantic(
					relocationBlock(sourceFor(swap.config_file), luaChord(swap.moved_to)),
					swap,
				),
				swap.key_combination_taken,
			).toBe(true);
		}
	});

	it("keeps same-chord reclaimed and superseded bindings after their unbinds", () => {
		for (const swap of swaps.filter(
			(swap) =>
				swap.reason === "reclaimed_by_overlay" ||
				swap.reason === "superseded_by_workspace_toggle",
		)) {
			const chord = swap.hl_unbind.match(/^hl\.unbind\("([^"]+)"\)$/)?.[1];
			const ownerSource = sourceFor(swap.config_file);
			const ownerUnbind = ownerSource.indexOf(swap.hl_unbind);
			const localReplacement = sourceBindingIndex(ownerSource, chord);
			const laterOwnerReplacement = localReplacement > ownerUnbind;
			const workspaceReplacement = [
				"configs/omarchy/haoshoku/workspaces-pc.lua",
				"configs/omarchy/haoshoku/workspaces-laptop.lua",
			].some((configFile) => sourceBindingIndex(overlaySources.get(configFile), chord) >= 0);

			expect(ownerUnbind, swap.key_combination_taken).toBeGreaterThan(-1);
			expect(
				laterOwnerReplacement || workspaceReplacement,
				swap.key_combination_taken,
			).toBe(true);
		}
	});
});
