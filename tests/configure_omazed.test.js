import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureOmazed } from "../src/helpers/configure_omazed.js";

describe("configureOmazed", () => {
	let home;
	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-omazed-"));
	});
	afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

	it("skips when Omarchy or Omazed is unavailable", async () => {
		const commands = [];
		const result = await configureOmazed({
			home,
			commandExistsImpl: async (command) => command === "omarchy",
			runCommandImpl: async (command) => commands.push(command),
		});
		expect(result).toEqual({ configured: false, retiredLegacyTheme: false });
		expect(commands).toEqual([]);
	});

	it("runs packaged setup then retires only the legacy Caelestia theme", async () => {
		const themes = path.join(home, ".config", "zed", "themes");
		const settings = path.join(home, ".config", "zed", "settings.json");
		fs.mkdirSync(themes, { recursive: true });
		fs.writeFileSync(path.join(themes, "caelestia.json"), "legacy");
		fs.writeFileSync(path.join(themes, "personal.json"), "keep");
		fs.writeFileSync(
			settings,
			'{"theme":{"mode":"system","dark":"Caelestia"},"autosave":"on_focus_change"}\n',
		);
		const commands = [];
		const result = await configureOmazed({
			home,
			commandExistsImpl: async () => true,
			runCommandImpl: async (command) => {
				commands.push(command);
				expect(JSON.parse(fs.readFileSync(settings, "utf8")).theme).toBe(
					"Omazed",
				);
				return true;
			},
			now: () => 42,
		});
		expect(commands).toEqual(["omazed setup"]);
		expect(result).toEqual({ configured: true, retiredLegacyTheme: true });
		expect(fs.existsSync(path.join(themes, "caelestia.json"))).toBe(false);
		expect(fs.readFileSync(path.join(themes, "personal.json"), "utf8")).toBe(
			"keep",
		);
		expect(JSON.parse(fs.readFileSync(settings, "utf8"))).toMatchObject({
			theme: "Omazed",
			autosave: "on_focus_change",
		});
		expect(fs.existsSync(`${settings}.bak.42`)).toBe(true);
	});

	it("is idempotent after the legacy theme is gone", async () => {
		const options = {
			home,
			commandExistsImpl: async () => true,
			runCommandImpl: async () => true,
		};
		expect(await configureOmazed(options)).toEqual({
			configured: true,
			retiredLegacyTheme: false,
		});
		expect(await configureOmazed(options)).toEqual({
			configured: true,
			retiredLegacyTheme: false,
		});
	});

	it("keeps the legacy theme when packaged setup fails", async () => {
		const themes = path.join(home, ".config", "zed", "themes");
		const settings = path.join(home, ".config", "zed", "settings.json");
		fs.mkdirSync(themes, { recursive: true });
		fs.writeFileSync(path.join(themes, "caelestia.json"), "legacy");
		const original =
			'{"theme":{"dark":"Caelestia"},"autosave":"on_focus_change"}\n';
		fs.writeFileSync(settings, original);
		const result = await configureOmazed({
			home,
			commandExistsImpl: async () => true,
			runCommandImpl: async () => false,
		});
		expect(result).toEqual({ configured: false, retiredLegacyTheme: false });
		expect(fs.existsSync(path.join(themes, "caelestia.json"))).toBe(true);
		expect(fs.readFileSync(settings, "utf8")).toBe(original);
	});
});

describe("Omazed installer wiring", () => {
	it("includes the packaged Omarchy application", () => {
		const packages = fs
			.readFileSync(
				path.join(import.meta.dir, "..", "common", "paru_applist.txt"),
				"utf8",
			)
			.split(/\r?\n/);
		expect(packages).toContain("omazed");
	});

	it("configures Omazed only after Omarchy detection", () => {
		const installer = fs.readFileSync(
			path.join(import.meta.dir, "..", "src", "os_scripts", "cachyos.js"),
			"utf8",
		);
		expect(installer).toContain(
			'import { configureOmazed } from "../helpers/configure_omazed.js";',
		);
		expect(installer).toContain("if (isOmarchy) await configureOmazed();");
	});
});
