import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const CONFIGS_DIR = path.join(PROJECT_ROOT, "configs");
const CACHYOS_SRC = fs.readFileSync(
	path.join(PROJECT_ROOT, "src", "os_scripts", "cachyos.js"),
	"utf8",
);

describe("KDE Configuration Assets", () => {
	it("should have a configs directory", () => {
		expect(fs.existsSync(CONFIGS_DIR)).toBe(true);
	});
});

describe("configureUserApps step ordering", () => {
	// Caelestia's install.fish overwrites ~/.config/fish/config.fish,
	// ~/.config/fish/functions/fish_greeting.fish, and
	// ~/.config/fastfetch/config.jsonc during configureHyprland(). If our
	// fish/fastfetch deploys run earlier, Caelestia clobbers them and the user
	// loses the onefetch/fastfetch decider, the `z` zoxide command, and the
	// konqi fastfetch layout. Don't reorder.
	const callIndex = (needle) => {
		const matches = [
			...CACHYOS_SRC.matchAll(new RegExp(`await ${needle}\\(`, "g")),
		];
		return { count: matches.length, index: matches[0]?.index ?? -1 };
	};

	it("configures Plasma without invoking Hyprland", () => {
		expect(callIndex("configureKde").count).toBe(1);
		expect(callIndex("configureHyprland").count).toBe(0);
	});

	it("calls configureFishShell exactly once, after configureHyprland", () => {
		const hyprland = callIndex("configureKde");
		const fish = callIndex("configureFishShell");
		expect(fish.count).toBe(1);
		expect(fish.index).toBeGreaterThan(hyprland.index);
	});

	it("calls configureFastfetch exactly once, after configureHyprland", () => {
		const hyprland = callIndex("configureKde");
		const fastfetch = callIndex("configureFastfetch");
		expect(fastfetch.count).toBe(1);
		expect(fastfetch.index).toBeGreaterThan(hyprland.index);
	});

	it("calls configureAudio exactly once, after configureHyprland captures device type", () => {
		const hyprland = callIndex("configureKde");
		const audio = callIndex("configureAudio");
		expect(audio.count).toBe(1);
		expect(audio.index).toBeGreaterThan(hyprland.index);
	});

	it("guards configureAudio so audio sync errors do not abort later app setup", () => {
		expect(CACHYOS_SRC).toMatch(
			/try\s*\{\s*await configureAudio\(\);\s*\}\s*catch\s*\(err\)\s*\{\s*log\.warning/s,
		);
		expect(callIndex("configureFishShell").index).toBeGreaterThan(
			callIndex("configureAudio").index,
		);
	});

	it("does not run the retired Caelestia flow", () => {
		// Regression: v5.1.0 added --caelestia-prefs but forgot to wire it into the
		// default cachyos flow, so a fresh `haoshoku` install booted Hyprland with
		// upstream Caelestia defaults instead of the user's saved overrides.
		const installCaelestia = callIndex("installCaelestia");
		const prefs = callIndex("configureCaelestiaPrefs");
		expect(prefs.count).toBe(0);
		expect(installCaelestia.count).toBe(0);
	});

	it("imports the Plasma configurator", () => {
		expect(CACHYOS_SRC).toContain("configure_kde_plasma.js");
	});
});

describe("configureTerminals kitty deployment", () => {
	const KITTY_COLOUR_DIRECTIVE =
		/^\s*(?:(?:palette|foreground|background|cursor|color\d+)\b|[a-z0-9_]*(?:_color\b|_(?:foreground|background)[a-z0-9_]*\b))/im;

	it("catches qualified kitty background colour directives", () => {
		expect("active_tab_background #222").toMatch(KITTY_COLOUR_DIRECTIVE);
	});

	it("catches kitty directives whose keys end in _color", () => {
		expect("url_color #24bd5c").toMatch(KITTY_COLOUR_DIRECTIVE);
	});

	it("allows background_opacity as a non-colour directive", () => {
		expect("background_opacity 0.85").not.toMatch(KITTY_COLOUR_DIRECTIVE);
	});

	it("allows background_blur as a non-colour directive", () => {
		expect("background_blur 1").not.toMatch(KITTY_COLOUR_DIRECTIVE);
	});

	it("ships the primary kitty config without terminal colour directives", () => {
		const kittyConfigPath = path.join(CONFIGS_DIR, "kitty", "kitty.conf");
		expect(fs.existsSync(kittyConfigPath)).toBe(true);

		const config = fs.readFileSync(kittyConfigPath, "utf8");
		expect(config).toContain("font_family      0xProto Nerd Font Mono");
		expect(config).toContain("font_size        11");
		expect(config).toContain("background_opacity   0.85");
		expect(config).toContain("background_blur      1");
		expect(config).toContain("confirm_os_window_close 0");
		expect(config).toContain("window_padding_width 4");
		expect(config).toContain("hide_window_decorations yes");
		expect(config).toContain("map shift+enter send_text all \\x1b\\r");
		expect(config).not.toMatch(KITTY_COLOUR_DIRECTIVE);
	});

	it("deploys only configs/kitty/kitty.conf to ~/.config/kitty/kitty.conf", () => {
		expect(CACHYOS_SRC).toContain(
			'const KITTY_CONFIG_DIR = path.join(HOME, ".config", "kitty");',
		);
		expect(CACHYOS_SRC).toMatch(
			/const CUSTOM_KITTY_CONFIG_PATH = path\.join\(\s*CONFIGS_DIR,\s*"kitty",\s*"kitty\.conf",?\s*\);/s,
		);
		expect(CACHYOS_SRC).toContain('path.join(KITTY_CONFIG_DIR, "kitty.conf")');
		expect(CACHYOS_SRC).toContain(
			"gen-sequences.py beside it is a maintenance tool, not deployed",
		);
		expect(CACHYOS_SRC).not.toMatch(/ghostty/i);
	});
});

/* Retired Hyprland flow coverage was removed with the KDE-first migration. */
/*
describe.skip("retired configureHyprland default-flow UX", () => {
  // Regression: pre-5.2.6 the default cachyos flow's Hyprland prompt was
  // hardcoded "(parallel to KDE)" and never asked DE / device type. Laptops
  // got the PC variant; Hyprland-edition CachyOS users got a misleading
  // prompt + a redundant Hyprland package install + a "Plasma fallback"
  // success line for a Plasma session that doesn't exist.
  const callIndex = (needle) => {
    const matches = [
      ...CACHYOS_SRC.matchAll(new RegExp(`await ${needle}\\(`, "g")),
    ];
    return { count: matches.length, index: matches[0]?.index ?? -1 };
  };

  it("no longer ships the misleading 'parallel to KDE' prompt copy", () => {
    expect(CACHYOS_SRC).not.toMatch(/parallel to KDE/);
  });

  it("imports promptDesktopEnvironment and promptDeviceType from configure_hyprland.js", () => {
    expect(CACHYOS_SRC).toMatch(
      /import\s*\{[^}]*promptDesktopEnvironment[^}]*\}\s*from\s*["']\.\.\/helpers\/configure_hyprland\.js["']/s,
    );
    expect(CACHYOS_SRC).toMatch(
      /import\s*\{[^}]*promptDeviceType[^}]*\}\s*from\s*["']\.\.\/helpers\/configure_hyprland\.js["']/s,
    );
  });

  it("calls promptDesktopEnvironment exactly once, before installCaelestia", () => {
    const de = callIndex("promptDesktopEnvironment");
    const install = callIndex("installCaelestia");
    expect(de.count).toBe(1);
    expect(install.count).toBe(1);
    expect(de.index).toBeLessThan(install.index);
  });

  it("calls promptDeviceType exactly once, before installCaelestia", () => {
    const dev = callIndex("promptDeviceType");
    const install = callIndex("installCaelestia");
    expect(dev.count).toBe(1);
    expect(dev.index).toBeLessThan(install.index);
  });

  it("forwards skipHyprlandPackages based on the DE answer to installCaelestia", () => {
    expect(CACHYOS_SRC).toMatch(
      /installCaelestia\(\{\s*skipHyprlandPackages:\s*de\s*===\s*["']hyprland["']/,
    );
  });

  it("tells skipped device-type users that device-specific audio tuning will be skipped", () => {
    expect(CACHYOS_SRC).toMatch(
      /Device type skipped[\s\S]{0,180}(audio|WirePlumber)/i,
    );
  });
});
*/

describe("wallpaper deployment", () => {
	it("ships a deskback/ directory with wallpaper files", () => {
		const deskback = path.join(PROJECT_ROOT, "deskback");
		expect(fs.existsSync(deskback)).toBe(true);
		const entries = fs.readdirSync(deskback).filter((f) => {
			const stat = fs.statSync(path.join(deskback, f));
			return stat.isFile();
		});
		expect(entries.length).toBeGreaterThan(0);
	});

	it("calls deployWallpapers exactly once, after KDE configuration", () => {
		const deploy = [...CACHYOS_SRC.matchAll(/await deployWallpapers\(/g)];
		const install = [...CACHYOS_SRC.matchAll(/await configureKde\(/g)];
		expect(deploy.length).toBe(1);
		expect(deploy[0].index).toBeGreaterThan(install[0].index);
	});

	it("targets ~/Pictures/Wallpapers as the deploy destination", () => {
		expect(CACHYOS_SRC).toMatch(
			/WALLPAPERS_DST\s*=\s*path\.join\(HOME,\s*["']Pictures["'],\s*["']Wallpapers["']\)/,
		);
	});
});

describe("AUR package list", () => {
	it("includes thunar in common/paru_applist.txt", () => {
		const list = fs.readFileSync(
			path.join(PROJECT_ROOT, "common", "paru_applist.txt"),
			"utf8",
		);
		const pkgs = list
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith("#"));
		expect(pkgs).toContain("thunar");
	});

	it("includes Dolphin for the managed default file manager", () => {
		const list = fs.readFileSync(
			path.join(PROJECT_ROOT, "common", "paru_applist.txt"),
			"utf8",
		);
		const pkgs = list
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith("#"));
		expect(pkgs).toContain("dolphin");
		expect(pkgs).not.toContain("cosmic-files");
	});

	it("includes swayimg for the managed image MIME defaults", () => {
		const list = fs.readFileSync(
			path.join(PROJECT_ROOT, "common", "paru_applist.txt"),
			"utf8",
		);
		const pkgs = list
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith("#"));
		expect(pkgs).toContain("swayimg");
	});

	it("does not install cohesion-git after returning Notion to the Brave web app", () => {
		const list = fs.readFileSync(
			path.join(PROJECT_ROOT, "common", "paru_applist.txt"),
			"utf8",
		);
		const pkgs = list
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith("#"));
		expect(pkgs).not.toContain("cohesion-git");
	});
});

describe("custom fish assets shipped by haoshoku", () => {
	it("ships configs/fish/config.fish", () => {
		expect(fs.existsSync(path.join(CONFIGS_DIR, "fish", "config.fish"))).toBe(
			true,
		);
	});

	it("ships configs/fish/functions/fish_greeting.fish with the onefetch/fastfetch decider", () => {
		const greetingPath = path.join(
			CONFIGS_DIR,
			"fish",
			"functions",
			"fish_greeting.fish",
		);
		expect(fs.existsSync(greetingPath)).toBe(true);
		const content = fs.readFileSync(greetingPath, "utf8");
		expect(content).toContain("is_git_repo");
		expect(content).toContain("onefetch");
		expect(content).toContain("fastfetch");
	});

	it("ships configs/fish/functions/is_git_repo.fish", () => {
		expect(
			fs.existsSync(
				path.join(CONFIGS_DIR, "fish", "functions", "is_git_repo.fish"),
			),
		).toBe(true);
	});

	it("does not embed CONTEXT7_API_KEY or other secrets in configs/fish/config.fish", () => {
		const content = fs.readFileSync(
			path.join(CONFIGS_DIR, "fish", "config.fish"),
			"utf8",
		);
		expect(content).not.toMatch(/ctx7sk-/);
		expect(content).not.toMatch(/api[_-]?key\s*=\s*['"][^'"]+['"]/i);
	});
});

describe("installAurHelper robustness", () => {
	it("calls fs.rmSync on PARU_BUILD_DIR before the runCommand that git-clones paru", () => {
		// Ensures a leftover /tmp/paru from a prior failed run doesn't block cloning.
		// The rmSync call must appear before the git clone runCommand inside installAurHelper.
		const fnStart = CACHYOS_SRC.indexOf("async function installAurHelper");
		const fnEnd = CACHYOS_SRC.indexOf("\nasync function ", fnStart + 1);
		const fnBody = CACHYOS_SRC.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
		const rmSyncIdx = fnBody.indexOf("fs.rmSync(PARU_BUILD_DIR");
		const cloneRunCmdIdx = fnBody.indexOf("PARU_AUR_URL");
		expect(rmSyncIdx).toBeGreaterThan(-1);
		expect(cloneRunCmdIdx).toBeGreaterThan(-1);
		expect(rmSyncIdx).toBeLessThan(cloneRunCmdIdx);
	});

	it("passes { recursive: true, force: true } to rmSync for PARU_BUILD_DIR", () => {
		expect(CACHYOS_SRC).toMatch(
			/fs\.rmSync\(PARU_BUILD_DIR,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/,
		);
	});

	it("captures the runCommand result in installAurHelper and warns on failure", () => {
		// The paru build command result must be captured (assigned to a variable or
		// otherwise tested), and a log.warning must follow it in installAurHelper.
		// We verify by checking that both an assignment to the paru spinner call and
		// a log.warning appear inside the installAurHelper function body.
		const fnStart = CACHYOS_SRC.indexOf("async function installAurHelper");
		const fnEnd = CACHYOS_SRC.indexOf("\nasync function ", fnStart + 1);
		const fnBody = CACHYOS_SRC.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
		expect(fnBody).toMatch(/const\s+\w+\s*=\s*await\s+withSpinner/);
		expect(fnBody).toMatch(/log\.warning/);
	});
});

describe("installBaseDependencies base-devel requirement", () => {
	it("installs base-devel and git via pacman (required for makepkg / paru build)", () => {
		// Must be an uncommented (active) call — check the string is present in the source.
		// Allow for an optional trailing comma before the closing paren (biome style).
		expect(CACHYOS_SRC).toMatch(
			/runCommand\(\s*["']sudo pacman -S --needed --noconfirm base-devel git["'],?\s*\)/,
		);
	});

	it("checks the result of the base-devel install and warns on failure", () => {
		const fnStart = CACHYOS_SRC.indexOf(
			"async function installBaseDependencies",
		);
		const fnEnd = CACHYOS_SRC.indexOf("\nasync function ", fnStart + 1);
		const fnBody = CACHYOS_SRC.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
		// Result captured into a variable (trailing comma allowed by biome style)
		expect(fnBody).toMatch(
			/const\s+\w+\s*=\s*await\s+runCommand\(\s*["']sudo pacman -S --needed --noconfirm base-devel git["']/,
		);
		expect(fnBody).toMatch(/log\.warning/);
	});
});

describe("installKdeGlass result gating", () => {
	it("installs Vulkan headers required for CMake to resolve KWin", () => {
		const fnStart = CACHYOS_SRC.indexOf(
			"export async function installKdeGlass",
		);
		const fnBody = CACHYOS_SRC.slice(fnStart);
		expect(fnBody).toMatch(
			/paru -S --needed --noconfirm[^"'`]*\bvulkan-headers\b/,
		);
	});

	it("does not build when prerequisite installation fails", () => {
		const fnStart = CACHYOS_SRC.indexOf(
			"export async function installKdeGlass",
		);
		const fnBody = CACHYOS_SRC.slice(fnStart);
		expect(fnBody).toMatch(/if\s*\(!prerequisitesOk\)\s*\{/);
		expect(fnBody).toMatch(
			/KDE Glass prerequisites failed to install; skipping build/,
		);
	});

	it("captures the result of the kwin-effects-glass build runCommand", () => {
		const fnStart = CACHYOS_SRC.indexOf(
			"export async function installKdeGlass",
		);
		const fnEnd = CACHYOS_SRC.indexOf("\nasync function ", fnStart + 1);
		// installKdeGlass is the last function — slice to end if no next function found
		const fnBody = CACHYOS_SRC.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
		// The big build chain must be assigned
		expect(fnBody).toMatch(/const\s+\w+\s*=\s*await\s+runCommand\(/);
	});

	it("only prints success message when the build runCommand returned true", () => {
		const fnStart = CACHYOS_SRC.indexOf(
			"export async function installKdeGlass",
		);
		const fnBody = CACHYOS_SRC.slice(fnStart);
		// success call gated on the result variable
		expect(fnBody).toMatch(/if\s*\(\w+\)\s*\{[\s\S]*?log\.success/);
	});

	it("logs an error with manual-install URL when the build fails", () => {
		// log.error call may have whitespace/newline between '(' and the string.
		expect(CACHYOS_SRC).toMatch(/log\.error\(\s*["'`]KDE Glass build failed/);
		expect(CACHYOS_SRC).toMatch(
			/https:\/\/github\.com\/4v3ngR\/kwin-effects-glass/,
		);
	});

	it("uses fs.rmSync instead of runCommand('rm -rf …') for buildDir cleanup", () => {
		const fnStart = CACHYOS_SRC.indexOf(
			"export async function installKdeGlass",
		);
		const fnBody = CACHYOS_SRC.slice(fnStart);
		// Must NOT use a shell rm -rf for buildDir
		expect(fnBody).not.toMatch(/runCommand\(`rm -rf \$\{buildDir\}`\)/);
		// Must use fs.rmSync
		expect(fnBody).toMatch(
			/fs\.rmSync\(buildDir,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/,
		);
	});
});

describe("configureFastfetch safeCopyFile", () => {
	it("uses safeCopyFile instead of fs.copyFileSync for the fastfetch config", () => {
		const fnStart = CACHYOS_SRC.indexOf("async function configureFastfetch");
		const fnEnd = CACHYOS_SRC.indexOf("\nasync function ", fnStart + 1);
		const fnBody = CACHYOS_SRC.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
		// Must NOT use bare fs.copyFileSync for the fastfetch config copy
		expect(fnBody).not.toMatch(/fs\.copyFileSync\(/);
		// Must use safeCopyFile
		expect(fnBody).toMatch(/safeCopyFile\(/);
	});
});
