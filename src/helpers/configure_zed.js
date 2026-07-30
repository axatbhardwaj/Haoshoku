import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { log, safeCopyFile } from "../common/utils.js";

const HOME = homedir();
const ZED_CONFIG_DIR = path.join(HOME, ".config", "zed");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CONFIGS_DIR = path.join(PROJECT_ROOT, "configs");
const ZED_BACKUP_DIR = path.join(CONFIGS_DIR, "zed");

const SENSITIVE_KEYS = ["ssh_connections"];

// Any object key whose name matches this is a credential and must never land
// in the public repo backup. Kept deliberately broad — a false positive (a
// stripped non-secret) is a cosmetic loss in a backup; a false negative is a
// leaked secret. `authorization` also covers Proxy-Authorization /
// X-Authorization via substring match.
const SENSITIVE_KEY_RE =
  /token|secret|passw|api[-_]?key|apikey|access[-_]?key|bearer|credential|private[-_]?key|authorization/i;

// Inside a `headers` object the bar is lower: header names routinely carry
// credentials under names the global regex misses (Cookie, X-Auth, …).
const SENSITIVE_HEADER_RE =
  /auth|token|cookie|session|secret|signature|credential|key/i;

// A header VALUE that starts with an HTTP auth scheme is a credential no
// matter what the header is called (e.g. `X-Custom: "Bearer <token>"`).
const AUTH_SCHEME_VALUE_RE =
  /^\s*(bearer|basic|digest|negotiate|oauth|token|dpop|hawk)\s+\S/i;

/**
 * Sanitize a `headers` object: drop any entry whose NAME looks credential-ish
 * (SENSITIVE_HEADER_RE) or whose string VALUE starts with an HTTP auth scheme
 * (AUTH_SCHEME_VALUE_RE). Benign headers (Content-Type, Accept, …) survive.
 */
function sanitizeHeaders(headers, pathPrefix, stripped) {
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    const headerPath = `${pathPrefix}.${name}`;
    if (
      SENSITIVE_HEADER_RE.test(name) ||
      (typeof value === "string" && AUTH_SCHEME_VALUE_RE.test(value))
    ) {
      stripped.push(headerPath);
      continue;
    }
    result[name] = value;
  }
  return result;
}

/**
 * Tolerant JSONC → JSON strip. Zed writes `//` line comments, `/* *​/` block
 * comments, inline comments after values, and trailing commas — none of which
 * `JSON.parse` accepts. We walk the characters tracking in-string state (so a
 * `//` or `/*` inside a string literal, e.g. a URL, is preserved) and honoring
 * backslash escapes, drop both comment forms, and strip trailing commas that
 * precede a `}` or `]`.
 *
 * The trailing-comma strip is done inside the same character walk rather than a
 * post-hoc global regex: a regex would also rewrite `,}` / `,]` that appears
 * *inside a string value* (data, not syntax), silently corrupting it. We buffer
 * a structural comma (and any following whitespace) and only emit it once we
 * know the next significant character is not a closing brace/bracket; if it is,
 * the buffered comma is dropped.
 */
function stripJsonComments(jsonc) {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;
  // Holds a structural comma awaiting a lookahead decision, plus any whitespace
  // seen after it. Empty string means no comma is currently buffered.
  let pendingComma = "";

  // Flush a buffered comma (with its trailing whitespace) to the output. Called
  // when the next significant char proves the comma was NOT trailing.
  const flushComma = () => {
    out += pendingComma;
    pendingComma = "";
  };

  for (let i = 0; i < jsonc.length; i++) {
    const ch = jsonc[i];
    const next = jsonc[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        // A comment between a comma and `}`/`]` does not make the comma
        // non-trailing — accumulate the newline onto the pending comma if one
        // is buffered, otherwise emit it directly.
        if (pendingComma) {
          pendingComma += ch;
        } else {
          out += ch;
        }
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    // Not in a string or comment.
    if (ch === '"') {
      flushComma();
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    if (pendingComma) {
      // Deciding the fate of a buffered comma.
      if (ch === "}" || ch === "]") {
        // Trailing comma: drop it, keep the buffered whitespace, then emit the
        // closing bracket.
        out += pendingComma.slice(1);
        pendingComma = "";
        out += ch;
      } else if (/\s/.test(ch)) {
        // Whitespace after the comma — keep buffering until we see the next
        // significant character.
        pendingComma += ch;
      } else {
        // Real value follows: the comma was a separator, not trailing.
        flushComma();
        out += ch;
      }
      continue;
    }

    if (ch === ",") {
      // Buffer this comma pending a lookahead decision.
      pendingComma = ",";
      continue;
    }

    out += ch;
  }

  // A comma buffered at EOF (e.g. trailing comma with no closing token) is
  // emitted verbatim; JSON.parse will surface any genuine syntax error.
  flushComma();
  return out;
}

/**
 * Recursively strip sensitive entries from a settings value, collecting the
 * JSON path of everything removed so the caller can report it.
 *
 * Rules:
 *   - Top-level `ssh_connections` is removed (handled by the caller seed).
 *   - Any object entry whose key matches SENSITIVE_KEY_RE is deleted.
 *   - Any object entry keyed `env` whose value is a plain object is deleted
 *     (MCP `context_servers` carry tokens in env blocks).
 *   - `headers` objects get per-entry scrutiny via sanitizeHeaders (credential
 *     header names and auth-scheme values are dropped, benign headers kept).
 *   - Arrays and nested objects are walked; non-stripped values recurse.
 *
 * @param {*} value
 * @param {string} pathPrefix - JSON path of `value` (for reporting)
 * @param {string[]} stripped - accumulator of stripped paths
 * @returns {*} the sanitized value
 */
function sanitizeValue(value, pathPrefix, stripped) {
  if (Array.isArray(value)) {
    return value.map((item, idx) =>
      sanitizeValue(item, `${pathPrefix}[${idx}]`, stripped),
    );
  }
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      const childPath = pathPrefix ? `${pathPrefix}.${key}` : key;

      if (SENSITIVE_KEY_RE.test(key)) {
        stripped.push(childPath);
        continue;
      }
      if (
        key === "env" &&
        child &&
        typeof child === "object" &&
        !Array.isArray(child)
      ) {
        stripped.push(childPath);
        continue;
      }
      if (
        key.toLowerCase() === "headers" &&
        child &&
        typeof child === "object" &&
        !Array.isArray(child)
      ) {
        result[key] = sanitizeHeaders(child, childPath, stripped);
        continue;
      }

      result[key] = sanitizeValue(child, childPath, stripped);
    }
    return result;
  }
  return value;
}

