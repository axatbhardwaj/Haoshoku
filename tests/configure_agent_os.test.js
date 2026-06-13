import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readPinnedSha,
  overlayCustomizations,
} from "../src/helpers/configure_agent_os.js";

describe("configure_agent_os overlay", () => {
  let tmp, assetsDir, agentOsDir;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-aos-"));
    assetsDir = path.join(tmp, "assets");
    agentOsDir = path.join(tmp, "agent-os");
    fs.mkdirSync(path.join(assetsDir, "commands"), { recursive: true });
    fs.mkdirSync(path.join(assetsDir, "standards", "global"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(assetsDir, "AGENT_OS_SHA"), "abc123\n");
    fs.writeFileSync(
      path.join(assetsDir, "commands", "shape-spec.md"),
      "HTML-OUTPUT",
    );
    fs.writeFileSync(
      path.join(assetsDir, "standards", "global", "commit-style.md"),
      "COMMIT",
    );
    // the clone provides commands/agent-os/; pre-create it for the overlay
    fs.mkdirSync(path.join(agentOsDir, "commands", "agent-os"), {
      recursive: true,
    });
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("reads the pinned SHA trimmed", () => {
    expect(readPinnedSha(assetsDir)).toBe("abc123");
  });

  it("overlays shape-spec.md and seeds standards at the installer path", () => {
    overlayCustomizations({ assetsDir, agentOsDir });
    expect(
      fs.readFileSync(
        path.join(agentOsDir, "commands", "agent-os", "shape-spec.md"),
        "utf-8",
      ),
    ).toBe("HTML-OUTPUT");
    expect(
      fs.readFileSync(
        path.join(
          agentOsDir,
          "profiles",
          "default",
          "standards",
          "global",
          "commit-style.md",
        ),
        "utf-8",
      ),
    ).toBe("COMMIT");
  });
});
