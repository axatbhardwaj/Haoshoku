import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { log, safeCopyFile } from "../common/utils.js";

const HOME_DEFAULT = homedir();
const PROJECT_ROOT_DEFAULT = path.resolve(__dirname, "..", "..");
const THEME_NAME = "Caelestia Theme"; // matches caelestia's warp.yaml template `name:`

/**
 * Resolve Warp's Linux file locations, honoring XDG_CONFIG_HOME / XDG_DATA_HOME
 * with the standard `~/.config` and `~/.local/share` fallbacks. `env` is
 * injectable so tests can exercise both default and overridden roots.
 */
export function resolveWarpPaths({ home = HOME_DEFAULT, env = process.env } = {}) {
  const cfg = env.XDG_CONFIG_HOME || path.join(home, ".config");
  const data = env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return {
    settings: path.join(cfg, "warp-terminal", "settings.toml"),
    themePath: path.join(data, "warp-terminal", "themes", "caelestia.yaml"),
    tabConfigDir: path.join(data, "warp-terminal", "tab_configs"),
  };
}

/**
 * Pure, idempotent edit of a Warp `settings.toml` string: ensure the
 * `[appearance.themes]` table sets `system_theme = false` and points `theme`
 * at the custom Caelestia theme object. Custom themes require the object form
 * (`theme = { custom = { name, path } }`); a bare string selects a built-in.
 *
 * Handles three cases: section present (replace/insert the two keys), section
 * absent with other config (append), and empty input (emit just the section).
 */
export function patchWarpSettings(content, { name, path: themePath }) {
  const themeLine = `theme = { custom = { name = "${name}", path = "${themePath}" } }`;
  const sysLine = "system_theme = false";
  const header = "[appearance.themes]";
  const lines = content.split("\n");
  const hi = lines.findIndex((l) => l.trim() === header);

  if (hi === -1) {
    const section = `${header}\n${sysLine}\n${themeLine}\n`;
    if (content.trim() === "") return section;
    return `${content.replace(/\n*$/, "\n")}\n${section}`;
  }

  // The table runs until the next "[...]" header or EOF.
  let end = lines.length;
  for (let i = hi + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) {
      end = i;
      break;
    }
  }

  const setKey = (re, line) => {
    for (let i = hi + 1; i < end; i++) {
      if (re.test(lines[i])) {
        lines[i] = line;
        return;
      }
    }
    lines.splice(hi + 1, 0, line); // insert directly under the header
    end++;
  };

  setKey(/^\s*system_theme\s*=/, sysLine);
  setKey(/^\s*theme\s*=/, themeLine);
  return lines.join("\n");
}

/**
 * Configure Warp: deploy the agents Tab Config and activate the
 * Caelestia-generated theme in `settings.toml`. Caelestia owns the theme file
 * (its `warp.yaml` template regenerates `caelestia.yaml` on every scheme
 * change); we only point Warp at it. Creates a minimal `settings.toml` when
 * absent so fresh installs are themed too. Mutates settings safely: skips the
 * write when content is unchanged (idempotent, no backup churn), keeps a
 * one-time `.bak`, and writes atomically via a temp file + rename.
 */
export async function configureWarp({
  home = HOME_DEFAULT,
  env = process.env,
  projectRoot = PROJECT_ROOT_DEFAULT,
} = {}) {
  const { settings, themePath, tabConfigDir } = resolveWarpPaths({ home, env });

  // Deploy the agents Tab Config (independent of theme state, so the theme
  // early-return below can never skip it).
  const tabConfigSrc = path.join(
    projectRoot,
    "configs",
    "warp",
    "tab_configs",
    "agents.toml",
  );
  if (fs.existsSync(tabConfigSrc)) {
    fs.mkdirSync(tabConfigDir, { recursive: true });
    safeCopyFile(tabConfigSrc, path.join(tabConfigDir, "agents.toml"));
    log.info("Deployed Warp agents tab config.");
  }

  // Activate the Caelestia-generated theme.
  if (!fs.existsSync(themePath)) {
    log.warning(
      `Caelestia Warp theme not found at ${themePath} — Caelestia generates it on scheme apply; activating anyway.`,
    );
  }

  const original = fs.existsSync(settings)
    ? fs.readFileSync(settings, "utf8")
    : "";
  const patched = patchWarpSettings(original, {
    name: THEME_NAME,
    path: themePath,
  });
  if (patched === original) {
    log.info("Warp theme already active — no change.");
    return;
  }

  fs.mkdirSync(path.dirname(settings), { recursive: true });
  if (original !== "" && !fs.existsSync(`${settings}.bak`)) {
    fs.copyFileSync(settings, `${settings}.bak`); // one-time backup of user state
  }
  const tmp = `${settings}.tmp`; // atomic write: temp + rename
  fs.writeFileSync(tmp, patched);
  fs.renameSync(tmp, settings);

  log.success(
    original === ""
      ? "Created Warp settings.toml with Caelestia theme."
      : "Activated Caelestia Warp theme in settings.toml.",
  );
}
