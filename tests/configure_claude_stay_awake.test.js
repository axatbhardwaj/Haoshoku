import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { log } from "../src/common/utils.js";
import * as csa from "../src/helpers/configure_claude_stay_awake.js";

const SCRIPT = "claude-stay-awake";
const SERVICE = "claude-stay-awake.service";

const SCRIPT_CONTENT = "#!/usr/bin/env bash\necho awake\n";
const SERVICE_CONTENT = "[Service]\nExecStart=/x/claude-stay-awake\n";

let tmpHome;
let tmpProjectRoot;
let warnings;
let warningOriginal;

const repoDir = () =>
  path.join(tmpProjectRoot, "configs", "claude-stay-awake");
const liveScriptDir = () => path.join(tmpHome, ".local", "bin");
const liveSystemdDir = () =>
  path.join(tmpHome, ".config", "systemd", "user");

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-csa-home-"));
  tmpProjectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "haoshoku-csa-root-"),
  );
  fs.mkdirSync(repoDir(), { recursive: true });
  warnings = [];
  warningOriginal = log.warning;
  log.warning = (message) => warnings.push(message);
});

afterEach(() => {
  log.warning = warningOriginal;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpProjectRoot, { recursive: true, force: true });
});

function seedRepo() {
  fs.writeFileSync(path.join(repoDir(), SCRIPT), SCRIPT_CONTENT);
  fs.writeFileSync(path.join(repoDir(), SERVICE), SERVICE_CONTENT);
}

function seedLive() {
  fs.mkdirSync(liveScriptDir(), { recursive: true });
  fs.mkdirSync(liveSystemdDir(), { recursive: true });
  fs.writeFileSync(path.join(liveScriptDir(), SCRIPT), SCRIPT_CONTENT);
  fs.writeFileSync(path.join(liveSystemdDir(), SERVICE), SERVICE_CONTENT);
}

const NOEXEC = { enable: false };

describe("configure_claude_stay_awake module shape", () => {
  it("exports syncClaudeStayAwake, backupClaudeStayAwake, configureClaudeStayAwake", () => {
    expect(typeof csa.syncClaudeStayAwake).toBe("function");
    expect(typeof csa.backupClaudeStayAwake).toBe("function");
    expect(typeof csa.configureClaudeStayAwake).toBe("function");
  });
});

describe("syncClaudeStayAwake — repo -> live", () => {
  it("deploys the script and service to the live dirs and makes the script executable", async () => {
    seedRepo();
    await csa.syncClaudeStayAwake({
      home: tmpHome,
      projectRoot: tmpProjectRoot,
      ...NOEXEC,
    });

    const scriptDest = path.join(liveScriptDir(), SCRIPT);
    expect(fs.readFileSync(scriptDest, "utf8")).toBe(SCRIPT_CONTENT);
    expect(fs.statSync(scriptDest).mode & 0o777).toBe(0o755);
    expect(fs.readFileSync(path.join(liveSystemdDir(), SERVICE), "utf8")).toBe(
      SERVICE_CONTENT,
    );
  });

  it("skips gracefully when the repo source dir is missing", async () => {
    fs.rmSync(repoDir(), { recursive: true, force: true });
    await expect(
      csa.syncClaudeStayAwake({
        home: tmpHome,
        projectRoot: tmpProjectRoot,
        ...NOEXEC,
      }),
    ).resolves.toBeUndefined();
    expect(fs.existsSync(liveScriptDir())).toBe(false);
    expect(warnings.some((message) => message.includes("source dir"))).toBe(
      true,
    );
  });
});

describe("syncClaudeStayAwake — service auto-enable", () => {
  it("runs daemon-reload + enable --now via the runner by default", async () => {
    seedRepo();
    const calls = [];
    const runner = (args) => {
      calls.push(args);
      return { exitCode: 0 };
    };

    await csa.syncClaudeStayAwake({
      home: tmpHome,
      projectRoot: tmpProjectRoot,
      runner,
    });

    const flat = calls.map((call) => call.join(" "));
    expect(flat).toContain("systemctl --user --version");
    expect(flat).toContain("systemctl --user daemon-reload");
    expect(flat).toContain(
      "systemctl --user enable --now claude-stay-awake.service",
    );
  });

  it("does not touch systemctl when enable=false", async () => {
    seedRepo();
    const calls = [];
    const runner = (args) => {
      calls.push(args);
      return { exitCode: 0 };
    };

    await csa.syncClaudeStayAwake({
      home: tmpHome,
      projectRoot: tmpProjectRoot,
      enable: false,
      runner,
    });

    expect(calls).toHaveLength(0);
  });

  it("warns and skips enable without throwing when systemctl is unavailable", async () => {
    seedRepo();
    const calls = [];
    const runner = (args) => {
      calls.push(args);
      return { exitCode: args.includes("--version") ? 127 : 0 };
    };

    await expect(
      csa.syncClaudeStayAwake({
        home: tmpHome,
        projectRoot: tmpProjectRoot,
        runner,
      }),
    ).resolves.toBeUndefined();

    expect(calls).toEqual([["systemctl", "--user", "--version"]]);
    expect(
      warnings.some((message) =>
        message.includes("systemctl --user unavailable"),
      ),
    ).toBe(true);
  });

  it("warns and skips enable without throwing when systemctl is missing", async () => {
    seedRepo();
    const runner = () => {
      const error = new Error("Executable not found: systemctl");
      error.code = "ENOENT";
      throw error;
    };

    await expect(
      csa.syncClaudeStayAwake({
        home: tmpHome,
        projectRoot: tmpProjectRoot,
        runner,
      }),
    ).resolves.toBeUndefined();

    expect(
      warnings.some((message) =>
        message.includes("systemctl --user unavailable"),
      ),
    ).toBe(true);
  });
});

describe("backupClaudeStayAwake — live -> repo", () => {
  it("copies the live script and service into the repo dir", async () => {
    seedLive();
    await csa.backupClaudeStayAwake({
      home: tmpHome,
      projectRoot: tmpProjectRoot,
    });

    expect(fs.readFileSync(path.join(repoDir(), SCRIPT), "utf8")).toBe(
      SCRIPT_CONTENT,
    );
    expect(fs.readFileSync(path.join(repoDir(), SERVICE), "utf8")).toBe(
      SERVICE_CONTENT,
    );
  });

  it("warns and skips when the live script is missing", async () => {
    fs.mkdirSync(liveSystemdDir(), { recursive: true });
    fs.writeFileSync(path.join(liveSystemdDir(), SERVICE), SERVICE_CONTENT);

    await expect(
      csa.backupClaudeStayAwake({
        home: tmpHome,
        projectRoot: tmpProjectRoot,
      }),
    ).resolves.toBeUndefined();

    expect(fs.existsSync(path.join(repoDir(), SERVICE))).toBe(false);
    expect(warnings.some((message) => message.includes("live script"))).toBe(
      true,
    );
  });
});

describe("configureClaudeStayAwake — alias for sync", () => {
  it("deploys the script and service", async () => {
    seedRepo();
    await csa.configureClaudeStayAwake({
      home: tmpHome,
      projectRoot: tmpProjectRoot,
      ...NOEXEC,
    });

    expect(fs.existsSync(path.join(liveScriptDir(), SCRIPT))).toBe(true);
    expect(fs.existsSync(path.join(liveSystemdDir(), SERVICE))).toBe(true);
  });
});
