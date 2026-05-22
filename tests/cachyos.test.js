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

  it("calls configureHyprland exactly once", () => {
    expect(callIndex("configureHyprland").count).toBe(1);
  });

  it("calls configureFishShell exactly once, after configureHyprland", () => {
    const hyprland = callIndex("configureHyprland");
    const fish = callIndex("configureFishShell");
    expect(fish.count).toBe(1);
    expect(fish.index).toBeGreaterThan(hyprland.index);
  });

  it("calls configureFastfetch exactly once, after configureHyprland", () => {
    const hyprland = callIndex("configureHyprland");
    const fastfetch = callIndex("configureFastfetch");
    expect(fastfetch.count).toBe(1);
    expect(fastfetch.index).toBeGreaterThan(hyprland.index);
  });

  it("calls configureAudio exactly once, after configureHyprland captures device type", () => {
    const hyprland = callIndex("configureHyprland");
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

  it("calls configureCaelestiaPrefs exactly once, after installCaelestia", () => {
    // Regression: v5.1.0 added --caelestia-prefs but forgot to wire it into the
    // default cachyos flow, so a fresh `haoshoku` install booted Hyprland with
    // upstream Caelestia defaults instead of the user's saved overrides.
    const installCaelestia = callIndex("installCaelestia");
    const prefs = callIndex("configureCaelestiaPrefs");
    expect(prefs.count).toBe(1);
    expect(installCaelestia.count).toBe(1);
    expect(prefs.index).toBeGreaterThan(installCaelestia.index);
  });

  it("imports configureCaelestiaPrefs from src/helpers/configure_caelestia_prefs.js", () => {
    expect(CACHYOS_SRC).toMatch(
      /import\s*\{[^}]*configureCaelestiaPrefs[^}]*\}\s*from\s*["']\.\.\/helpers\/configure_caelestia_prefs\.js["']/,
    );
  });
});

describe("configureHyprland default-flow UX", () => {
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

  it("calls deployWallpapers exactly once, after installCaelestia", () => {
    const deploy = [
      ...CACHYOS_SRC.matchAll(/await deployWallpapers\(/g),
    ];
    const install = [
      ...CACHYOS_SRC.matchAll(/await installCaelestia\(/g),
    ];
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
