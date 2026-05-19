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
				pinnedSha: "abc1234",
				run: async (command, options) => {
					commands.push({ command, options });
					return false;
				},
			}),
		).rejects.toThrow("Failed to checkout pinned Caelestia commit abc1234");

		expect(commands).toEqual([
			{
				command: "git checkout abc1234",
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

describe("recoverCaelestiaPackages", () => {
	it("refreshes CachyOS mirrors and package databases before a final retry", async () => {
		const commands = [];
		const existsCalls = [];
		const caelestiaExists = [false, true];

		const recovered = await hyprland.recoverCaelestiaPackages({
			run: async (command) => {
				commands.push(command);
				return (
					!(
						command ===
						"paru -S --needed --noconfirm caelestia-cli caelestia-shell"
					) || commands.filter((c) => c === command).length > 1
				);
			},
			exists: async (command) => {
				existsCalls.push(command);
				if (command === "cachyos-rate-mirrors") return true;
				if (command === "caelestia") return caelestiaExists.shift() ?? true;
				return false;
			},
		});

		expect(recovered).toBe(true);
		expect(commands).toEqual([
			"paru -S --needed --noconfirm caelestia-cli caelestia-shell",
			"sudo cachyos-rate-mirrors",
			"sudo pacman -Syy --noconfirm",
			"paru -S --needed --noconfirm caelestia-cli caelestia-shell",
		]);
		expect(existsCalls).toEqual([
			"caelestia",
			"cachyos-rate-mirrors",
			"caelestia",
		]);
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
		tmpProjectRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "haoshoku-hypr-pr-"),
		);

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
		expect(fs.existsSync(path.join(overlay, "wallpapers", "ocean.jpg"))).toBe(
			true,
		);
		expect(fs.existsSync(path.join(tmpHome, ".config", "mako", "config"))).toBe(
			true,
		);
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

describe("backupHyprland (injectable paths)", () => {
	let tmpHome;
	let tmpProjectRoot;

	beforeEach(() => {
		tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-hypr-home-"));
		tmpProjectRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "haoshoku-hypr-pr-"),
		);

		const overlay = path.join(tmpHome, ".config", "hypr-ocean");
		fs.mkdirSync(path.join(overlay, "conf.d"), { recursive: true });
		fs.writeFileSync(
			path.join(overlay, "conf.d", "50-monitors.conf"),
			"monitor = , preferred, auto, 1\n",
		);
		fs.writeFileSync(path.join(overlay, "hyprpaper.conf"), "# hyprpaper\n");
		fs.writeFileSync(path.join(overlay, "hyprlock.conf"), "# hyprlock\n");
		fs.writeFileSync(path.join(overlay, "hypridle.conf"), "# hypridle\n");

		const mako = path.join(tmpHome, ".config", "mako");
		fs.mkdirSync(mako, { recursive: true });
		fs.writeFileSync(path.join(mako, "config"), "# mako\n");
	});

	afterEach(() => {
		fs.rmSync(tmpHome, { recursive: true, force: true });
		fs.rmSync(tmpProjectRoot, { recursive: true, force: true });
	});

	it("backs up live Ocean overlay files into configs/hypr/", async () => {
		await hyprland.backupHyprland({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const bundle = path.join(tmpProjectRoot, "configs", "hypr");
		expect(
			fs.readFileSync(path.join(bundle, "conf.d", "50-monitors.conf"), "utf8"),
		).toBe("monitor = , preferred, auto, 1\n");
		expect(fs.readFileSync(path.join(bundle, "hyprpaper.conf"), "utf8")).toBe(
			"# hyprpaper\n",
		);
		expect(fs.readFileSync(path.join(bundle, "hyprlock.conf"), "utf8")).toBe(
			"# hyprlock\n",
		);
		expect(fs.readFileSync(path.join(bundle, "hypridle.conf"), "utf8")).toBe(
			"# hypridle\n",
		);
		expect(fs.readFileSync(path.join(bundle, "mako", "config"), "utf8")).toBe(
			"# mako\n",
		);
	});

	it("does not throw when no live overlay exists yet", async () => {
		fs.rmSync(path.join(tmpHome, ".config"), { recursive: true, force: true });

		await expect(
			hyprland.backupHyprland({
				home: tmpHome,
				projectRoot: tmpProjectRoot,
			}),
		).resolves.toBeUndefined();

		expect(fs.existsSync(path.join(tmpProjectRoot, "configs", "hypr"))).toBe(
			true,
		);
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
		expect(out).toMatch(
			/bind = SUPER, L, exec, hyprlock --config ~\/.config\/hypr-ocean\/hyprlock\.conf/,
		);
	});

	it("translates Spectacle rectangular screenshot to hyprshot", () => {
		const text = `[org.kde.spectacle.desktop]
RectangularRegionScreenShot=Meta+Shift+S,Print,Capture Rectangular Region
`;
		const out = hyprland.translateKdeShortcutsToHyprland(text);
		expect(out).toMatch(/bind = SUPER_SHIFT, S, exec, hyprshot -m region/);
	});

	it("emits # UNTRANSLATED comments for actions with no Hyprland equivalent", () => {
		const text = "[kglobalaccel]\nUNKNOWN_ACTION=Ctrl+Alt+Z,,Some Action\n";
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
		expect(out).toMatch(/bind = SUPER, G, exec, gtk-launch app-a/);
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
		expect(out).toMatch(/windowrule = workspace 4, match:class \^discord\$/);
	});

	it("emits a float rule for above=true entries", () => {
		const out = hyprland.translateKdeWindowRulesToHyprland(fixture);
		expect(out).toMatch(/windowrule = float true, match:class \^spotify\$/);
	});

	it("emits an opacity rule from opacityactive (percent → 0-1 float)", () => {
		const out = hyprland.translateKdeWindowRulesToHyprland(fixture);
		expect(out).toMatch(/windowrule = opacity 0\.90, match:class \^frame\$/);
	});

	it("skips Activity-only rules (no useful Hyprland property)", () => {
		const out = hyprland.translateKdeWindowRulesToHyprland(fixture);
		// brave-browser had only activity rule — should produce no windowrule
		expect(out).not.toMatch(/windowrule = .*brave-browser/);
	});
});

describe("translateKdeAutostartToHyprland", () => {
	const fixtureDir = path.join(__dirname, "fixtures", "sample-autostart");

	it("filters out KDE-only services via the denylist", () => {
		const out = hyprland.translateKdeAutostartToHyprland(fixtureDir);
		expect(out).not.toMatch(/kdeconnectd/);
		expect(out).not.toMatch(/kded6/);
	});

	it("emits exec-once for surviving entries", () => {
		const out = hyprland.translateKdeAutostartToHyprland(fixtureDir);
		expect(out).toMatch(/exec-once = \/usr\/bin\/nm-applet --indicator/);
		expect(out).toMatch(/exec-once = wl-paste --watch cliphist store/);
	});

	it("returns header-only output when the dir does not exist", () => {
		const out = hyprland.translateKdeAutostartToHyprland(
			"/tmp/haoshoku-nonexistent-autostart-dir-XYZ",
		);
		expect(out).toMatch(/Translated from autostart/);
		expect(out).not.toMatch(/exec-once = /);
	});
});

describe("sanitizeDesktopExec", () => {
	it("strips trailing %U/%F field codes", () => {
		expect(hyprland.sanitizeDesktopExec("/usr/bin/steam-native %U")).toBe(
			"/usr/bin/steam-native",
		);
		expect(hyprland.sanitizeDesktopExec("/usr/bin/vesktop %U")).toBe(
			"/usr/bin/vesktop",
		);
	});

	it("strips Flatpak file-forwarding @@u … @@ wrappers", () => {
		const raw =
			"/usr/bin/flatpak run --branch=stable --arch=x86_64 --command=cohesion --file-forwarding io.github.brunofin.Cohesion @@u %U @@";
		expect(hyprland.sanitizeDesktopExec(raw)).toBe(
			"/usr/bin/flatpak run --branch=stable --arch=x86_64 --command=cohesion --file-forwarding io.github.brunofin.Cohesion",
		);
	});

	it("strips standalone %f/%u/%d/%n/%k/%c/%i codes in any position", () => {
		expect(
			hyprland.sanitizeDesktopExec("/usr/bin/foo %f --extra %i icon %c"),
		).toBe("/usr/bin/foo --extra icon");
	});

	it("collapses whitespace and trims edges", () => {
		expect(hyprland.sanitizeDesktopExec("  foo   %U   ")).toBe("foo");
	});

	it("leaves commands without field codes untouched", () => {
		expect(
			hyprland.sanitizeDesktopExec("/opt/1Password/1password --silent"),
		).toBe("/opt/1Password/1password --silent");
	});
});

describe("Adversarial coverage — confirmed bug surfaces", () => {
	// ── kdeRgbToHyprlandRgba: out-of-range and bad-alpha bugs ───────────────

	it("rejects out-of-range component (256)", () => {
		expect(() => hyprland.kdeRgbToHyprlandRgba("256,0,0")).toThrow();
	});

	it("rejects negative component (-1)", () => {
		expect(() => hyprland.kdeRgbToHyprlandRgba("-1,0,0")).toThrow();
	});

	it("rejects non-hex alphaHex ('xyz')", () => {
		expect(() => hyprland.kdeRgbToHyprlandRgba("0,0,0", "xyz")).toThrow();
	});

	it("rejects wrong-length alphaHex ('ffff')", () => {
		expect(() => hyprland.kdeRgbToHyprlandRgba("0,0,0", "ffff")).toThrow();
	});

	it("kdeRgbToHyprlandRgba output always has an 8-hex-char body when input is valid", () => {
		expect(hyprland.kdeRgbToHyprlandRgba("0,169,165")).toMatch(
			/^rgba\([0-9a-f]{8}\)$/,
		);
	});

	// ── translateKdeWindowRulesToHyprland: 3-token wmclass picks wrong token ─

	it("3-token wmclasscomplete picks second token (class), not last", () => {
		const input = "[UUID]\nwmclass=a b c\nwmclasscomplete=true\ndesktops=2\n";
		const out = hyprland.translateKdeWindowRulesToHyprland(input);
		expect(out).toMatch(/match:class \^b\$/);
		expect(out).not.toMatch(/match:class \^c\$/);
	});

	// ── translateKdeWindowRulesToHyprland: regex metachar escaping ───────────

	it("regex metacharacters in wmclass are escaped", () => {
		const input = "[UUID]\nwmclass=foo(bar\ndesktops=2\n";
		const out = hyprland.translateKdeWindowRulesToHyprland(input);
		expect(out).not.toMatch(/foo\(bar\)\$/);
		expect(out).toMatch(/foo\\\(bar/);
	});

	// ── translateKdeWindowRulesToHyprland: invalid opacityactive values ──────

	it("negative opacityactive is not emitted", () => {
		const input = "[UUID]\nwmclass=app\nopacityactive=-50\n";
		const out = hyprland.translateKdeWindowRulesToHyprland(input);
		expect(out).not.toMatch(/opacity -/);
		expect(out).not.toMatch(/opacity \d/);
	});

	it("opacityactive > 100 is not emitted", () => {
		const input = "[UUID]\nwmclass=app\nopacityactive=150\n";
		const out = hyprland.translateKdeWindowRulesToHyprland(input);
		// Stronger: directive must be absent entirely, not just !~ /1\.\d/.
		expect(out).not.toMatch(/opacity/);
	});

	// ── sanitizeDesktopExec: adjacent field codes ─────────────────────────────

	it("adjacent field codes (%f%u) are both stripped", () => {
		expect(hyprland.sanitizeDesktopExec("%f%u --extra")).toBe("--extra");
	});

	// ── sanitizeDesktopExec: unknown Flatpak @@x ... @@ prefix ──────────────

	it("@@x ... @@ block is fully stripped", () => {
		expect(
			hyprland.sanitizeDesktopExec("/usr/bin/flatpak run io.app @@x %U @@"),
		).toBe("/usr/bin/flatpak run io.app");
	});

	// ── translateKdeShortcutsToHyprland: trailing + → empty key ──────────────

	it("trailing '+' produces UNTRANSLATED, not empty key field", () => {
		const input = "[services][app.desktop]\n_launch=Meta+\n";
		const out = hyprland.translateKdeShortcutsToHyprland(input);
		expect(out).not.toMatch(/bind = SUPER, , /);
		expect(out).toMatch(/UNTRANSLATED/);
	});

	// ── translateKdeShortcutsToHyprland: duplicate modifiers not deduped ─────

	it("duplicate modifiers in binding are deduped", () => {
		const input = "[services][app.desktop]\n_launch=Ctrl+Alt+Ctrl+X\n";
		const out = hyprland.translateKdeShortcutsToHyprland(input);
		expect(out).not.toMatch(/CTRL_ALT_CTRL/);
		expect(out).toMatch(/bind = CTRL_ALT, X, exec, gtk-launch app/);
	});

	// ── translateKdeAutostartToHyprland: env-wrapper denylist bypass ─────────

	describe("env-wrapper bypass of denylist", () => {
		let tmpDir;

		beforeEach(() => {
			tmpDir = fs.mkdtempSync(
				path.join(os.tmpdir(), "haoshoku-autostart-env-"),
			);
			fs.writeFileSync(
				path.join(tmpDir, "kdeconnectd-env.desktop"),
				"[Desktop Entry]\nType=Application\nExec=env DISPLAY=:0 kdeconnectd\n",
			);
		});

		afterEach(() => {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		});

		it("env-wrapped denylist binary is still blocked", () => {
			const out = hyprland.translateKdeAutostartToHyprland(tmpDir);
			// Stronger: the entry must be fully suppressed, not just the binary name.
			// A weak fix that strips `kdeconnectd` but leaves `exec-once = env DISPLAY=:0`
			// would still be a bug — the autostart entry should not exist at all.
			expect(out).not.toMatch(/kdeconnectd/);
			expect(out).not.toMatch(/exec-once/);
		});

		it("blocks denylist binary wrapped with env flag args (env -i kdeconnectd)", () => {
			fs.writeFileSync(
				path.join(tmpDir, "kdeconnectd-flag.desktop"),
				"[Desktop Entry]\nType=Application\nExec=env -i kdeconnectd\n",
			);
			const out = hyprland.translateKdeAutostartToHyprland(tmpDir);
			expect(out).not.toMatch(/kdeconnectd/);
		});

		it("blocks denylist binary wrapped with dbus-run-session", () => {
			fs.writeFileSync(
				path.join(tmpDir, "kdeconnectd-dbus.desktop"),
				"[Desktop Entry]\nType=Application\nExec=dbus-run-session -- kdeconnectd\n",
			);
			const out = hyprland.translateKdeAutostartToHyprland(tmpDir);
			expect(out).not.toMatch(/kdeconnectd/);
		});
	});

	// ── checkoutPinnedCaelestia: SHA shape validation ────────────────────────

	it("rejects pinnedSha containing shell metacharacters before invoking git", async () => {
		let called = false;
		await expect(
			hyprland.checkoutPinnedCaelestia({
				cloneDir: "/tmp/x",
				pinnedSha: "abc1234; rm -rf $HOME",
				run: async () => {
					called = true;
					return true;
				},
			}),
		).rejects.toThrow();
		expect(called).toBe(false);
	});

	it("accepts a valid 40-char hex SHA and forwards it to run", async () => {
		const validSha = "a".repeat(40);
		let received;
		await hyprland.checkoutPinnedCaelestia({
			cloneDir: "/tmp/x",
			pinnedSha: validSha,
			run: async (cmd) => {
				received = cmd;
				return true;
			},
		});
		expect(received).toBe(`git checkout ${validSha}`);
	});

	// ── ensureLineInFile: newline in line parameter ───────────────────────────

	describe("ensureLineInFile rejects multi-line input", () => {
		let tmpDir;
		let target;

		beforeEach(() => {
			tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-ensure-"));
			target = path.join(tmpDir, "test.conf");
			fs.writeFileSync(target, "# existing\n");
		});

		afterEach(() => {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		});

		it("throws when line parameter contains a newline", () => {
			expect(() =>
				hyprland.ensureLineInFile(target, "source = a\nexec-once = pwned"),
			).toThrow(/newline/i);
			// File must remain unmodified — a silent-strip fix that writes only the
			// first line would not throw, and that is also a bug we want to catch.
			expect(fs.readFileSync(target, "utf8")).toBe("# existing\n");
		});
	});
});
