import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { log } from "../src/common/utils.js";
import * as prw from "../src/helpers/configure_pr_watch.js";

const FILES = ["pr-watch.js", "pr-watch"];
const CONTENTS = {
  "pr-watch.js": "export const watcher = true;\n",
  "pr-watch": "#!/usr/bin/env bash\necho watch\n",
};
const PROJECT_ROOT = path.resolve(import.meta.dir, "..");

let tmpHome;
let tmpProjectRoot;
let warnings;
let warningOriginal;

const repoDir = () => path.join(tmpProjectRoot, "configs", "pr-watch");
const liveDir = () => path.join(tmpHome, ".local", "bin");

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-prw-home-"));
  tmpProjectRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "haoshoku-prw-root-"),
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
  for (const file of FILES) {
    fs.writeFileSync(path.join(repoDir(), file), CONTENTS[file]);
  }
}

function seedLive() {
  fs.mkdirSync(liveDir(), { recursive: true });
  for (const file of FILES) {
    fs.writeFileSync(path.join(liveDir(), file), CONTENTS[file]);
  }
}

describe("configure_pr_watch module shape", () => {
  it("exports syncPrWatch, backupPrWatch, configurePrWatch", () => {
    expect(typeof prw.syncPrWatch).toBe("function");
    expect(typeof prw.backupPrWatch).toBe("function");
    expect(typeof prw.configurePrWatch).toBe("function");
  });
});

describe("syncPrWatch — repo -> live", () => {
  it("deploys both files to ~/.local/bin and makes both executable", async () => {
    seedRepo();

    await prw.syncPrWatch({
      home: tmpHome,
      projectRoot: tmpProjectRoot,
    });

    for (const file of FILES) {
      const destination = path.join(liveDir(), file);
      expect(fs.readFileSync(destination, "utf8")).toBe(CONTENTS[file]);
      expect(fs.statSync(destination).mode & 0o777).toBe(0o755);
    }
  });

  it("skips cleanly with a warning when the repo source dir is missing", async () => {
    fs.rmSync(repoDir(), { recursive: true, force: true });

    await expect(
      prw.syncPrWatch({
        home: tmpHome,
        projectRoot: tmpProjectRoot,
      }),
    ).resolves.toBeUndefined();

    expect(fs.existsSync(liveDir())).toBe(false);
    expect(warnings.some((message) => message.includes("source dir"))).toBe(
      true,
    );
  });
});

describe("backupPrWatch — live -> repo", () => {
  it("copies both live files back into configs/pr-watch", async () => {
    fs.rmSync(repoDir(), { recursive: true, force: true });
    seedLive();

    await prw.backupPrWatch({
      home: tmpHome,
      projectRoot: tmpProjectRoot,
    });

    for (const file of FILES) {
      expect(fs.readFileSync(path.join(repoDir(), file), "utf8")).toBe(
        CONTENTS[file],
      );
    }
  });

  it("skips cleanly with a warning when the live files are missing", async () => {
    await expect(
      prw.backupPrWatch({
        home: tmpHome,
        projectRoot: tmpProjectRoot,
      }),
    ).resolves.toBeUndefined();

    expect(warnings.some((message) => message.includes("live pr-watch"))).toBe(
      true,
    );
  });
});

describe("configurePrWatch — alias for sync", () => {
  it("deploys both watcher files", async () => {
    seedRepo();

    await prw.configurePrWatch({
      home: tmpHome,
      projectRoot: tmpProjectRoot,
    });

    for (const file of FILES) {
      expect(fs.existsSync(path.join(liveDir(), file))).toBe(true);
    }
  });
});

describe("pr-watch Haoshoku wiring", () => {
  const readHaoshoku = () =>
    fs.readFileSync(path.join(PROJECT_ROOT, "haoshoku.js"), "utf8");
  const readCachyos = () =>
    fs.readFileSync(
      path.join(PROJECT_ROOT, "src", "os_scripts", "cachyos.js"),
      "utf8",
    );

  it("wires both pr-watch CLI options to their sync and backup handlers", () => {
    const source = readHaoshoku();
    expect(source).toMatch(
      /import\s+\{[^}]*\bbackupPrWatch\b[^}]*\bsyncPrWatch\b[^}]*\}\s+from\s+["']\.\/src\/helpers\/configure_pr_watch\.js["']/,
    );
    expect(source).toMatch(/\.option\(\s*["']--pr-watch["']/);
    expect(source).toMatch(/\.option\(\s*["']--pr-watch-backup["']/);
    expect(source).toMatch(
      /if\s*\(\s*options\.prWatchBackup\s*\)\s*\{\s*await\s+backupPrWatch\(\s*\)\s*;\s*return\s*;\s*\}/,
    );
    expect(source).toMatch(
      /if\s*\(\s*options\.prWatch\s*\)\s*\{\s*await\s+syncPrWatch\(\s*\)\s*;\s*return\s*;\s*\}/,
    );
    expect(source).toMatch(
      /\.\.\.\["prWatch", "prWatchBackup"\]\.filter\(\(flag\) => options\[flag\]\)/,
    );
  });

  it("imports and awaits configurePrWatch in the CachyOS app setup", () => {
    const source = readCachyos();
    expect(source).toMatch(
      /import\s+\{\s*configurePrWatch\s*\}\s+from\s+["']\.\.\/helpers\/configure_pr_watch\.js["']/,
    );
    expect(source).toMatch(/await\s+configurePrWatch\(\s*\)\s*;/);
    expect(source.indexOf("await configurePrWatch();")).toBeGreaterThan(
      source.indexOf("await configureClaudeStayAwake();"),
    );
  });

  it("ships a three-line executable wrapper using the absolute Bun path", () => {
    const wrapperPath = path.join(
      PROJECT_ROOT,
      "configs",
      "pr-watch",
      "pr-watch",
    );
    const lines = fs.readFileSync(wrapperPath, "utf8").trimEnd().split("\n");
    const dollar = "$";

    expect(lines).toEqual([
      "#!/usr/bin/env bash",
      `SCRIPT_DIR="$(cd -- "$(dirname -- "${dollar}{BASH_SOURCE[0]}")" && pwd)"`,
      'exec /usr/bin/bun "$SCRIPT_DIR/pr-watch.js" "$@"',
    ]);
    expect(fs.statSync(wrapperPath).mode & 0o777).toBe(0o755);
  });

  it("documents configure_pr_watch.js in the helper inventory", () => {
    const source = fs.readFileSync(
      path.join(PROJECT_ROOT, "src", "helpers", "CLAUDE.md"),
      "utf8",
    );

    expect(source).toMatch(
      /\| `configure_pr_watch\.js` \| pr-watch PR watcher sync\/backup \| Adding or debugging the PR watcher deploy \|/,
    );
  });
});
