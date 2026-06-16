import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as wtc from "../src/helpers/configure_worktree_cleanup.js";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const CONFIGS_DIR = path.join(PROJECT_ROOT, "configs", "worktree-cleanup");

const SCRIPT = "cleanup-worktrees.sh";
const SERVICE = "defi-worktree-cleanup.service";
const TIMER = "defi-worktree-cleanup.timer";

const SCRIPT_CONTENT = "#!/usr/bin/env bash\necho cleanup\n";
const SERVICE_CONTENT = "[Service]\nExecStart=/x --apply\n";
const TIMER_CONTENT = "[Timer]\nOnCalendar=Fri 18:00\n";

let tmpHome;
let tmpProjectRoot;

const repoDir = () => path.join(tmpProjectRoot, "configs", "worktree-cleanup");
const liveScriptDir = () => path.join(tmpHome, "defi", ".worktree-cleanup");
const liveSystemdDir = () => path.join(tmpHome, ".config", "systemd", "user");

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-wtc-home-"));
  tmpProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-wtc-root-"));
  fs.mkdirSync(repoDir(), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpProjectRoot, { recursive: true, force: true });
});

function seedRepo({ withClaudeMd = false, withTest = false } = {}) {
  const d = repoDir();
  fs.writeFileSync(path.join(d, SCRIPT), SCRIPT_CONTENT);
  fs.writeFileSync(path.join(d, SERVICE), SERVICE_CONTENT);
  fs.writeFileSync(path.join(d, TIMER), TIMER_CONTENT);
  if (withClaudeMd) fs.writeFileSync(path.join(d, "CLAUDE.md"), "# doc\n");
  if (withTest)
    fs.writeFileSync(path.join(d, "test-cleanup.sh"), "#!/usr/bin/env bash\n");
}

function seedLive() {
  fs.mkdirSync(liveScriptDir(), { recursive: true });
  fs.mkdirSync(liveSystemdDir(), { recursive: true });
  fs.writeFileSync(path.join(liveScriptDir(), SCRIPT), SCRIPT_CONTENT);
  fs.writeFileSync(path.join(liveSystemdDir(), SERVICE), SERVICE_CONTENT);
  fs.writeFileSync(path.join(liveSystemdDir(), TIMER), TIMER_CONTENT);
}

// Copy-only tests pass enable:false so the real Bun.spawnSync (systemctl) never runs.
const NOEXEC = { enable: false };

describe("configure_worktree_cleanup module shape", () => {
  it("exports syncWorktreeCleanup, backupWorktreeCleanup, configureWorktreeCleanup", () => {
    expect(typeof wtc.syncWorktreeCleanup).toBe("function");
    expect(typeof wtc.backupWorktreeCleanup).toBe("function");
    expect(typeof wtc.configureWorktreeCleanup).toBe("function");
  });
});

describe("syncWorktreeCleanup — repo -> live", () => {
  it("copies the script to ~/defi/.worktree-cleanup/ and makes it executable", async () => {
    seedRepo();
    await wtc.syncWorktreeCleanup({
      home: tmpHome,
      projectRoot: tmpProjectRoot,
      ...NOEXEC,
    });
    const dest = path.join(liveScriptDir(), SCRIPT);
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readFileSync(dest, "utf8")).toBe(SCRIPT_CONTENT);
    expect(fs.statSync(dest).mode & 0o777).toBe(0o755);
  });

  it("copies both systemd units to ~/.config/systemd/user/", async () => {
    seedRepo();
    await wtc.syncWorktreeCleanup({
      home: tmpHome,
      projectRoot: tmpProjectRoot,
      ...NOEXEC,
    });
    expect(fs.readFileSync(path.join(liveSystemdDir(), SERVICE), "utf8")).toBe(
      SERVICE_CONTENT,
    );
    expect(fs.readFileSync(path.join(liveSystemdDir(), TIMER), "utf8")).toBe(
      TIMER_CONTENT,
    );
  });

  it("creates live dirs if missing", async () => {
    seedRepo();
    expect(fs.existsSync(liveScriptDir())).toBe(false);
    await wtc.syncWorktreeCleanup({
      home: tmpHome,
      projectRoot: tmpProjectRoot,
      ...NOEXEC,
    });
    expect(fs.existsSync(liveScriptDir())).toBe(true);
    expect(fs.existsSync(liveSystemdDir())).toBe(true);
  });

  it("does NOT deploy CLAUDE.md or test-cleanup.sh", async () => {
    seedRepo({ withClaudeMd: true, withTest: true });
    await wtc.syncWorktreeCleanup({
      home: tmpHome,
      projectRoot: tmpProjectRoot,
      ...NOEXEC,
    });
    expect(fs.existsSync(path.join(liveScriptDir(), "CLAUDE.md"))).toBe(false);
    expect(fs.existsSync(path.join(liveScriptDir(), "test-cleanup.sh"))).toBe(
      false,
    );
  });

  it("skips gracefully when the repo dir is missing", async () => {
    fs.rmSync(repoDir(), { recursive: true, force: true });
    await expect(
      wtc.syncWorktreeCleanup({
        home: tmpHome,
        projectRoot: tmpProjectRoot,
        ...NOEXEC,
      }),
    ).resolves.toBeUndefined();
    expect(fs.existsSync(liveScriptDir())).toBe(false);
  });

  it("is idempotent (running twice yields the same state)", async () => {
    seedRepo();
    await wtc.syncWorktreeCleanup({
      home: tmpHome,
      projectRoot: tmpProjectRoot,
      ...NOEXEC,
    });
    await wtc.syncWorktreeCleanup({
      home: tmpHome,
      projectRoot: tmpProjectRoot,
      ...NOEXEC,
    });
    const dest = path.join(liveScriptDir(), SCRIPT);
    expect(fs.readFileSync(dest, "utf8")).toBe(SCRIPT_CONTENT);
    expect(fs.statSync(dest).mode & 0o777).toBe(0o755);
  });
});

