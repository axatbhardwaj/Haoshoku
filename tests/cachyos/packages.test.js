import { describe, expect, it } from "bun:test";
import { getInstalledPackages, installArchPackageBatch, installGamingPackages, installSystemPackages, normalizeArchPackageNames, resolveAurHelper, selectArchInstallCommand } from "../../src/os_scripts/cachyos.js";

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
			"sudo -n pacman -S --needed --noconfirm fish",
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

	it("rejects option-like and hidden-path-like package names", () => {
		expect(
			normalizeArchPackageNames(["--help", ".hidden", "valid-package"]),
		).toEqual({
			valid: ["valid-package"],
			invalid: ["--help", ".hidden"],
		});
	});
});

describe("installed package snapshots", () => {
	it("discards partial output when pacman exits nonzero", async () => {
		const result = await getInstalledPackages(() => ({
			stdout: new Response("partial-package\n").body,
			exited: Promise.resolve(1),
		}));

		expect(result).toEqual(new Set());
	});
});

describe("batched Arch package installation", () => {
	it("does not query or execute option-like package names", async () => {
		const metadataQueries = [];
		const commands = [];
		const result = await installArchPackageBatch(
			["--help", ".hidden", "repo-one"],
			{
				aurHelper: "yay",
				getInstalledPackagesImpl: async () => new Set(),
				packageInRepositoryImpl: async (pkg) => {
					metadataQueries.push(pkg);
					return true;
				},
				packageInAurImpl: async () => true,
				runCommandImpl: async (command) => {
					commands.push(command);
					return true;
				},
			},
		);

		expect(metadataQueries).toEqual(["repo-one"]);
		expect(commands).toEqual([
			"sudo -n pacman -S --needed --noconfirm repo-one",
		]);
		expect(result.invalid).toEqual(["--help", ".hidden"]);
	});

	it("skips installed targets and uses one batch per available source", async () => {
		const commands = [];
		const result = await installArchPackageBatch(
			["already", "repo-one", "aur-one", "repo-two", "aur-two"],
			{
				aurHelper: "yay",
				getInstalledPackagesImpl: async () => new Set(["already"]),
				packageInRepositoryImpl: async (pkg) => pkg.startsWith("repo-"),
				packageInAurImpl: async () => true,
				runCommandImpl: async (command) => {
					commands.push(command);
					return true;
				},
			},
		);

		expect(commands).toEqual([
			"sudo -n pacman -S --needed --noconfirm repo-one repo-two",
			"yay -S --needed --noconfirm --batchinstall aur-one aur-two",
		]);
		expect(result).toEqual({
			installed: ["repo-one", "aur-one", "repo-two", "aur-two"],
			failed: [],
			missing: [],
			invalid: [],
			skipped: ["already"],
			held: [],
		});
	});

	it("filters missing AUR and malformed targets before install commands", async () => {
		const metadataQueries = [];
		const commands = [];
		const result = await installArchPackageBatch(
			["repo-one", "aur-good", "aur-missing", "bad;name"],
			{
				aurHelper: "paru",
				getInstalledPackagesImpl: async () => new Set(),
				packageInRepositoryImpl: async (pkg) => pkg === "repo-one",
				packageInAurImpl: async (pkg) => {
					metadataQueries.push(pkg);
					return pkg === "aur-good";
				},
				runCommandImpl: async (command) => {
					commands.push(command);
					return true;
				},
			},
		);

		expect(metadataQueries).toEqual(["aur-good", "aur-missing"]);
		expect(commands).toEqual([
			"sudo -n pacman -S --needed --noconfirm repo-one",
			"paru -S --needed --noconfirm --batchinstall aur-good",
		]);
		expect(result.missing).toEqual(["aur-missing"]);
		expect(result.invalid).toEqual(["bad;name"]);
	});

	it("retries only still-absent repository targets after batch failure", async () => {
		const snapshots = [new Set(), new Set(["repo-one"])];
		const commands = [];
		const result = await installArchPackageBatch(["repo-one", "repo-two"], {
			aurHelper: "yay",
			getInstalledPackagesImpl: async () => snapshots.shift() ?? new Set(),
			packageInRepositoryImpl: async () => true,
			packageInAurImpl: async () => false,
			runCommandImpl: async (command) => {
				commands.push(command);
				return command === "sudo -n pacman -S --needed --noconfirm repo-two";
			},
		});

		expect(commands).toEqual([
			"sudo -n pacman -S --needed --noconfirm repo-one repo-two",
			"sudo -n pacman -S --needed --noconfirm repo-two",
		]);
		expect(result.installed).toEqual(["repo-one", "repo-two"]);
		expect(result.failed).toEqual([]);
	});

	it("retries only still-absent AUR targets after batch failure", async () => {
		const snapshots = [new Set(), new Set(["aur-one"])];
		const commands = [];
		const result = await installArchPackageBatch(["aur-one", "aur-two"], {
			aurHelper: "yay",
			getInstalledPackagesImpl: async () => snapshots.shift() ?? new Set(),
			packageInRepositoryImpl: async () => false,
			packageInAurImpl: async () => true,
			runCommandImpl: async (command) => {
				commands.push(command);
				return command === "yay -S --needed --noconfirm aur-two";
			},
		});

		expect(commands).toEqual([
			"yay -S --needed --noconfirm --batchinstall aur-one aur-two",
			"yay -S --needed --noconfirm aur-two",
		]);
		expect(result).toEqual({
			installed: ["aur-one", "aur-two"],
			failed: [],
			missing: [],
			invalid: [],
			skipped: [],
			held: [],
		});
	});

	it("runs the AUR batch when repository fallback fails", async () => {
		const commands = [];
		const result = await installArchPackageBatch(["repo-one", "aur-one"], {
			aurHelper: "paru",
			getInstalledPackagesImpl: async () => new Set(),
			packageInRepositoryImpl: async (pkg) => pkg === "repo-one",
			packageInAurImpl: async () => true,
			runCommandImpl: async (command) => {
				commands.push(command);
				return (
					command === "paru -S --needed --noconfirm --batchinstall aur-one"
				);
			},
		});

		expect(commands).toContain(
			"paru -S --needed --noconfirm --batchinstall aur-one",
		);
		expect(result).toEqual({
			installed: ["aur-one"],
			failed: ["repo-one"],
			missing: [],
			invalid: [],
			skipped: [],
			held: [],
		});
	});

	it("marks non-repository targets missing without an AUR helper", async () => {
		const commands = [];
		let aurMetadataQueries = 0;
		const result = await installArchPackageBatch(["repo-one", "aur-one"], {
			aurHelper: null,
			getInstalledPackagesImpl: async () => new Set(),
			packageInRepositoryImpl: async (pkg) => pkg === "repo-one",
			packageInAurImpl: async () => {
				aurMetadataQueries += 1;
				return true;
			},
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});

		expect(commands).toEqual([
			"sudo -n pacman -S --needed --noconfirm repo-one",
		]);
		expect(aurMetadataQueries).toBe(0);
		expect(result).toEqual({
			installed: ["repo-one"],
			failed: [],
			missing: ["aur-one"],
			invalid: [],
			skipped: [],
			held: [],
		});
	});

	it("does not query metadata or install packages for empty input", async () => {
		let repositoryMetadataQueries = 0;
		let aurMetadataQueries = 0;
		const commands = [];
		const result = await installArchPackageBatch([], {
			aurHelper: "yay",
			getInstalledPackagesImpl: async () => new Set(),
			packageInRepositoryImpl: async () => {
				repositoryMetadataQueries += 1;
				return false;
			},
			packageInAurImpl: async () => {
				aurMetadataQueries += 1;
				return false;
			},
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
		});

		expect(repositoryMetadataQueries).toBe(0);
		expect(aurMetadataQueries).toBe(0);
		expect(commands).toEqual([]);
		expect(result).toEqual({
			installed: [],
			failed: [],
			missing: [],
			invalid: [],
			skipped: [],
			held: [],
		});
	});

	it("preserves input order across every terminal result category", async () => {
		const snapshots = [
			new Set(["skipped"]),
			new Set(["repo-present"]),
			new Set(["aur-present"]),
		];
		const result = await installArchPackageBatch(
			[
				"skipped",
				"repo-present",
				"repo-success",
				"repo-fail",
				"aur-present",
				"aur-success",
				"aur-fail",
				"missing",
				"bad;name",
			],
			{
				aurHelper: "yay",
				getInstalledPackagesImpl: async () => snapshots.shift() ?? new Set(),
				packageInRepositoryImpl: async (pkg) => pkg.startsWith("repo-"),
				packageInAurImpl: async (pkg) => pkg !== "missing",
				runCommandImpl: async (command) =>
					command.endsWith("repo-success") || command.endsWith("aur-success"),
			},
		);

		expect(result).toEqual({
			installed: ["repo-present", "repo-success", "aur-present", "aur-success"],
			failed: ["repo-fail", "aur-fail"],
			missing: ["missing"],
			invalid: ["bad;name"],
			skipped: ["skipped"],
			held: [],
		});
	});
});

