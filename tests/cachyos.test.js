import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
	installGamingPackages,
	resolveAurHelper,
	selectArchInstallCommand,
} from "../src/os_scripts/cachyos.js";

describe("Arch package routing", () => {
	it("prefers yay and falls back to paru", async () => {
		expect(
			await resolveAurHelper(async (command) =>
				["yay", "paru"].includes(command),
			),
		).toBe("yay");
		expect(await resolveAurHelper(async (command) => command === "paru")).toBe(
			"paru",
		);
		expect(await resolveAurHelper(async () => false)).toBeNull();
	});

	it("uses pacman for repository packages and the selected helper for AUR", () => {
		expect(selectArchInstallCommand("fish", true, "yay")).toBe(
			"sudo pacman -S --needed --noconfirm fish",
		);
		expect(selectArchInstallCommand("protonup-rs-bin", false, "yay")).toBe(
			"yay -S --needed --noconfirm protonup-rs-bin",
		);
		expect(selectArchInstallCommand("missing", false, null)).toBeNull();
	});
});

describe("portable gaming setup", () => {
	it("installs the portable package set and Omarchy GPU support", async () => {
		const commands = [];
		const result = await installGamingPackages({
			aurHelper: "yay",
			isOmarchy: true,
			commandExistsImpl: async (name) =>
				name === "omarchy-install-gaming-gpu-lib32",
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});

		expect(commands).toEqual([
			"sudo pacman -S --needed --noconfirm steam gamemode lib32-gamemode gamescope mangohud lib32-mangohud",
			"yay -S --needed --noconfirm protonup-rs-bin",
			"omarchy-install-gaming-gpu-lib32",
		]);
		expect(result).toBe(true);
	});

	it("does not guess GPU packages outside Omarchy", async () => {
		const commands = [];
		await installGamingPackages({
			aurHelper: "paru",
			isOmarchy: false,
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});
		expect(commands).toHaveLength(2);
	});
});

describe("Omarchy-owned defaults", () => {
	it("keeps KDE, Fish, and appearance packages out of the application list", () => {
		const packages = fs.readFileSync(
			path.resolve(import.meta.dir, "..", "common", "paru_applist.txt"),
			"utf8",
		);
		for (const removed of [
			"fish",
			"partitionmanager",
			"dolphin",
			"kvantum",
			"okular",
			"merkuro",
		]) {
			expect(packages.split(/\s+/)).not.toContain(removed);
		}
	});
});
