import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { sddmSudoersLine } from "../src/helpers/configure_sddm.js";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const POSTHOOK_CMD = "sudo /usr/share/sddm/themes/caelestia/scripts/sync.sh --posthook";

const readCliJson = () =>
  JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, "configs", "caelestia", "cli.json"), "utf8"),
  );

describe("tracked configs/caelestia/cli.json (caelestia-sddm posthooks)", () => {
  it("has wallpaper.postHook for caelestia-sddm sync", () => {
    expect(readCliJson().wallpaper?.postHook).toBe(POSTHOOK_CMD);
  });

  it("has theme.postHook for caelestia-sddm sync", () => {
    expect(readCliJson().theme?.postHook).toBe(POSTHOOK_CMD);
  });
});

describe("sddmSudoersLine", () => {
  it("returns the expected rule for a valid username", () => {
    expect(sddmSudoersLine("xzat")).toBe(
      "xzat ALL=(root) NOPASSWD: /usr/share/sddm/themes/caelestia/scripts/sync.sh --posthook",
    );
  });

  it("genuinely substitutes the username", () => {
    expect(sddmSudoersLine("alice")).toMatch(/^alice ALL=/);
    expect(sddmSudoersLine("bob123")).toMatch(/^bob123 ALL=/);
  });

  it("scopes the rule to the --posthook argument (least privilege)", () => {
    expect(sddmSudoersLine("xzat")).toMatch(/sync\.sh --posthook$/);
  });

  it("throws for an empty username", () => {
    expect(() => sddmSudoersLine("")).toThrow(/Invalid username/);
  });

  it("throws for a username containing a space", () => {
    expect(() => sddmSudoersLine("a b")).toThrow(/Invalid username/);
  });

  it("throws for a username containing a semicolon", () => {
    expect(() => sddmSudoersLine("a;b")).toThrow(/Invalid username/);
  });

  it("throws for non-string input", () => {
    expect(() => sddmSudoersLine(undefined)).toThrow(/Invalid username/);
    expect(() => sddmSudoersLine(null)).toThrow(/Invalid username/);
    expect(() => sddmSudoersLine(123)).toThrow(/Invalid username/);
  });
});
