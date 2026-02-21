import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { log } from "../common/utils.js";

const HOME = homedir();
const GHOSTTY_THEMES_DIR = path.join(HOME, ".config", "ghostty", "themes");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const SRC_THEMES_DIR = path.join(PROJECT_ROOT, "configs", "ghostty", "themes");

/** Deploy Ghostty themes from configs/ghostty/themes/ to ~/.config/ghostty/themes/. */
export async function syncGhosttyTheme() {
  log.info("Syncing Ghostty theme...");

  fs.mkdirSync(GHOSTTY_THEMES_DIR, { recursive: true });

  const files = fs
    .readdirSync(SRC_THEMES_DIR)
    .filter((f) => !f.startsWith(".") && f !== "CLAUDE.md");

  for (const file of files) {
    const src = path.join(SRC_THEMES_DIR, file);
    const dest = path.join(GHOSTTY_THEMES_DIR, file);
    fs.copyFileSync(src, dest);
    log.info(`Synced themes/${file}`);
  }

  log.success("Ghostty theme synced to ~/.config/ghostty/themes/");
}
