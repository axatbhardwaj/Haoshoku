import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
	ensureRustToolchain,
	installGamingPackages,
	normalizeArchPackageNames,
	prepareArchPackageManager,
	resolveAurHelper,
	runCachyOSSetup,
	selectArchInstallCommand,
} from "../src/os_scripts/cachyos.js";

describe("Rust toolchain preparation", () => {
	it("preserves Rust when rustc and cargo are already available", async () => {
		const commands = [];
		const result = await ensureRustToolchain({
			commandExistsImpl: async (command) =>
				command === "rustc" || command === "cargo",
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
			withSpinnerImpl: async (_label, operation) => operation(),
		});

		expect(result).toBe(true);
		expect(commands).toEqual([]);
	});

	for (const { availableCommand, missingCommand } of [
		{ availableCommand: "rustc", missingCommand: "cargo" },
		{ availableCommand: "cargo", missingCommand: "rustc" },
	]) {
		it(`installs Rust when ${missingCommand} is missing`, async () => {
			const commands = [];
			const result = await ensureRustToolchain({
				commandExistsImpl: async (command) => command === availableCommand,
				runCommandImpl: async (command) => {
					commands.push(command);
					return true;
				},
				withSpinnerImpl: async (_label, operation) => operation(),
			});

			expect(result).toBe(true);
			expect(commands).toEqual([
				"curl https://sh.rustup.rs -sSf | sh -s -- -y",
			]);
		});
	}

	it("reports failure when rustup fails", async () => {
		const result = await ensureRustToolchain({
			commandExistsImpl: async () => false,
			runCommandImpl: async () => false,
			withSpinnerImpl: async (_label, operation) => operation(),
		});

		expect(result).toBe(false);
	});
});

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

describe("Arch package-list normalization", () => {
	it("trims, deduplicates, and preserves first-seen order", () => {
		expect(
			normalizeArchPackageNames([
				" chromium ",
				"visual-studio-code-bin",
				"chromium",
				"bun-bin",
			]),
		).toEqual({
			valid: ["chromium", "visual-studio-code-bin", "bun-bin"],
			invalid: [],
		});
	});

	it("rejects empty and shell-active package names", () => {
		expect(
			normalizeArchPackageNames([
				"",
				"   ",
				"good_pkg+git@source",
				"bad package",
				"bad;touch-/tmp/pwned",
				"$(bad)",
			]),
		).toEqual({
			valid: ["good_pkg+git@source"],
			invalid: ["", "bad package", "bad;touch-/tmp/pwned", "$(bad)"],
		});
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

describe("Arch package-manager preflight", () => {
	it("fully upgrades before installing essential build dependencies", async () => {
		const commands = [];
		const result = await prepareArchPackageManager({
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});

		expect(result).toBe(true);
		expect(commands).toEqual([
			"sudo pacman -Syu --noconfirm",
			"sudo pacman -S --needed --noconfirm base-devel git",
		]);
	});

	it("does not install dependencies when the full upgrade fails", async () => {
		const commands = [];
		const result = await prepareArchPackageManager({
			runCommandImpl: async (command) => {
				commands.push(command);
				return false;
			},
		});

		expect(result).toBe(false);
		expect(commands).toEqual(["sudo pacman -Syu --noconfirm"]);
	});

	it("reports failure when essential dependencies cannot be installed", async () => {
		let attempt = 0;
		const result = await prepareArchPackageManager({
			runCommandImpl: async () => {
				attempt += 1;
				return attempt === 1;
			},
		});

		expect(result).toBe(false);
	});

	it("stops the full setup when package-manager preparation fails", async () => {
		let preflightCalls = 0;
		const result = await runCachyOSSetup({
			prepareArchPackageManagerImpl: async () => {
				preflightCalls += 1;
				return false;
			},
		});

		expect(result).toBe(false);
		expect(preflightCalls).toBe(1);
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

	it("uses Chromium as the only managed browser", () => {
		const packages = fs
			.readFileSync(
				path.resolve(import.meta.dir, "..", "common", "paru_applist.txt"),
				"utf8",
			)
			.split(/\r?\n/);
		expect(packages).toContain("chromium");
		for (const retired of [
			"brave-bin",
			"floorp-bin",
			"google-chrome",
			"thorium-browser-avx2-bin",
		]) {
			expect(packages).not.toContain(retired);
		}
	});

	it("keeps optional gaming packages behind the gaming prompt", () => {
		const packages = fs
			.readFileSync(
				path.resolve(import.meta.dir, "..", "common", "paru_applist.txt"),
				"utf8",
			)
			.split(/\s+/);
		expect(packages).not.toContain("protonup-rs-bin");
		expect(packages).not.toContain("steam-native-runtime");
	});
});
