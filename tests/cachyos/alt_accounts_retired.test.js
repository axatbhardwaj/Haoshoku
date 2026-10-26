import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { configureUserApps } from "../../src/os_scripts/cachyos.js";

const home = homedir();
const HOMES = [".claude", ".codex", ".claude-alt", ".codex-alt"];

function seed(relative, content) {
	const file = path.join(home, relative);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
}

function snapshot(dir) {
	const entries = {};
	for (const name of fs.readdirSync(dir, { recursive: true }).sort()) {
		const file = path.join(dir, name);
		const stat = fs.lstatSync(file);
		entries[name] = stat.isSymbolicLink()
			? `link:${fs.readlinkSync(file)}`
			: stat.isDirectory()
				? "dir"
				: fs.readFileSync(file, "base64");
	}
	return entries;
}

// Only external installers are stubbed; every account step keeps its default.
function runIoboxDefault() {
	const noop = async () => {};
	return configureUserApps({
		deviceType: "iobox",
		isOmarchy: true,
		syncWorktreeCleanupImpl: noop,
		commandExistsImpl: noop,
		promptUserImpl: noop,
		configureGitImpl: noop,
		configureBrowserIntegrationImpl: noop,
		configureAudioImpl: noop,
		configureBashImpl: noop,
		configureFastfetchImpl: noop,
		configureGhosttyImpl: noop,
		runCommandImpl: noop,
		enableServicesImpl: noop,
		configureClaudeImpl: noop,
		installGhStackImpl: noop,
		configureCodexImpl: noop,
		syncAgentsConfigImpl: noop,
		configureAxstackImpl: async () => ({ ok: true }),
	});
}

describe("retired iobox alt accounts", () => {
	const clean = () => {
		for (const dir of HOMES)
			fs.rmSync(path.join(home, dir), { recursive: true, force: true });
	};
	beforeEach(() => {
		clean();
		seed(".claude/CLAUDE.md", "primary profile\n");
		seed(".claude/.credentials.json", "primary claude auth\n");
		seed(".codex/AGENTS.md", "primary profile\n");
		seed(".codex/config.toml", 'model = "primary"\n');
	});
	afterEach(clean);

	it("does not create alt homes during the iobox default run", async () => {
		await runIoboxDefault();
		expect(fs.existsSync(path.join(home, ".claude-alt"))).toBe(false);
		expect(fs.existsSync(path.join(home, ".codex-alt"))).toBe(false);
	});

	it("leaves existing alt homes byte-for-byte unchanged", async () => {
		seed(".claude-alt/.credentials.json", "alt claude auth\n");
		seed(".claude-alt/skills/own/SKILL.md", "alt skill\n");
		seed(".codex-alt/auth.json", "alt codex auth\n");
		const before = {
			claude: snapshot(path.join(home, ".claude-alt")),
			codex: snapshot(path.join(home, ".codex-alt")),
		};
		await runIoboxDefault();
		expect({
			claude: snapshot(path.join(home, ".claude-alt")),
			codex: snapshot(path.join(home, ".codex-alt")),
		}).toEqual(before);
	});
});
