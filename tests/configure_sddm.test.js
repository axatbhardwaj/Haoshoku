import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  sddmSudoersLine,
  sddmSudoersInstallScript,
} from "../src/helpers/configure_sddm.js";

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

describe("sddmSudoersInstallScript", () => {
  const line = sddmSudoersLine("xzat");
  const sudoersPath = "/etc/sudoers.d/caelestia-sddm-sync";
  const script = sddmSudoersInstallScript({ line, sudoersPath });

  it("uses mktemp to stage the candidate", () => {
    expect(script).toMatch(/mktemp/);
  });

  it("chmods the candidate to 0440 before validation", () => {
    expect(script).toMatch(/chmod\s+0440\s+"\$tmp"/);
  });

  it("validates the candidate BEFORE installing it (visudo -c -f <tmpfile>)", () => {
    const validateIdx = script.indexOf('visudo -c -f "$tmp"');
    const installIdx = script.indexOf("install -o root");
    expect(validateIdx).toBeGreaterThan(-1);
    expect(installIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeLessThan(installIdx);
  });

  it("installs to the given sudoersPath with mode 0440 owned by root", () => {
    expect(script).toContain(
      `install -o root -g root -m 0440 "$tmp" '${sudoersPath}'`,
    );
  });

  it("re-validates the full sudoers set after install (visudo -c)", () => {
    const installIdx = script.indexOf("install -o root");
    const fullValidateIdx = script.indexOf("visudo -c", installIdx);
    expect(fullValidateIdx).toBeGreaterThan(installIdx);
  });

  it("removes the drop-in on post-install validation failure (same-shell cleanup)", () => {
    expect(script).toMatch(/if\s+!\s+visudo -c/);
    expect(script).toContain(`rm -f '${sudoersPath}'`);
    expect(script).toMatch(/exit 1/);
  });

  it("embeds the literal sudoers line", () => {
    expect(script).toContain(line);
  });

  it("substitutes the sudoersPath (script changes when path changes)", () => {
    const alt = sddmSudoersInstallScript({
      line,
      sudoersPath: "/etc/sudoers.d/foo",
    });
    expect(alt).toContain("'/etc/sudoers.d/foo'");
    expect(alt).not.toContain("caelestia-sddm-sync");
  });
});