describe("syncWorktreeCleanup — timer auto-enable", () => {
  it("runs daemon-reload + enable --now via the runner when enable=true", async () => {
    seedRepo();
    const calls = [];
    const runner = (args) => {
      calls.push(args);
      return { exitCode: 0 };
    };
    await wtc.syncWorktreeCleanup({
      home: tmpHome,
      projectRoot: tmpProjectRoot,
      enable: true,
      runner,
    });
    const flat = calls.map((c) => c.join(" "));
    expect(flat).toContain("systemctl --user daemon-reload");
    expect(flat).toContain(
      "systemctl --user enable --now defi-worktree-cleanup.timer",
    );
  });

  it("does not touch systemctl when enable=false", async () => {
    seedRepo();
    const calls = [];
    const runner = (args) => {
      calls.push(args);
      return { exitCode: 0 };
    };
    await wtc.syncWorktreeCleanup({
      home: tmpHome,
      projectRoot: tmpProjectRoot,
      enable: false,
      runner,
    });
    expect(calls).toHaveLength(0);
  });

  it("skips enable without throwing when systemctl is unavailable", async () => {
    seedRepo();
    const runner = (args) => ({
      exitCode: args.includes("--version") ? 127 : 0,
    });
    await expect(
      wtc.syncWorktreeCleanup({
        home: tmpHome,
        projectRoot: tmpProjectRoot,
        enable: true,
        runner,
      }),
    ).resolves.toBeUndefined();
    // files were still deployed before the (skipped) enable step
    expect(fs.existsSync(path.join(liveScriptDir(), SCRIPT))).toBe(true);
  });
});

describe("backupWorktreeCleanup — live -> repo", () => {
  it("copies script + units from live into the repo dir", async () => {
    seedLive();
    await wtc.backupWorktreeCleanup({
      home: tmpHome,
      projectRoot: tmpProjectRoot,
    });
    expect(fs.readFileSync(path.join(repoDir(), SCRIPT), "utf8")).toBe(
      SCRIPT_CONTENT,
    );
    expect(fs.readFileSync(path.join(repoDir(), SERVICE), "utf8")).toBe(
      SERVICE_CONTENT,
    );
    expect(fs.readFileSync(path.join(repoDir(), TIMER), "utf8")).toBe(
      TIMER_CONTENT,
    );
  });

  it("creates the repo dir if it does not exist", async () => {
    seedLive();
    fs.rmSync(repoDir(), { recursive: true, force: true });
    await wtc.backupWorktreeCleanup({
      home: tmpHome,
      projectRoot: tmpProjectRoot,
    });
    expect(fs.existsSync(path.join(repoDir(), SCRIPT))).toBe(true);
  });

  it("skips gracefully when the live script dir is missing", async () => {
    await expect(
      wtc.backupWorktreeCleanup({ home: tmpHome, projectRoot: tmpProjectRoot }),
    ).resolves.toBeUndefined();
    expect(fs.existsSync(path.join(repoDir(), SCRIPT))).toBe(false);
  });
});

describe("sync / backup round-trip", () => {
  it("backup then sync restores identical script content", async () => {
    seedLive();
    const original = "#!/usr/bin/env bash\necho original\n";
    fs.writeFileSync(path.join(liveScriptDir(), SCRIPT), original);
    await wtc.backupWorktreeCleanup({
      home: tmpHome,
      projectRoot: tmpProjectRoot,
    });
    fs.writeFileSync(
      path.join(liveScriptDir(), SCRIPT),
      "#!/usr/bin/env bash\necho modified\n",
    );
    await wtc.syncWorktreeCleanup({
      home: tmpHome,
      projectRoot: tmpProjectRoot,
      ...NOEXEC,
    });
    expect(fs.readFileSync(path.join(liveScriptDir(), SCRIPT), "utf8")).toBe(
      original,
    );
  });
});

describe("configureWorktreeCleanup — alias for sync", () => {
  it("deploys the script (same as sync)", async () => {
    seedRepo();
    await wtc.configureWorktreeCleanup({
      home: tmpHome,
      projectRoot: tmpProjectRoot,
      ...NOEXEC,
    });
    expect(fs.existsSync(path.join(liveScriptDir(), SCRIPT))).toBe(true);
  });
});

describe("seeded configs/worktree-cleanup/ (in-tree static files)", () => {
  it("ships the script and both systemd units", () => {
    expect(fs.existsSync(path.join(CONFIGS_DIR, SCRIPT))).toBe(true);
    expect(fs.existsSync(path.join(CONFIGS_DIR, SERVICE))).toBe(true);
    expect(fs.existsSync(path.join(CONFIGS_DIR, TIMER))).toBe(true);
  });
});
