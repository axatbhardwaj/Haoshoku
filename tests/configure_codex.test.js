import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CODEX_PERSONAL_FILES,
  configureCodex,
  installCodex,
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

describe("installCodex", () => {
  it("installs the @openai/codex package when the codex command is missing", async () => {
    const commands = [];

    await installCodex({
      commandExists: () => false,
      run: async (cmd) => {
        commands.push(cmd);
        return true;
      },
    });

    expect(commands).toEqual(["bun install -g @openai/codex"]);
  });

  it("skips installation when the codex command already exists", async () => {
    const commands = [];

    await installCodex({
      commandExists: () => true,
      run: async (cmd) => {
        commands.push(cmd);
        return true;
      },
    });

    expect(commands).toEqual([]);
  });
});

describe("configureCodex", () => {
  it("installs Codex before syncing AGENTS.md", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-codex-configure-"));
    try {
      const configsDir = path.join(tmpDir, "configs", "codex");
      const codexHome = path.join(tmpDir, "codex-home");
      const codexDir = path.join(codexHome, ".codex");
      fs.mkdirSync(configsDir, { recursive: true });
      fs.writeFileSync(path.join(configsDir, "AGENTS.md"), "BUNDLE");

      const commands = [];
      await configureCodex({
        srcDir: configsDir,
        codexHome,
        installOptions: {
          commandExists: () => false,
          run: async (cmd) => {
            commands.push(cmd);
            expect(fs.existsSync(path.join(codexDir, "AGENTS.md"))).toBe(false);
            return true;
          },
        },
      });

      expect(commands).toEqual(["bun install -g @openai/codex"]);
      expect(fs.readFileSync(path.join(codexDir, "AGENTS.md"), "utf-8")).toBe(
        "BUNDLE",
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
