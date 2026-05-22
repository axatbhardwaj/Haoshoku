import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as hyprland from "../src/helpers/configure_hyprland.js";

// Helper: build a fake `run` that records every command and returns scripted booleans.
function makeRecorder(scriptedReturns = {}) {
	const calls = [];
	const run = async (command, options = {}) => {
		calls.push({ command, options });
		if (Object.hasOwn(scriptedReturns, command)) return scriptedReturns[command];
		// Default: succeed unless the test patched a specific command to fail.
		return true;
	};
	return { calls, run };
}

describe("checkoutPinnedCaelestia", () => {
	it("skips checkout when the pin is the literal 'main' (soft pin)", async () => {
		const { calls, run } = makeRecorder();
		const result = await hyprland.checkoutPinnedCaelestia({
			cloneDir: "/tmp/caelestia",
			pinnedSha: "main",
			run,
		});
		expect(result).toBe(false);
		expect(calls).toEqual([]);
	});

	it("rejects a non-hex SHA before invoking git (shell-injection guard)", async () => {
		const { calls, run } = makeRecorder();
		await expect(
			hyprland.checkoutPinnedCaelestia({
				cloneDir: "/tmp/caelestia",
				pinnedSha: "abc; rm -rf $HOME",
				run,
			}),
		).rejects.toThrow(/not a valid hex SHA/);
		expect(calls).toEqual([]);
	});

	it("invokes git checkout in the clone directory for a valid SHA", async () => {
		const { calls, run } = makeRecorder();
		const result = await hyprland.checkoutPinnedCaelestia({
			cloneDir: "/tmp/caelestia",
			pinnedSha: "abc1234",
			run,
		});
		expect(result).toBe(true);
		expect(calls).toEqual([
			{ command: "git checkout abc1234", options: { cwd: "/tmp/caelestia" } },
		]);
	});

	it("throws when git checkout fails", async () => {
		const { run } = makeRecorder({ "git checkout abc1234": false });
		await expect(
			hyprland.checkoutPinnedCaelestia({
				cloneDir: "/tmp/caelestia",
				pinnedSha: "abc1234",
				run,
			}),
		).rejects.toThrow(/Failed to checkout/);
	});
});

describe("recoverCaelestiaPackages", () => {
	it("returns true when the explicit leaf install succeeds on the first attempt", async () => {
		const { calls, run } = makeRecorder();
		const exists = async (cmd) => cmd === "caelestia";
		const result = await hyprland.recoverCaelestiaPackages({ run, exists });
		expect(result).toBe(true);
		// First attempt only — no mirror refresh or second attempt.
		expect(calls.map((c) => c.command)).toEqual([
			"paru -S --needed --noconfirm caelestia-cli caelestia-shell",
		]);
	});

	it("refreshes CachyOS mirrors + pacman db then retries when the first attempt fails", async () => {
		const { calls, run } = makeRecorder();
		// Each call to commandExists("caelestia") returns false until the second
		// install attempt — simulating the recovery path landing the binary.
		let existsCallCount = 0;
		const exists = async (cmd) => {
			if (cmd === "cachyos-rate-mirrors") return true;
			if (cmd === "caelestia") {
				existsCallCount += 1;
				return existsCallCount >= 2;
			}
			return false;
		};
		const result = await hyprland.recoverCaelestiaPackages({ run, exists });
		expect(result).toBe(true);
		expect(calls.map((c) => c.command)).toEqual([
			"paru -S --needed --noconfirm caelestia-cli caelestia-shell",
			"sudo cachyos-rate-mirrors",
			"sudo pacman -Syy --noconfirm",
			"paru -S --needed --noconfirm caelestia-cli caelestia-shell",
		]);
	});
});

