import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { log, runCommand, safeCopyFile } from "../common/utils.js";

const HOME = homedir();
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const ASSETS_DIR = path.join(PROJECT_ROOT, "configs", "agent-os");
const AGENT_OS_REPO = "https://github.com/buildermethods/agent-os.git";
const AGENT_OS_DIR = path.join(HOME, "agent-os");

/** Read the pinned upstream Agent OS commit the customization is verified against. */
export function readPinnedSha(assetsDir = ASSETS_DIR) {
  return fs.readFileSync(path.join(assetsDir, "AGENT_OS_SHA"), "utf-8").trim();
}

/**
 * Clone (or fetch) buildermethods/agent-os into ~/agent-os and hard-reset to the
 * pinned SHA. reset --hard is idempotent: it discards a prior overlay or any
 * dirty tracked file so re-runs (and SHA bumps) land on a clean pinned tree.
 */
export async function installAgentOs(options = {}) {
  const {
    assetsDir = ASSETS_DIR,
    agentOsDir = AGENT_OS_DIR,
    repo = AGENT_OS_REPO,
  } = options;
  const sha = readPinnedSha(assetsDir);
  log.info(`Provisioning Agent OS @ ${sha}...`);

  if (!fs.existsSync(agentOsDir)) {
    if (!(await runCommand(`git clone ${repo} ${agentOsDir}`))) {
      log.error("Agent OS clone failed.");
      return false;
    }
  } else {
    await runCommand(`git -C ${agentOsDir} fetch --quiet origin`);
  }

  if (!(await runCommand(`git -C ${agentOsDir} reset --hard --quiet ${sha}`))) {
    log.error(`Agent OS reset to ${sha} failed.`);
    return false;
  }

  log.success(`Agent OS at ${sha}.`);
  return true;
}

/**
 * Overlay the customized shape-spec.md onto the clone and seed standards into the
 * installer-readable profile path. Overwrite semantics come from safeCopyFile.
 */
export function overlayCustomizations(options = {}) {
  const { assetsDir = ASSETS_DIR, agentOsDir = AGENT_OS_DIR } = options;

  safeCopyFile(
    path.join(assetsDir, "commands", "shape-spec.md"),
    path.join(agentOsDir, "commands", "agent-os", "shape-spec.md"),
  );
  log.info("Overlaid customized shape-spec.md");

  const seedDir = path.join(assetsDir, "standards", "global");
  const destDir = path.join(
    agentOsDir,
    "profiles",
    "default",
    "standards",
    "global",
  );
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of fs.readdirSync(seedDir)) {
    safeCopyFile(path.join(seedDir, file), path.join(destDir, file));
  }
  log.success("Seeded Agent OS standards.");
}

/** Provision Agent OS and apply our customizations (used by OS setup scripts + --agent-os). */
export async function configureAgentOs(options = {}) {
  if (await installAgentOs(options)) overlayCustomizations(options);
}