describe("system package installation orchestration", () => {
	it.each([
		"ttf-jetbrains-mono-nerd-basic",
		"ttf-jetbrains-mono-nerd",
		null,
	])("keeps an existing JetBrains Nerd Font package (%s)", async (installedFont) => {
		const commands = [];
		await installSystemPackages("yay", true, {
			readFileImpl: () => "",
			installArchPackageBatchImpl: async () => ({
				failed: [],
				missing: [],
				invalid: [],
			}),
			getInstalledPackagesImpl: async () =>
				new Set(installedFont ? [installedFont] : []),
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
			promptUserImpl: async () => false,
		});
		expect(commands).toEqual(
			installedFont
				? []
				: ["sudo -n pacman -S --needed --noconfirm ttf-jetbrains-mono-nerd"],
		);
	});

	it("passes filtered package-file entries to the batch installer before Nerd Fonts", async () => {
		const commands = [];
		const batchRequests = [];
		const events = [];

		await installSystemPackages("yay", false, {
			getInstalledPackagesImpl: async () => new Set(),
			readFileImpl: () =>
				"# Applications\n chromium \n\nvisual-studio-code-bin\n",
			installArchPackageBatchImpl: async (packages, options) => {
				events.push("batch");
				batchRequests.push({ packages, options });
				return {
					installed: ["chromium", "visual-studio-code-bin"],
					failed: [],
					missing: [],
					invalid: [],
					skipped: [],
				};
			},
			runCommandImpl: async (command) => {
				events.push("font");
				commands.push(command);
				return true;
			},
			promptUserImpl: async () => false,
		});

		expect(batchRequests).toEqual([
			{
				packages: ["chromium", "visual-studio-code-bin"],
				options: { aurHelper: "yay" },
			},
		]);
		expect(commands).toEqual([
			"sudo -n pacman -S --needed --noconfirm ttf-jetbrains-mono-nerd",
		]);
		expect(events).toEqual(["batch", "font"]);
	});

	it("does not perform a second interactive sudo authentication", async () => {
		const commands = [];
		await installSystemPackages("paru", false, {
			getInstalledPackagesImpl: async () => new Set(),
			readFileImpl: () => "chromium\n",
			installArchPackageBatchImpl: async () => ({
				installed: ["chromium"],
				failed: [],
				missing: [],
				invalid: [],
				skipped: [],
			}),
			runCommandImpl: async (command) => {
				commands.push(command);
				return true;
			},
			promptUserImpl: async () => false,
		});

		expect(commands).not.toContain("sudo -v");
		expect(commands.every((command) => command.startsWith("sudo -n "))).toBe(
			true,
		);
	});

	it("installs the split-lock sudoers rule only when gaming is enabled", async () => {
		for (const enabled of [true, false]) {
			const calls = [];
			await installSystemPackages("paru", false, {
				getInstalledPackagesImpl: async () => new Set(),
				readFileImpl: () => "chromium\n",
				installArchPackageBatchImpl: async () => ({
					installed: [],
					failed: [],
					missing: [],
					invalid: [],
					skipped: [],
				}),
				runCommandImpl: async () => true,
				promptUserImpl: async () => enabled,
				installGamingPackagesImpl: async () => calls.push("packages"),
				configureSplitLockSudoersImpl: async (options) =>
					calls.push(["sudoers", options]),
			});

			expect(calls).toEqual(
				enabled ? ["packages", ["sudoers", { nonInteractiveSudo: true }]] : [],
			);
		}
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
			"sudo -n pacman -S --needed --noconfirm steam gamemode lib32-gamemode gamescope mangohud lib32-mangohud",
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