describe("installCaelestia (slim 5.0.0 — Caelestia only, no Ocean overlay)", () => {
	let tmpHome;

	beforeEach(() => {
		tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-install-"));
	});

	afterEach(() => {
		fs.rmSync(tmpHome, { recursive: true, force: true });
	});

	// Helper: pre-seed a Caelestia clone so we exercise the "pull, don't clone" branch.
	function seedClone() {
		const cloneDir = path.join(tmpHome, ".local", "share", "caelestia");
		fs.mkdirSync(path.join(cloneDir, ".git"), { recursive: true });
		// install.fish is invoked unconditionally, so leave a placeholder file.
		fs.writeFileSync(path.join(cloneDir, "install.fish"), "#!/usr/bin/env fish\n");
		return cloneDir;
	}

	it("installs the Hyprland package set, clones Caelestia, runs install.fish (happy path)", async () => {
		const { calls, run } = makeRecorder();
		const exists = async (cmd) => cmd === "fish" || cmd === "caelestia";

		await hyprland.installCaelestia({ home: tmpHome, run, exists });

		const commands = calls.map((c) => c.command);
		// Must install the Hyprland packages.
		const hyprlandInstallCommand = commands.find((c) =>
			c.startsWith("sudo pacman -S --needed --noconfirm hyprland"),
		);
		expect(hyprlandInstallCommand).toBeDefined();
		expect(hyprlandInstallCommand.split(" ")).toContain("uwsm");
		// Must clone Caelestia (no .git existed) — clone uses HTTPS.
		expect(
			commands.some((c) => c.startsWith("git clone") && c.includes("caelestia")),
		).toBe(true);
		// Must run install.fish via `fish ...`.
		expect(commands.some((c) => c.startsWith("fish "))).toBe(true);
	});

	it("skips the Hyprland pacman install when skipHyprlandPackages is true", async () => {
		const { calls, run } = makeRecorder();
		const exists = async (cmd) => cmd === "fish" || cmd === "caelestia";

		await hyprland.installCaelestia({
			home: tmpHome,
			run,
			exists,
			skipHyprlandPackages: true,
		});

		const commands = calls.map((c) => c.command);
		// No pacman -S for hyprland.
		expect(
			commands.some((c) =>
				c.startsWith("sudo pacman -S --needed --noconfirm hyprland"),
			),
		).toBe(false);
		// But Caelestia still installs.
		expect(commands.some((c) => c.startsWith("fish "))).toBe(true);
	});

	it("pulls instead of cloning when Caelestia clone already exists (idempotent)", async () => {
		const cloneDir = seedClone();
		const { calls, run } = makeRecorder();
		const exists = async (cmd) => cmd === "fish" || cmd === "caelestia";

		await hyprland.installCaelestia({ home: tmpHome, run, exists });

		const commands = calls.map((c) => c.command);
		// Should NOT clone again.
		expect(commands.some((c) => c.startsWith("git clone"))).toBe(false);
		// Should pull in the existing clone.
		const pull = calls.find((c) => c.command === "git pull --ff-only");
		expect(pull).toBeDefined();
		expect(pull.options).toEqual({ cwd: cloneDir });
	});

	it("triggers recoverCaelestiaPackages when caelestia CLI is still missing after install.fish", async () => {
		const { calls, run } = makeRecorder();
		// `caelestia` exists only on the SECOND lookup — after recovery has run.
		let caelestiaLookups = 0;
		const exists = async (cmd) => {
			if (cmd === "fish") return true;
			if (cmd === "caelestia") {
				caelestiaLookups += 1;
				return caelestiaLookups >= 2;
			}
			return false;
		};

		await hyprland.installCaelestia({ home: tmpHome, run, exists });

		const commands = calls.map((c) => c.command);
		// Recovery's leaf install command should have fired.
		expect(
			commands.some(
				(c) => c === "paru -S --needed --noconfirm caelestia-cli caelestia-shell",
			),
		).toBe(true);
	});

	it("does NOT wire `source = ~/.config/hypr-ocean/conf.d/*.conf` into hypr-user.conf (5.0.0 regression guard)", async () => {
		const { run } = makeRecorder();
		const exists = async (cmd) => cmd === "fish" || cmd === "caelestia";

		await hyprland.installCaelestia({ home: tmpHome, run, exists });

		const userInclude = path.join(
			tmpHome,
			".config",
			"caelestia",
			"hypr-user.conf",
		);
		// File may have been pre-created as empty (Caelestia would do this lazily on first boot);
		// the important thing is that it does NOT contain the legacy Ocean source line.
		if (fs.existsSync(userInclude)) {
			const content = fs.readFileSync(userInclude, "utf8");
			expect(content).not.toContain("hypr-ocean");
			expect(content).not.toContain("source =");
		}
	});

	it("does NOT create ~/.config/hypr-ocean/ (5.0.0 regression guard)", async () => {
		const { run } = makeRecorder();
		const exists = async (cmd) => cmd === "fish" || cmd === "caelestia";

		await hyprland.installCaelestia({ home: tmpHome, run, exists });

		const oceanDir = path.join(tmpHome, ".config", "hypr-ocean");
		expect(fs.existsSync(oceanDir)).toBe(false);
	});

	it("creates Caelestia shell.json with 24-hour clock enabled", async () => {
		const { run } = makeRecorder();
		const exists = async (cmd) => cmd === "fish" || cmd === "caelestia";

		await hyprland.installCaelestia({ home: tmpHome, run, exists });

		const shellConfig = JSON.parse(
			fs.readFileSync(
				path.join(tmpHome, ".config", "caelestia", "shell.json"),
				"utf8",
			),
		);
		expect(shellConfig.services.useTwelveHourClock).toBe(false);
	});

	it("moves stock ~/.config/hypr aside before running install.fish", async () => {
		// Pre-seed a stock CachyOS hyprland.conf at ~/.config/hypr/ so the
		// installer's symlink step would otherwise skip silently.
		const stockHyprDir = path.join(tmpHome, ".config", "hypr");
		fs.mkdirSync(stockHyprDir, { recursive: true });
		fs.writeFileSync(
			path.join(stockHyprDir, "hyprland.conf"),
			"# CachyOS stock hyprland.conf — no hypr-user.conf source line\n",
		);

		const { run } = makeRecorder();
		const exists = async (cmd) => cmd === "fish" || cmd === "caelestia";

		await hyprland.installCaelestia({ home: tmpHome, run, exists });

		// Stock dir should now be a sibling .bak.<ts> rename, not at the original path.
		expect(fs.existsSync(stockHyprDir)).toBe(false);
		const backups = fs
			.readdirSync(path.join(tmpHome, ".config"))
			.filter((f) => f.startsWith("hypr.bak."));
		expect(backups.length).toBe(1);
		const stockContent = fs.readFileSync(
			path.join(tmpHome, ".config", backups[0], "hyprland.conf"),
			"utf8",
		);
		expect(stockContent).toContain("CachyOS stock");
	});

	it("does NOT move ~/.config/hypr aside when it's already a symlink into Caelestia's tree", async () => {
		const caelestiaCloneDir = path.join(
			tmpHome,
			".local",
			"share",
			"caelestia",
		);
		const caelestiaHyprDir = path.join(caelestiaCloneDir, "hypr");
		fs.mkdirSync(caelestiaHyprDir, { recursive: true });
		fs.mkdirSync(path.join(tmpHome, ".config"), { recursive: true });
		fs.symlinkSync(
			caelestiaHyprDir,
			path.join(tmpHome, ".config", "hypr"),
		);

		const { run } = makeRecorder();
		const exists = async (cmd) => cmd === "fish" || cmd === "caelestia";

		await hyprland.installCaelestia({ home: tmpHome, run, exists });

		// Symlink should still be there, no .bak siblings.
		const stats = fs.lstatSync(path.join(tmpHome, ".config", "hypr"));
		expect(stats.isSymbolicLink()).toBe(true);
		const backups = fs
			.readdirSync(path.join(tmpHome, ".config"))
			.filter((f) => f.startsWith("hypr.bak."));
		expect(backups.length).toBe(0);
	});

	it("moves a wrong-target symlink aside (defends against leftover state)", async () => {
		// Symlink pointing somewhere that isn't Caelestia's tree — should be
		// moved aside the same as a regular directory.
		const elsewhere = path.join(tmpHome, "elsewhere");
		fs.mkdirSync(elsewhere, { recursive: true });
		fs.mkdirSync(path.join(tmpHome, ".config"), { recursive: true });
		fs.symlinkSync(elsewhere, path.join(tmpHome, ".config", "hypr"));

		const { run } = makeRecorder();
		const exists = async (cmd) => cmd === "fish" || cmd === "caelestia";

		await hyprland.installCaelestia({ home: tmpHome, run, exists });

		expect(fs.existsSync(path.join(tmpHome, ".config", "hypr"))).toBe(false);
		const backups = fs
			.readdirSync(path.join(tmpHome, ".config"))
			.filter((f) => f.startsWith("hypr.bak."));
		expect(backups.length).toBe(1);
	});

	it("runs apply.sh via bash after caelestia-shell install (lockfix wiring)", async () => {
		const { calls, run } = makeRecorder();
		const exists = async (cmd) => cmd === "fish" || cmd === "caelestia";

		await hyprland.installCaelestia({ home: tmpHome, run, exists });

		const expectedScript = path.join(
			tmpHome,
			".local",
			"share",
			"caelestia-lockfix",
			"apply.sh",
		);
		// apply.sh must be invoked via `bash <absolute-path>` (no ~ expansion).
		const applyCall = calls.find((c) => c.command === `bash ${expectedScript}`);
		expect(applyCall).toBeDefined();

		// apply.sh must run AFTER install.fish (caelestia-shell is a prerequisite).
		const installFishIndex = calls.findIndex((c) =>
			c.command.startsWith("fish "),
		);
		const applyIndex = calls.indexOf(applyCall);
		expect(applyIndex).toBeGreaterThan(installFishIndex);
	});

	it("preserves existing Caelestia shell.json settings while forcing 24-hour clock", async () => {
		const shellConfigPath = path.join(
			tmpHome,
			".config",
			"caelestia",
			"shell.json",
		);
		fs.mkdirSync(path.dirname(shellConfigPath), { recursive: true });
		fs.writeFileSync(
			shellConfigPath,
			JSON.stringify({
				bar: { clock: { showDate: true } },
				services: { weatherLocation: "Bengaluru", useTwelveHourClock: true },
			}),
		);
		const { run } = makeRecorder();
		const exists = async (cmd) => cmd === "fish" || cmd === "caelestia";

		await hyprland.installCaelestia({ home: tmpHome, run, exists });

		const shellConfig = JSON.parse(fs.readFileSync(shellConfigPath, "utf8"));
		expect(shellConfig.bar.clock.showDate).toBe(true);
		expect(shellConfig.services.weatherLocation).toBe("Bengaluru");
		expect(shellConfig.services.useTwelveHourClock).toBe(false);
	});
});

