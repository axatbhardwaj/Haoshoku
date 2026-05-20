import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const ZED_CONFIG_DIR = path.join(PROJECT_ROOT, "configs", "zed");

describe("Zed Caelestia theme defaults", () => {
	it("selects Caelestia for both Zed theme modes", () => {
		const settingsPath = path.join(ZED_CONFIG_DIR, "settings.json");
		const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));

		expect(settings.theme).toEqual({
			mode: "system",
			light: "Caelestia",
			dark: "Caelestia",
		});
	});

	it("vendors a parseable Caelestia Zed theme", () => {
		const themePath = path.join(ZED_CONFIG_DIR, "themes", "caelestia.json");
		const theme = JSON.parse(fs.readFileSync(themePath, "utf8"));

		expect(theme.name).toBe("Caelestia");
		expect(theme.themes[0].name).toBe("Caelestia");
		expect(theme.themes[0].appearance).toBe("dark");
		expect(theme.themes[0].style["editor.background"]).toBe("#1E1E24");
		expect(theme.themes[0].style["border.focused"]).toBe("#24BD5C");
	});
});
