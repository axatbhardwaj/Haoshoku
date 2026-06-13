import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { log, safeCopyFile } from "../common/utils.js";

const HOME = homedir();
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CUSTOM_CODEX_DIR = path.join(PROJECT_ROOT, "configs", "codex");

// ~/.codex also holds runtime state (auth.json, *.sqlite, history.jsonl) —
// only AGENTS.md is reproducible config. Exported for the manifest test.
export const CODEX_PERSONAL_FILES = [{ src: "AGENTS.md" }];

/** Resolve where a CODEX_PERSONAL_FILES entry lives on a given $HOME (inside ~/.codex/). */
function codexFilePath(src, home = HOME) {
  return path.join(home, ".codex", src);
}

/**
 * Deploy config to ~/.codex/ (copy personal files from haoshoku template).
 * Mirrors syncClaudeConfig: safeCopyFile preserves a differing live file as
 * ${dest}.bak before overwriting; identical content is a no-op.
 */
export async function syncCodexConfig(options = {}) {
  const { srcDir = CUSTOM_CODEX_DIR, codexHome = HOME } = options;
  const codexDir = path.join(codexHome, ".codex");

  log.info("Syncing Codex config...");
  fs.mkdirSync(codexDir, { recursive: true });

  for (const file of CODEX_PERSONAL_FILES) {
    const srcPath = path.join(srcDir, file.src);
    const destPath = codexFilePath(file.src, codexHome);
    if (fs.existsSync(srcPath)) {
      safeCopyFile(srcPath, destPath);
      log.info(`Copied ${file.src}`);
    } else {
      log.warning(`Missing ${file.src} in source bundle (${srcPath}) — skipped`);
    }
  }

  log.success("Codex config synced.");
}

/** Copy personal files from ~/.codex/ to configs/codex/ for version control. */
export async function backupCodexConfig(options = {}) {
  const { srcDir = CUSTOM_CODEX_DIR, codexHome = HOME } = options;

  log.info("Backing up Codex config...");
  fs.mkdirSync(srcDir, { recursive: true });

  for (const file of CODEX_PERSONAL_FILES) {
    const livePath = codexFilePath(file.src, codexHome);
    if (fs.existsSync(livePath)) {
      fs.copyFileSync(livePath, path.join(srcDir, file.src));
      log.info(`Backed up ${file.src}`);
    }
  }

  log.success("Codex config backed up to configs/codex/");
}

/** Deploy Codex config (used by OS setup scripts). Config-only — no CLI install. */
export async function configureCodex() {
  await syncCodexConfig();
}
