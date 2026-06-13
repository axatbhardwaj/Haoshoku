import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CODEX_PERSONAL_FILES,
  syncCodexConfig,
  backupCodexConfig,
} from "../src/helpers/configure_codex.js";

describe("CODEX_PERSONAL_FILES manifest", () => {
  it("tracks exactly AGENTS.md", () => {
    expect(CODEX_PERSONAL_FILES.map((f) => f.src)).toEqual(["AGENTS.md"]);
  });
});

describe("syncCodexConfig", () => {
  let tmpDir, configsDir, codexHome, codexDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-codex-"));
    configsDir = path.join(tmpDir, "configs", "codex");
    codexHome = path.join(tmpDir, "codex-home");
    codexDir = path.join(codexHome, ".codex");
    fs.mkdirSync(configsDir, { recursive: true });
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("deploys AGENTS.md into a fresh ~/.codex", async () => {
    fs.writeFileSync(path.join(configsDir, "AGENTS.md"), "BUNDLE");
    await syncCodexConfig({ srcDir: configsDir, codexHome });
    expect(fs.readFileSync(path.join(codexDir, "AGENTS.md"), "utf-8")).toBe(
      "BUNDLE",
    );
  });

  it("backs up a differing live AGENTS.md to .bak before overwriting", async () => {
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(path.join(codexDir, "AGENTS.md"), "LIVE");
    fs.writeFileSync(path.join(configsDir, "AGENTS.md"), "BUNDLE");
    await syncCodexConfig({ srcDir: configsDir, codexHome });
    expect(fs.readFileSync(path.join(codexDir, "AGENTS.md.bak"), "utf-8")).toBe(
      "LIVE",
    );
    expect(fs.readFileSync(path.join(codexDir, "AGENTS.md"), "utf-8")).toBe(
      "BUNDLE",
    );
  });

  it("round-trips via backupCodexConfig", async () => {
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(path.join(codexDir, "AGENTS.md"), "LIVE-EDIT");
    await backupCodexConfig({ srcDir: configsDir, codexHome });
    expect(fs.readFileSync(path.join(configsDir, "AGENTS.md"), "utf-8")).toBe(
      "LIVE-EDIT",
    );
  });
});