describe("promptDesktopEnvironment", () => {
	function buildPromptFn(scriptedAnswer) {
		const calls = [];
		const fn = async (config) => {
			calls.push(config);
			return scriptedAnswer;
		};
		return { calls, fn };
	}

	it("auto-detects KDE from $XDG_CURRENT_DESKTOP and returns 'kde' when the user accepts", async () => {
		const { calls, fn } = buildPromptFn({ de: "kde" });
		const result = await hyprland.promptDesktopEnvironment({
			env: { XDG_CURRENT_DESKTOP: "KDE" },
			promptFn: fn,
		});
		expect(result).toBe("kde");
		// The prompt's `initial` should point at the KDE choice (so user just presses Enter).
		expect(calls).toHaveLength(1);
		expect(calls[0].choices[calls[0].initial].value).toBe("kde");
	});

	it("auto-detects Hyprland (case-insensitive) from $XDG_CURRENT_DESKTOP", async () => {
		const { calls, fn } = buildPromptFn({ de: "hyprland" });
		const result = await hyprland.promptDesktopEnvironment({
			env: { XDG_CURRENT_DESKTOP: "Hyprland" },
			promptFn: fn,
		});
		expect(result).toBe("hyprland");
		expect(calls[0].choices[calls[0].initial].value).toBe("hyprland");
	});

	it("falls back to 'other' as initial when the env value is unknown", async () => {
		const { calls, fn } = buildPromptFn({ de: "other" });
		await hyprland.promptDesktopEnvironment({
			env: { XDG_CURRENT_DESKTOP: "weirdWM" },
			promptFn: fn,
		});
		expect(calls[0].choices[calls[0].initial].value).toBe("other");
	});

	it("returns null when the user cancels (prompts returns empty)", async () => {
		const { fn } = buildPromptFn({});
		const result = await hyprland.promptDesktopEnvironment({
			env: { XDG_CURRENT_DESKTOP: "KDE" },
			promptFn: fn,
		});
		expect(result).toBeNull();
	});
});

