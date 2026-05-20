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
