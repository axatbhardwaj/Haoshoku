import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as hyprland from "../src/helpers/configure_hyprland.js";

describe("ensureLineInFile", () => {
	let tmpDir;
	let target;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-hypr-"));
		target = path.join(tmpDir, "hyprland.conf");
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("appends the line when missing and adds a trailing newline", () => {
		fs.writeFileSync(target, "monitor=,preferred,auto,1\n");
		const appended = hyprland.ensureLineInFile(
			target,
			"source = ~/.config/hypr-ocean/conf.d/*.conf",
		);
		expect(appended).toBe(true);
		expect(fs.readFileSync(target, "utf8")).toBe(
			"monitor=,preferred,auto,1\nsource = ~/.config/hypr-ocean/conf.d/*.conf\n",
		);
	});

	it("is a no-op when the line already exists", () => {
		fs.writeFileSync(
			target,
			"monitor=,preferred,auto,1\nsource = ~/.config/hypr-ocean/conf.d/*.conf\n",
		);
		const appended = hyprland.ensureLineInFile(
			target,
			"source = ~/.config/hypr-ocean/conf.d/*.conf",
		);
		expect(appended).toBe(false);
		expect(fs.readFileSync(target, "utf8")).toBe(
			"monitor=,preferred,auto,1\nsource = ~/.config/hypr-ocean/conf.d/*.conf\n",
		);
	});

	it("inserts a missing trailing newline before appending", () => {
		fs.writeFileSync(target, "monitor=,preferred,auto,1"); // no trailing newline
		hyprland.ensureLineInFile(
			target,
			"source = ~/.config/hypr-ocean/conf.d/*.conf",
		);
		expect(fs.readFileSync(target, "utf8")).toBe(
			"monitor=,preferred,auto,1\nsource = ~/.config/hypr-ocean/conf.d/*.conf\n",
		);
	});

	it("throws if the file does not exist", () => {
		expect(() =>
			hyprland.ensureLineInFile(path.join(tmpDir, "missing"), "x"),
		).toThrow();
	});
});

describe("checkoutPinnedCaelestia", () => {
	it("throws when the pinned checkout command fails", async () => {
		const commands = [];
		expect(typeof hyprland.checkoutPinnedCaelestia).toBe("function");

		await expect(
			hyprland.checkoutPinnedCaelestia({
				cloneDir: "/tmp/caelestia",
				pinnedSha: "abc123",
				run: async (command, options) => {
					commands.push({ command, options });
					return false;
				},
			}),
		).rejects.toThrow("Failed to checkout pinned Caelestia commit abc123");

		expect(commands).toEqual([
			{
				command: "git checkout abc123",
				options: { cwd: "/tmp/caelestia" },
			},
		]);
	});

	it("skips checkout when the pin is main", async () => {
		let called = false;

		expect(typeof hyprland.checkoutPinnedCaelestia).toBe("function");

		const checkedOut = await hyprland.checkoutPinnedCaelestia({
			cloneDir: "/tmp/caelestia",
			pinnedSha: "main",
			run: async () => {
				called = true;
				return true;
			},
		});

		expect(checkedOut).toBe(false);
		expect(called).toBe(false);
	});
});

describe("parseOceanPalette", () => {
	const fixturePath = path.join(__dirname, "fixtures", "ocean.colors");

	it("extracts section.key → r,g,b for plain triplet values", () => {
		const fixture = fs.readFileSync(fixturePath, "utf8");
		const palette = hyprland.parseOceanPalette(fixture);
		expect(palette["Colors:Button.DecorationFocus"]).toBe("0,169,165");
		expect(palette["Colors:Button.BackgroundNormal"]).toBe("18,21,31");
		expect(palette["General.DecorationFocus"]).toBe("0,169,165");
	});

	it("ignores comments, blank lines, and non-triplet values", () => {
		const text =
			"# comment\n\n[Colors:Window]\nBackgroundNormal=30,40,50\nFont=Inter,12,-1\n";
		const palette = hyprland.parseOceanPalette(text);
		expect(palette).toEqual({ "Colors:Window.BackgroundNormal": "30,40,50" });
	});
});

describe("kdeRgbToHyprlandRgba", () => {
	it("converts pure values to lowercase hex with alpha", () => {
		expect(hyprland.kdeRgbToHyprlandRgba("0,169,165")).toBe("rgba(00a9a5ff)");
		expect(hyprland.kdeRgbToHyprlandRgba("0,0,0", "80")).toBe("rgba(00000080)");
		expect(hyprland.kdeRgbToHyprlandRgba("18,21,31")).toBe("rgba(12151fff)");
	});

	it("throws on malformed input", () => {
		expect(() => hyprland.kdeRgbToHyprlandRgba("not-rgb")).toThrow();
		expect(() => hyprland.kdeRgbToHyprlandRgba("1,2")).toThrow();
	});
});
