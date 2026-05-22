import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

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