/**
 * Remove sensitive keys from a settings object: the top-level
 * `ssh_connections` block plus any nested credential-shaped key at any depth.
 * Logs each stripped path so the user can see what was withheld.
 */
function sanitizeSettings(settings) {
  const seeded = { ...settings };
  for (const key of SENSITIVE_KEYS) {
    delete seeded[key];
  }

  const stripped = [];
  const sanitized = sanitizeValue(seeded, "", stripped);
  for (const strippedPath of stripped) {
    log.warning(`stripped ${strippedPath} (sensitive)`);
  }
  return sanitized;
}

/**
 * Backup Zed config from ~/.config/zed to configs/zed (sanitized).
 *
 * @param {{ zedConfigDir?: string, backupDir?: string }} [opts]
 */
export async function backupZedConfig(opts = {}) {
  const { zedConfigDir = ZED_CONFIG_DIR, backupDir = ZED_BACKUP_DIR } = opts;

  log.info("Backing up Zed config...");

  fs.mkdirSync(backupDir, { recursive: true });
  fs.mkdirSync(path.join(backupDir, "themes"), { recursive: true });

  const settingsPath = path.join(zedConfigDir, "settings.json");
  if (fs.existsSync(settingsPath)) {
    const raw = fs.readFileSync(settingsPath, "utf-8");
    const stripped = stripJsonComments(raw);
    // A malformed settings.json must not abort the whole backup — skip it and
    // continue with keymap + themes.
    let settings;
    try {
      settings = JSON.parse(stripped);
    } catch (err) {
      settings = null;
      log.error(
        `Could not parse ${settingsPath} (${err.message}) — skipping settings.json backup (check for unterminated strings or invalid JSON).`,
      );
    }
    if (settings !== null) {
      const sanitized = sanitizeSettings(settings);
      const output = JSON.stringify(sanitized, null, 2);
      fs.writeFileSync(path.join(backupDir, "settings.json"), output);
      log.info("Backed up settings.json (sanitized)");
    }
  }

  const keymapPath = path.join(zedConfigDir, "keymap.json");
  if (fs.existsSync(keymapPath)) {
    fs.copyFileSync(keymapPath, path.join(backupDir, "keymap.json"));
    log.info("Backed up keymap.json");
  }

  const themesDir = path.join(zedConfigDir, "themes");
  if (fs.existsSync(themesDir)) {
    const themes = fs.readdirSync(themesDir);
    for (const theme of themes) {
      const src = path.join(themesDir, theme);
      const dest = path.join(backupDir, "themes", theme);
      fs.copyFileSync(src, dest);
      log.info(`Backed up themes/${theme}`);
    }
  }

  log.success("Zed config backed up to configs/zed/");
}

/**
 * Deploy Zed themes from configs/zed/themes/ to ~/.config/zed/themes/.
 *
 * @param {{ zedConfigDir?: string, backupDir?: string }} [opts]
 */
export async function syncZedTheme(opts = {}) {
  const { zedConfigDir = ZED_CONFIG_DIR, backupDir = ZED_BACKUP_DIR } = opts;

  log.info("Syncing Zed theme...");

  fs.mkdirSync(path.join(zedConfigDir, "themes"), { recursive: true });

  const themesDir = path.join(backupDir, "themes");
  if (fs.existsSync(themesDir)) {
    const themes = fs.readdirSync(themesDir);
    for (const theme of themes) {
      const src = path.join(themesDir, theme);
      const dest = path.join(zedConfigDir, "themes", theme);
      safeCopyFile(src, dest);
      log.info(`Synced themes/${theme}`);
    }
  }

  log.success("Zed theme synced to ~/.config/zed/themes/");
}

/**
 * Deploy Zed config from configs/zed to ~/.config/zed.
 *
 * @param {{ zedConfigDir?: string, backupDir?: string }} [opts]
 */
export async function syncZedConfig(opts = {}) {
  const { zedConfigDir = ZED_CONFIG_DIR, backupDir = ZED_BACKUP_DIR } = opts;

  log.info("Syncing Zed config...");

  fs.mkdirSync(zedConfigDir, { recursive: true });

  const settingsPath = path.join(backupDir, "settings.json");
  if (fs.existsSync(settingsPath)) {
    safeCopyFile(settingsPath, path.join(zedConfigDir, "settings.json"));
    log.info("Synced settings.json");
  }

  const keymapPath = path.join(backupDir, "keymap.json");
  if (fs.existsSync(keymapPath)) {
    safeCopyFile(keymapPath, path.join(zedConfigDir, "keymap.json"));
    log.info("Synced keymap.json");
  }

  await syncZedTheme(opts);

  log.success("Zed config synced to ~/.config/zed/");
}

/** Deploy full Zed config (used by OS setup scripts). */
export async function configureZed() {
  await syncZedConfig();
}
