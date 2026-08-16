import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const COMMON_DIR = path.join(PROJECT_ROOT, "common");

describe("Common Files", () => {
	it("should have the common directory", () => {
		expect(fs.existsSync(COMMON_DIR)).toBe(true);
	});

	const validFiles = ["paru_applist.txt", "flatpacks_arch.txt"];

	validFiles.forEach((file) => {
		it(`should contain ${file}`, () => {
			const filePath = path.join(COMMON_DIR, file);
			expect(fs.existsSync(filePath)).toBe(true);

			const content = fs.readFileSync(filePath, "utf-8").trim();
			expect(content.length).toBeGreaterThan(0);

			const lines = content.split("\n");
			lines.forEach((line, _index) => {
				if (line.trim() && !line.startsWith("#")) {
					// Check no leading whitespace
					expect(line.startsWith(" ")).toBe(false);
				}
			});
		});
	});

	it("does not install the retired Cohesion Flatpak", () => {
		const content = fs.readFileSync(
			path.join(COMMON_DIR, "flatpacks_arch.txt"),
			"utf-8",
		);
		expect(content).not.toContain("io.github.brunofin.Cohesion");
	});

	it("includes the KDE Connect backend required by the default omaconnect plugin", () => {
		const plugins = JSON.parse(
			fs.readFileSync(path.join(COMMON_DIR, "omarchy-plugins.json"), "utf-8"),
		);
		expect(plugins.some((plugin) => plugin.id === "omaconnect")).toBe(true);

		const packages = fs
			.readFileSync(path.join(COMMON_DIR, "paru_applist.txt"), "utf-8")
			.trim()
			.split("\n");
		expect(packages.filter((entry) => entry === "kdeconnect")).toEqual([
			"kdeconnect",
		]);
	});
});