describe("promptDeviceType", () => {
	let tmpDir;
	let configPath;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-device-"));
		configPath = path.join(tmpDir, ".haoshoku.json");
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function buildPromptFn(scriptedAnswer) {
		const fn = async () => scriptedAnswer;
		return fn;
	}

	it("persists 'pc' to ~/.haoshoku.json when the user picks Main PC", async () => {
		const result = await hyprland.promptDeviceType({
			configPath,
			promptFn: buildPromptFn({ device: "pc" }),
		});
		expect(result).toBe("pc");
		const persisted = JSON.parse(fs.readFileSync(configPath, "utf8"));
		expect(persisted.deviceType).toBe("pc");
	});

	it("persists 'laptop' to ~/.haoshoku.json when the user picks Laptop", async () => {
		const result = await hyprland.promptDeviceType({
			configPath,
			promptFn: buildPromptFn({ device: "laptop" }),
		});
		expect(result).toBe("laptop");
		expect(JSON.parse(fs.readFileSync(configPath, "utf8")).deviceType).toBe(
			"laptop",
		);
	});

	it("does NOT modify ~/.haoshoku.json when the user picks Skip", async () => {
		fs.writeFileSync(
			configPath,
			JSON.stringify({ skillSources: ["existing"] }, null, 2),
		);
		const before = fs.readFileSync(configPath, "utf8");
		const result = await hyprland.promptDeviceType({
			configPath,
			promptFn: buildPromptFn({ device: null }),
		});
		expect(result).toBeNull();
		expect(fs.readFileSync(configPath, "utf8")).toBe(before);
	});

	it("preserves existing config keys when persisting deviceType (merge, not overwrite)", async () => {
		fs.writeFileSync(
			configPath,
			JSON.stringify(
				{ skillSources: ["https://example.com/foo.git"], extra: 42 },
				null,
				2,
			),
		);
		await hyprland.promptDeviceType({
			configPath,
			promptFn: buildPromptFn({ device: "pc" }),
		});
		const persisted = JSON.parse(fs.readFileSync(configPath, "utf8"));
		expect(persisted.deviceType).toBe("pc");
		expect(persisted.skillSources).toEqual(["https://example.com/foo.git"]);
		expect(persisted.extra).toBe(42);
	});
});
