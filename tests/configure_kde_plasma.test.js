import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { syncKdePlasma } from "../src/helpers/configure_kde_plasma.js";

describe("syncKdePlasma", () => {
	let home;

	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-plasma-"));
		fs.mkdirSync(path.join(home, ".config"), { recursive: true });
	});

	afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

	it("preserves unrelated shortcuts while installing KDE-owned mappings", async () => {
		const shortcuts = path.join(home, ".config", "kglobalshortcutsrc");
		fs.writeFileSync(shortcuts, "[custom]\nKeep=Meta+K,Meta+K,Keep me\n");

		await syncKdePlasma({ home, reload: false });

		const result = fs.readFileSync(shortcuts, "utf8");
		expect(result).toContain("Keep=Meta+K,Meta+K,Keep me");
		expect(result).toContain("Edit Tiles=none,none,Toggle Tiles Editor");
		expect(fs.existsSync(`${shortcuts}.haoshoku-first-capture`)).toBe(true);
	});

	it("installs portable app launchers and no Hyprland-only commands", async () => {
		const applications = path.join(home, ".local", "share", "applications");
		fs.mkdirSync(applications, { recursive: true });
		fs.writeFileSync(
			path.join(applications, "haoshoku-browser.desktop"),
			"[Desktop Entry]\nName=Haoshoku Browser\nExec=haoshoku-browser %U\n",
		);
		await syncKdePlasma({ home, reload: false });

		const files = fs
			.readdirSync(applications)
			.filter((f) => f.startsWith("haoshoku-"));
		const content = files
			.map((file) => fs.readFileSync(path.join(applications, file), "utf8"))
			.join("\n");
		expect(content).toContain("X-KDE-Shortcuts=Meta+T");
		expect(content).toContain("Exec=ghostty");
		expect(content).toContain(
			"Exec=haoshoku-special-workspace agents-terminal",
		);
		expect(content).not.toContain("warp-terminal");
		expect(content).toContain("Exec=dolphin");
		expect(content).toContain("Exec=zeditor");
		expect(content).toContain("Exec=haoshoku-chromium-flux %U");
		expect(content).toContain("X-KDE-Shortcuts=Meta+B");
		expect(content).not.toContain("--profile-directory");
		expect(content).not.toContain("X-KDE-Shortcuts=Meta+W");
		expect(files).toContain("haoshoku-browser.desktop");
		expect(content).not.toMatch(
			/hyprctl|caelestia|game-performance --reset|lockfix/,
		);
	});

	it("opting in retires the obsolete Brave Work launcher", async () => {
		const stateFile = path.join(home, ".haoshoku.json");
		fs.writeFileSync(stateFile, '{"customSetting":"example"}\n');
		const applications = path.join(home, ".local", "share", "applications");
		fs.mkdirSync(applications, { recursive: true });
		fs.writeFileSync(
			path.join(applications, "haoshoku-brave-work.desktop"),
			"retired launcher",
		);

		await syncKdePlasma({ home, reload: false, enableActivities: true });

		expect(JSON.parse(fs.readFileSync(stateFile, "utf8"))).toEqual({
			customSetting: "example",
			kdeActivities: true,
		});
		const flux = fs.readFileSync(
			path.join(applications, "haoshoku-brave-flux.desktop"),
			"utf8",
		);
		const defi = path.join(applications, "haoshoku-brave-defi.desktop");
		expect(flux).toContain("Exec=haoshoku-chromium-flux %U");
		expect(flux).toContain("X-KDE-Shortcuts=Meta+B");
		expect(fs.existsSync(defi)).toBe(false);
		expect(
			fs.existsSync(path.join(applications, "haoshoku-brave-work.desktop")),
		).toBe(false);
	});

	it("opting out retires the obsolete Brave DeFi launcher", async () => {
		const applications = path.join(home, ".local", "share", "applications");
		fs.mkdirSync(applications, { recursive: true });
		fs.writeFileSync(
			path.join(applications, "haoshoku-brave-defi.desktop"),
			"retired launcher",
		);

		await syncKdePlasma({ home, reload: false });

		expect(
			fs.existsSync(path.join(applications, "haoshoku-brave-defi.desktop")),
		).toBe(false);
		expect(
			fs.existsSync(path.join(applications, "haoshoku-brave-work.desktop")),
		).toBe(false);
	});

	it("uses opted-in Brave recipes on later default Plasma syncs", async () => {
		fs.writeFileSync(
			path.join(home, ".haoshoku.json"),
			'{"kdeActivities":true}\n',
		);

		await syncKdePlasma({ home, reload: false });

		const applications = path.join(home, ".local", "share", "applications");
		expect(
			fs.readFileSync(
				path.join(applications, "haoshoku-brave-flux.desktop"),
				"utf8",
			),
		).toContain("Exec=haoshoku-chromium-flux %U");
		expect(
			fs.existsSync(path.join(applications, "haoshoku-brave-defi.desktop")),
		).toBe(false);
	});

	it("uses Flux and preserves malformed opt-in state", async () => {
		const stateFile = path.join(home, ".haoshoku.json");
		fs.writeFileSync(stateFile, "{ malformed json");
		await syncKdePlasma({ home, reload: false });

		const applications = path.join(home, ".local", "share", "applications");
		expect(
			fs.readFileSync(
				path.join(applications, "haoshoku-brave-flux.desktop"),
				"utf8",
			),
		).toContain("Exec=haoshoku-chromium-flux %U");
		expect(
			fs.existsSync(path.join(applications, "haoshoku-brave-work.desktop")),
		).toBe(false);
		expect(fs.readFileSync(stateFile, "utf8")).toBe("{ malformed json");
	});

	it.each([
		["null", "null"],
		["an array", "[]"],
		["a string", '"invalid"'],
	])("warns and rebuilds opt-in state containing %s", async (_label, state) => {
		const stateFile = path.join(home, ".haoshoku.json");
		fs.writeFileSync(stateFile, `${state}\n`);
		const messages = [];
		const originalLog = console.log;
		console.log = (...args) => messages.push(args.join(" "));

		try {
			await syncKdePlasma({ home, reload: false });
			const applications = path.join(home, ".local", "share", "applications");
			expect(
				fs.existsSync(path.join(applications, "haoshoku-brave-work.desktop")),
			).toBe(false);
			expect(fs.readFileSync(stateFile, "utf8")).toBe(`${state}\n`);

			await syncKdePlasma({ home, reload: false, enableActivities: true });
		} finally {
			console.log = originalLog;
		}

		expect(JSON.parse(fs.readFileSync(stateFile, "utf8"))).toEqual({
			kdeActivities: true,
		});
		expect(messages.join("\n")).toMatch(/Malformed .*\.haoshoku\.json/i);
	});

	it.each([
		false,
		true,
	])("retires both secondary KDE launchers without touching profile data (activities=%s)", async (enableActivities) => {
		const applications = path.join(home, ".local/share/applications");
		fs.mkdirSync(applications, { recursive: true });
		for (const id of ["work", "defi"]) {
			fs.writeFileSync(
				path.join(applications, `haoshoku-brave-${id}.desktop`),
				"old managed launcher",
			);
		}
		const data = [
			".local/share/haoshoku/brave-defi",
			".local/share/haoshoku/brave-flux",
			".config/brave-haoshoku/whatsapp",
			".config/brave-haoshoku/notion",
			".config/brave-haoshoku/netflix",
			".config/BraveSoftware/Brave-Browser/Profile 1",
		];
		for (const directory of data) {
			fs.mkdirSync(path.join(home, directory), { recursive: true });
			fs.writeFileSync(
				path.join(home, directory, "sentinel"),
				"preserve profile bytes",
			);
		}
		await syncKdePlasma({ home, reload: false, enableActivities });
		await syncKdePlasma({ home, reload: false });
		for (const id of ["work", "defi"]) {
			expect(
				fs.existsSync(path.join(applications, `haoshoku-brave-${id}.desktop`)),
			).toBe(false);
		}
		for (const directory of data) {
			expect(
				fs.readFileSync(path.join(home, directory, "sentinel"), "utf8"),
			).toBe("preserve profile bytes");
		}
	});

	it("unbinds Plasma shortcuts that conflict with familiar app launchers", async () => {
		await syncKdePlasma({ home, reload: false });
		const shortcuts = fs.readFileSync(
			path.join(home, ".config", "kglobalshortcutsrc"),
			"utf8",
		);
		expect(shortcuts).toContain("Edit Tiles=none,none,Toggle Tiles Editor");
		expect(shortcuts).toContain("Overview=none,none,Toggle Overview");
		expect(shortcuts).toContain(
			"KrohnkiteIncrease=none,none,Krohnkite: Increase",
		);
		expect(shortcuts).toContain(
			"KrohnkiteMonocleLayout=none,none,Krohnkite: Monocle Layout",
		);
		expect(shortcuts).toContain(
			"next activity=none,none,Walk through activities",
		);
		expect(shortcuts).toContain(
			"powerProfile=Battery,Battery,Switch Power Profile",
		);
	});

	it("restores the familiar Meta+M Spotify launcher", async () => {
		await syncKdePlasma({ home, reload: false });
		const launcher = fs.readFileSync(
			path.join(
				home,
				".local",
				"share",
				"applications",
				"haoshoku-music.desktop",
			),
			"utf8",
		);
		expect(launcher).toContain("Exec=spotify");
		expect(launcher).toContain("X-KDE-Shortcuts=Meta+M");
	});

	it.each([
		["without KDE Activities", false],
		["with KDE Activities", true],
	])("installs the Meta+O 1Password launcher %s", async (_label, optedIn) => {
		await syncKdePlasma({
			home,
			reload: false,
			enableActivities: optedIn,
		});
		const launcher = fs.readFileSync(
			path.join(
				home,
				".local",
				"share",
				"applications",
				"haoshoku-1password.desktop",
			),
			"utf8",
		);
		expect(launcher.split("\n")).toContain("Exec=1password");
		expect(launcher).toContain("X-KDE-Shortcuts=Meta+O");
	});

	it("never creates or modifies kwinrc", async () => {
		const kwinrc = path.join(home, ".config", "kwinrc");
		fs.writeFileSync(kwinrc, "[Windows]\nFocusPolicy=ClickToFocus\n");

		await syncKdePlasma({ home, reload: false });

		expect(fs.readFileSync(kwinrc, "utf8")).toBe(
			"[Windows]\nFocusPolicy=ClickToFocus\n",
		);
		expect(fs.existsSync(`${kwinrc}.haoshoku-first-capture`)).toBe(false);
	});

	it("never creates or modifies kwinrulesrc", async () => {
		const rulesFile = path.join(home, ".config", "kwinrulesrc");
		const original =
			"[General]\ncount=1\nrules=my-existing-rule\n\n[my-existing-rule]\nDescription=Keep me\n";
		fs.writeFileSync(rulesFile, original);

		await syncKdePlasma({ home, reload: false });

		expect(fs.readFileSync(rulesFile, "utf8")).toBe(original);
		expect(fs.existsSync(`${rulesFile}.haoshoku-first-capture`)).toBe(false);
	});

	it("leaves kwinrc and kwinrulesrc absent when they did not exist", async () => {
		await syncKdePlasma({ home, reload: false });

		expect(fs.existsSync(path.join(home, ".config", "kwinrc"))).toBe(false);
		expect(fs.existsSync(path.join(home, ".config", "kwinrulesrc"))).toBe(
			false,
		);
	});

	it("never touches virtual desktops in the running KWin session", async () => {
		const commands = [];
		await syncKdePlasma({
			home,
			run: async (command) => {
				commands.push(command);
				return true;
			},
		});

		expect(commands.join("\n")).not.toContain("VirtualDesktopManager");
		expect(commands).toContain("kbuildsycoca6");
		expect(commands).toContain("qdbus6 org.kde.KWin /KWin reconfigure");
	});

	it("writes no desktop switching or window-move shortcuts", async () => {
		await syncKdePlasma({ home, reload: false });
		const shortcuts = fs.readFileSync(
			path.join(home, ".config", "kglobalshortcutsrc"),
			"utf8",
		);

		expect(shortcuts).not.toContain("Switch to Desktop");
		expect(shortcuts).not.toContain("Window to Desktop");
		expect(shortcuts).not.toContain("activate task manager entry");
	});

	it("is idempotent", async () => {
		await syncKdePlasma({ home, reload: false });
		const first = fs.readFileSync(
			path.join(home, ".config", "kglobalshortcutsrc"),
			"utf8",
		);
		await syncKdePlasma({ home, reload: false });
		const second = fs.readFileSync(
			path.join(home, ".config", "kglobalshortcutsrc"),
			"utf8",
		);
		expect(second).toBe(first);
	});
});
