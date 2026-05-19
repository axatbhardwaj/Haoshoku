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

describe("syncHyprlandOverlay (injectable paths)", () => {
	let tmpHome;
	let tmpProjectRoot;

	beforeEach(() => {
		tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-hypr-home-"));
		tmpProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-hypr-pr-"));

		const bundleConfD = path.join(tmpProjectRoot, "configs", "hypr", "conf.d");
		fs.mkdirSync(bundleConfD, { recursive: true });
		fs.writeFileSync(
			path.join(bundleConfD, "00-ocean-borders.conf"),
			"# borders\n",
		);
		fs.writeFileSync(
			path.join(tmpProjectRoot, "configs", "hypr", "hyprpaper.conf"),
			"# hyprpaper\n",
		);
		const bundleMako = path.join(tmpProjectRoot, "configs", "hypr", "mako");
		fs.mkdirSync(bundleMako, { recursive: true });
		fs.writeFileSync(path.join(bundleMako, "config"), "# mako\n");

		const deskback = path.join(tmpProjectRoot, "deskback");
		fs.mkdirSync(deskback, { recursive: true });
		fs.writeFileSync(path.join(deskback, "ocean.jpg"), "fake-jpeg");
	});

	afterEach(() => {
		fs.rmSync(tmpHome, { recursive: true, force: true });
		fs.rmSync(tmpProjectRoot, { recursive: true, force: true });
	});

	it("deploys overlay files to ~/.config/hypr-ocean/ and ~/.config/mako/", async () => {
		await hyprland.syncHyprlandOverlay({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const overlay = path.join(tmpHome, ".config", "hypr-ocean");
		expect(
			fs.existsSync(path.join(overlay, "conf.d", "00-ocean-borders.conf")),
		).toBe(true);
		expect(fs.existsSync(path.join(overlay, "hyprpaper.conf"))).toBe(true);
		expect(
			fs.existsSync(path.join(overlay, "wallpapers", "ocean.jpg")),
		).toBe(true);
		expect(
			fs.existsSync(path.join(tmpHome, ".config", "mako", "config")),
		).toBe(true);
	});

	it("never writes into ~/.config/hypr/ (Caelestia's symlinked tree)", async () => {
		const caelestiaTree = path.join(tmpHome, ".config", "hypr");
		fs.mkdirSync(caelestiaTree, { recursive: true });
		fs.writeFileSync(
			path.join(caelestiaTree, "hyprland.conf"),
			"caelestia-tracked",
		);

		await hyprland.syncHyprlandOverlay({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const after = fs.readFileSync(
			path.join(caelestiaTree, "hyprland.conf"),
			"utf8",
		);
		expect(after).toBe("caelestia-tracked");
	});

	it("is idempotent — running twice produces the same filesystem state", async () => {
		await hyprland.syncHyprlandOverlay({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});
		const overlay = path.join(tmpHome, ".config", "hypr-ocean");
		const before = fs.readdirSync(path.join(overlay, "conf.d")).sort();

		await hyprland.syncHyprlandOverlay({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});
		const after = fs.readdirSync(path.join(overlay, "conf.d")).sort();

		expect(after).toEqual(before);
	});
});

describe("translateKdeShortcutsToHyprland", () => {
	const fixturePath = path.join(
		__dirname,
		"fixtures",
		"sample-kde_shortcuts.kksrc",
	);
	const fixture = fs.readFileSync(fixturePath, "utf8");

	it("emits Hyprland bind lines for known KWin window-management actions", () => {
		const out = hyprland.translateKdeShortcutsToHyprland(fixture);
		expect(out).toMatch(/bind = ALT, F4, killactive/);
		expect(out).toMatch(/bind = CTRL, F1, workspace, 1/);
		expect(out).toMatch(/bind = SUPER_ALT, DOWN, movefocus, d/);
	});

	it("translates lock session to hyprlock", () => {
		const out = hyprland.translateKdeShortcutsToHyprland(fixture);
		expect(out).toMatch(/bind = SUPER, L, exec, hyprlock/);
	});

	it("translates Spectacle rectangular screenshot to hyprshot", () => {
		const text = `[org.kde.spectacle.desktop]
RectangularRegionScreenShot=Meta+Shift+S,Print,Capture Rectangular Region
`;
		const out = hyprland.translateKdeShortcutsToHyprland(text);
		expect(out).toMatch(
			/bind = SUPER_SHIFT, S, exec, hyprshot -m region/,
		);
	});

	it("emits # UNTRANSLATED comments for actions with no Hyprland equivalent", () => {
		const text =
			"[kglobalaccel]\nUNKNOWN_ACTION=Ctrl+Alt+Z,,Some Action\n";
		const out = hyprland.translateKdeShortcutsToHyprland(text);
		expect(out).toMatch(/# UNTRANSLATED: UNKNOWN_ACTION/);
	});

	it("ignores entries with empty or 'none' binding values", () => {
		const out = hyprland.translateKdeShortcutsToHyprland(fixture);
		// "Switch to Desktop 5=none" — should not emit a bind
		expect(out).not.toMatch(/Switch to Desktop 5/);
		// "Window Fullscreen=,,Full Screen Window" — empty binding, should not emit
		expect(out).not.toMatch(/bind = .*fullscreen, 0/);
	});

	it("translates kmix snake_case actions with XF86 multimedia keys", () => {
		const text =
			"[kmix]\nincrease_volume=Volume Up,Volume Up,Increase Volume\nmute=Volume Mute,Volume Mute,Mute\n";
		const out = hyprland.translateKdeShortcutsToHyprland(text);
		expect(out).toMatch(
			/bind = , XF86AudioRaiseVolume, exec, wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%\+/,
		);
		expect(out).toMatch(
			/bind = , XF86AudioMute, exec, wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle/,
		);
	});

	it("translates powerdevil brightness with XF86MonBrightness keys", () => {
		const text =
			"[org_kde_powerdevil]\nIncrease Screen Brightness=Monitor Brightness Up,Monitor Brightness Up,Increase Screen Brightness\n";
		const out = hyprland.translateKdeShortcutsToHyprland(text);
		expect(out).toMatch(
			/bind = , XF86MonBrightnessUp, exec, brightnessctl set \+5%/,
		);
	});

	it("translates mediacontrol playback to playerctl XF86Audio binds", () => {
		const text =
			"[mediacontrol]\nplaypausemedia=Media Play,Media Play,Play/Pause\nnextmedia=Media Next,Media Next,Next\n";
		const out = hyprland.translateKdeShortcutsToHyprland(text);
		expect(out).toMatch(/bind = , XF86AudioPlay, exec, playerctl play-pause/);
		expect(out).toMatch(/bind = , XF86AudioNext, exec, playerctl next/);
	});

	it("translates [services][X.desktop] _launch to gtk-launch X", () => {
		const text =
			"[services][com.mitchellh.ghostty.desktop]\n_launch=Meta+Return\n";
		const out = hyprland.translateKdeShortcutsToHyprland(text);
		expect(out).toMatch(
			/bind = SUPER, RETURN, exec, gtk-launch com\.mitchellh\.ghostty/,
		);
	});

	it("dedupes duplicate bindings, keeping the first and commenting the rest", () => {
		const text =
			"[services][app-a.desktop]\n_launch=Meta+G\n[services][app-b.desktop]\n_launch=Meta+G\n";
		const out = hyprland.translateKdeShortcutsToHyprland(text);
		expect(out).toMatch(
			/bind = SUPER, G, exec, gtk-launch app-a/,
		);
		expect(out).toMatch(
			/# DUPLICATE BINDING.*bind = SUPER, G, exec, gtk-launch app-b/,
		);
	});

	it("emits UNTRANSLATED instead of an invalid bind when the key has no xkb/XF86 mapping", () => {
		// "Microphone Volume Up" is not a real keysym; translateModifiers falls
		// through .toUpperCase() to "MICROPHONE VOLUME UP" which contains spaces.
		const text =
			"[kmix]\nincrease_microphone_volume=Microphone Volume Up,Microphone Volume Up,Increase Mic\n";
		const out = hyprland.translateKdeShortcutsToHyprland(text);
		expect(out).not.toMatch(/MICROPHONE VOLUME UP/);
		expect(out).toMatch(/# UNTRANSLATED: increase_microphone_volume/);
	});

	it("emits valid XF86 keys for keyboard brightness, sleep, hibernate, power", () => {
		const text = `[org_kde_powerdevil]
Increase Keyboard Brightness=Keyboard Brightness Up,Keyboard Brightness Up,Kbd Up
Sleep=Sleep,Sleep,Sleep
Hibernate=Hibernate,Hibernate,Hibernate
PowerOff=Power Off,Power Off,PowerOff
`;
		const out = hyprland.translateKdeShortcutsToHyprland(text);
		expect(out).toMatch(/bind = , XF86KbdBrightnessUp, exec/);
		expect(out).toMatch(/bind = , XF86Sleep, exec, systemctl suspend/);
		expect(out).toMatch(/bind = , XF86Hibernate, exec, systemctl hibernate/);
		expect(out).toMatch(/bind = , XF86PowerOff, exec, systemctl poweroff/);
	});
});

describe("translateKdeWindowRulesToHyprland", () => {
	const fixture = fs.readFileSync(
		path.join(__dirname, "fixtures", "sample-kwinrulesrc"),
		"utf8",
	);

	it("emits a workspace pin rule for desktops=N", () => {
		const out = hyprland.translateKdeWindowRulesToHyprland(fixture);
		expect(out).toMatch(/windowrulev2 = workspace 4,class:\^\(discord\)\$/);
	});

	it("emits a float rule for above=true entries", () => {
		const out = hyprland.translateKdeWindowRulesToHyprland(fixture);
		expect(out).toMatch(/windowrulev2 = float,class:\^\(spotify\)\$/);
	});

	it("emits an opacity rule from opacityactive (percent → 0-1 float)", () => {
		const out = hyprland.translateKdeWindowRulesToHyprland(fixture);
		expect(out).toMatch(/windowrulev2 = opacity 0\.90,class:\^\(frame\)\$/);
	});

	it("skips Activity-only rules (no useful Hyprland property)", () => {
		const out = hyprland.translateKdeWindowRulesToHyprland(fixture);
		// brave-browser had only activity rule — should produce no windowrulev2
		expect(out).not.toMatch(/windowrulev2 = .*brave-browser/);
	});
});
