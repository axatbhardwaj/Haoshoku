import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as mimeapps from "../src/helpers/configure_mimeapps.js";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const CONFIGS_MIMEAPPS_DIR = path.join(PROJECT_ROOT, "configs", "mimeapps");

let tmpHome;
let tmpProjectRoot;

beforeEach(() => {
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-mimeapps-home-"));
	tmpProjectRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "haoshoku-mimeapps-root-"),
	);
	// Seed the repo directory skeleton
	fs.mkdirSync(path.join(tmpProjectRoot, "configs", "mimeapps"), {
		recursive: true,
	});
});

afterEach(() => {
	fs.rmSync(tmpHome, { recursive: true, force: true });
	fs.rmSync(tmpProjectRoot, { recursive: true, force: true });
});

const FIXTURE_CONTENT = "[Default Applications]\ntext/plain=zed.desktop\n";
const CLAUDE_HANDLER_DESKTOP = `[Desktop Entry]
Name=Claude Code URL Handler
Comment=Handle claude-cli:// deep links for Claude Code
Exec=claude --handle-uri %u
Type=Application
NoDisplay=true
MimeType=x-scheme-handler/claude-cli;
`;

/** Seed a mimeapps.list in the repo configs dir. */
function seedRepoMimeapps() {
	fs.writeFileSync(
		path.join(tmpProjectRoot, "configs", "mimeapps", "mimeapps.list"),
		FIXTURE_CONTENT,
	);
}

function seedRepoDesktopHandlers() {
	const applicationsDir = path.join(
		tmpProjectRoot,
		"configs",
		"mimeapps",
		"applications",
	);
	fs.mkdirSync(applicationsDir, { recursive: true });
	fs.writeFileSync(
		path.join(applicationsDir, "claude-code-url-handler.desktop"),
		CLAUDE_HANDLER_DESKTOP,
	);
}

/** Seed a mimeapps.list in the live ~/.config dir. */
function seedLiveMimeapps() {
	fs.mkdirSync(path.join(tmpHome, ".config"), { recursive: true });
	fs.writeFileSync(
		path.join(tmpHome, ".config", "mimeapps.list"),
		FIXTURE_CONTENT,
	);
}

// ---------------------------------------------------------------------------
// Module shape
// ---------------------------------------------------------------------------

describe("configure_mimeapps module shape", () => {
	it("exports syncMimeappsConfig, backupMimeappsConfig, configureMimeapps", () => {
		expect(typeof mimeapps.syncMimeappsConfig).toBe("function");
		expect(typeof mimeapps.backupMimeappsConfig).toBe("function");
		expect(typeof mimeapps.configureMimeapps).toBe("function");
	});
});

// ---------------------------------------------------------------------------
// syncMimeappsConfig — repo → live
// ---------------------------------------------------------------------------

describe("syncMimeappsConfig — deploys mimeapps.list to ~/.config/", () => {
	it("copies configs/mimeapps/mimeapps.list to ~/.config/mimeapps.list", async () => {
		seedRepoMimeapps();
		await mimeapps.syncMimeappsConfig({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const dest = path.join(tmpHome, ".config", "mimeapps.list");
		expect(fs.existsSync(dest)).toBe(true);
		expect(fs.readFileSync(dest, "utf8")).toBe(FIXTURE_CONTENT);
	});

	it("creates ~/.config/ if it does not exist", async () => {
		seedRepoMimeapps();
		expect(fs.existsSync(path.join(tmpHome, ".config"))).toBe(false);

		await mimeapps.syncMimeappsConfig({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		expect(fs.existsSync(path.join(tmpHome, ".config"))).toBe(true);
	});

	it("skips gracefully when repo source file is missing", async () => {
		// No seedRepoMimeapps — configs/mimeapps/ dir exists but file is absent
		await expect(
			mimeapps.syncMimeappsConfig({
				home: tmpHome,
				projectRoot: tmpProjectRoot,
			}),
		).resolves.toBeUndefined();

		// Nothing deployed to live
		expect(fs.existsSync(path.join(tmpHome, ".config", "mimeapps.list"))).toBe(
			false,
		);
	});

	it("is idempotent (running twice yields the same file)", async () => {
		seedRepoMimeapps();
		await mimeapps.syncMimeappsConfig({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});
		await mimeapps.syncMimeappsConfig({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		expect(
			fs.readFileSync(path.join(tmpHome, ".config", "mimeapps.list"), "utf8"),
		).toBe(FIXTURE_CONTENT);
	});

	it("deploys managed .desktop handlers to ~/.local/share/applications/", async () => {
		seedRepoMimeapps();
		seedRepoDesktopHandlers();
		await mimeapps.syncMimeappsConfig({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const handler = path.join(
			tmpHome,
			".local",
			"share",
			"applications",
			"claude-code-url-handler.desktop",
		);
		expect(fs.existsSync(handler)).toBe(true);
		expect(fs.readFileSync(handler, "utf8")).toContain(
			"MimeType=x-scheme-handler/claude-cli;",
		);
	});

	it("removes retired streaming desktop entries from ~/.local/share/applications/", async () => {
		seedRepoMimeapps();
		const liveApplicationsDir = path.join(
			tmpHome,
			".local",
			"share",
			"applications",
		);
		fs.mkdirSync(liveApplicationsDir, { recursive: true });
		for (const desktop of [
			"zee5-hd.desktop",
			"crunchyroll-hd.desktop",
			"jiohotstar-hd.desktop",
			"primevideo-hd.desktop",
		]) {
			fs.writeFileSync(
				path.join(liveApplicationsDir, desktop),
				"[Desktop Entry]\n",
			);
		}

		await mimeapps.syncMimeappsConfig({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		for (const desktop of [
			"zee5-hd.desktop",
			"crunchyroll-hd.desktop",
			"jiohotstar-hd.desktop",
			"primevideo-hd.desktop",
		]) {
			expect(fs.existsSync(path.join(liveApplicationsDir, desktop))).toBe(
				false,
			);
		}
	});
});

// ---------------------------------------------------------------------------
// backupMimeappsConfig — live → repo
// ---------------------------------------------------------------------------

describe("backupMimeappsConfig — snapshots ~/.config/mimeapps.list into repo", () => {
	it("copies ~/.config/mimeapps.list to configs/mimeapps/mimeapps.list", async () => {
		seedLiveMimeapps();
		await mimeapps.backupMimeappsConfig({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const dest = path.join(
			tmpProjectRoot,
			"configs",
			"mimeapps",
			"mimeapps.list",
		);
		expect(fs.existsSync(dest)).toBe(true);
		expect(fs.readFileSync(dest, "utf8")).toBe(FIXTURE_CONTENT);
	});

	it("creates configs/mimeapps/ dir if it does not exist", async () => {
		seedLiveMimeapps();
		// Remove the pre-seeded dir
		fs.rmSync(path.join(tmpProjectRoot, "configs", "mimeapps"), {
			recursive: true,
			force: true,
		});
		expect(
			fs.existsSync(path.join(tmpProjectRoot, "configs", "mimeapps")),
		).toBe(false);

		await mimeapps.backupMimeappsConfig({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		expect(
			fs.existsSync(path.join(tmpProjectRoot, "configs", "mimeapps")),
		).toBe(true);
	});

	it("skips gracefully when live file is missing", async () => {
		// No seedLiveMimeapps — ~/.config/mimeapps.list absent
		await expect(
			mimeapps.backupMimeappsConfig({
				home: tmpHome,
				projectRoot: tmpProjectRoot,
			}),
		).resolves.toBeUndefined();

		// Nothing written to repo
		expect(
			fs.existsSync(
				path.join(tmpProjectRoot, "configs", "mimeapps", "mimeapps.list"),
			),
		).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe("sync / backup round-trip", () => {
	it("backup then sync restores identical content", async () => {
		const originalContent = "[Default Applications]\nvideo/mp4=vlc.desktop\n";

		// Seed live with original content
		fs.mkdirSync(path.join(tmpHome, ".config"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpHome, ".config", "mimeapps.list"),
			originalContent,
		);

		// Backup to repo
		await mimeapps.backupMimeappsConfig({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		// Overwrite live with something else
		fs.writeFileSync(
			path.join(tmpHome, ".config", "mimeapps.list"),
			"[Default Applications]\ntext/plain=other.desktop\n",
		);

		// Sync back from repo
		await mimeapps.syncMimeappsConfig({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		expect(
			fs.readFileSync(path.join(tmpHome, ".config", "mimeapps.list"), "utf8"),
		).toBe(originalContent);
	});
});

// ---------------------------------------------------------------------------
// safeCopyFile integration — .bak preservation across runs
// ---------------------------------------------------------------------------

describe("syncMimeappsConfig — .bak backup behavior", () => {
	it("creates a .bak of the live file on first sync (file had different content)", async () => {
		// Seed a pre-existing live file with different content than repo
		const ORIGINAL_LIVE = "[Default Applications]\ntext/html=firefox.desktop\n";
		fs.mkdirSync(path.join(tmpHome, ".config"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpHome, ".config", "mimeapps.list"),
			ORIGINAL_LIVE,
		);
		seedRepoMimeapps();

		await mimeapps.syncMimeappsConfig({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const bakPath = path.join(tmpHome, ".config", "mimeapps.list.bak");
		expect(fs.existsSync(bakPath)).toBe(true);
		expect(fs.readFileSync(bakPath, "utf8")).toBe(ORIGINAL_LIVE);
		// live file is now the repo version
		expect(
			fs.readFileSync(path.join(tmpHome, ".config", "mimeapps.list"), "utf8"),
		).toBe(FIXTURE_CONTENT);
	});

	it("preserves original .bak across two syncs (second run is no-op when content unchanged)", async () => {
		const ORIGINAL_LIVE = "[Default Applications]\ntext/html=firefox.desktop\n";
		fs.mkdirSync(path.join(tmpHome, ".config"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpHome, ".config", "mimeapps.list"),
			ORIGINAL_LIVE,
		);
		seedRepoMimeapps();

		// First sync: writes FIXTURE_CONTENT, backs up ORIGINAL_LIVE → .bak
		await mimeapps.syncMimeappsConfig({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		// Second sync: live already matches repo → no-op; .bak still holds the original
		await mimeapps.syncMimeappsConfig({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const bakPath = path.join(tmpHome, ".config", "mimeapps.list.bak");
		expect(fs.existsSync(bakPath)).toBe(true);
		// .bak must still be the ORIGINAL — not overwritten with FIXTURE_CONTENT
		expect(fs.readFileSync(bakPath, "utf8")).toBe(ORIGINAL_LIVE);
	});
});

// ---------------------------------------------------------------------------
// configureMimeapps — alias for syncMimeappsConfig
// ---------------------------------------------------------------------------

describe("configureMimeapps — alias for syncMimeappsConfig", () => {
	it("deploys mimeapps.list (same as syncMimeappsConfig)", async () => {
		seedRepoMimeapps();
		await mimeapps.configureMimeapps({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		expect(fs.existsSync(path.join(tmpHome, ".config", "mimeapps.list"))).toBe(
			true,
		);
		expect(
			fs.readFileSync(path.join(tmpHome, ".config", "mimeapps.list"), "utf8"),
		).toBe(FIXTURE_CONTENT);
	});
});

// ---------------------------------------------------------------------------
// Seeded configs/mimeapps/ (in-tree static file — real path, no injection)
// ---------------------------------------------------------------------------

describe("seeded configs/mimeapps/ (in-tree static config)", () => {
	it("ships mimeapps.list under configs/mimeapps/", () => {
		expect(
			fs.existsSync(path.join(CONFIGS_MIMEAPPS_DIR, "mimeapps.list")),
		).toBe(true);
	});

	it("seeded mimeapps.list is non-empty", () => {
		const content = fs.readFileSync(
			path.join(CONFIGS_MIMEAPPS_DIR, "mimeapps.list"),
			"utf8",
		);
		expect(content.length).toBeGreaterThan(0);
	});

	it("ships the Claude URL handler referenced by mimeapps.list", () => {
		const content = fs.readFileSync(
			path.join(CONFIGS_MIMEAPPS_DIR, "mimeapps.list"),
			"utf8",
		);
		expect(content).toContain(
			"x-scheme-handler/claude-cli=claude-code-url-handler.desktop",
		);
		expect(
			fs.existsSync(
				path.join(
					CONFIGS_MIMEAPPS_DIR,
					"applications",
					"claude-code-url-handler.desktop",
				),
			),
		).toBe(true);
	});

	it("does not ship deprecated streaming desktop entries", () => {
		for (const desktop of [
			"zee5-hd.desktop",
			"crunchyroll-hd.desktop",
			"jiohotstar-hd.desktop",
			"primevideo-hd.desktop",
		]) {
			expect(
				fs.existsSync(path.join(CONFIGS_MIMEAPPS_DIR, "applications", desktop)),
			).toBe(false);
		}
	});

	it("ships a WhatsApp desktop entry with an isolated Chromium profile", () => {
		const desktop = fs.readFileSync(
			path.join(CONFIGS_MIMEAPPS_DIR, "applications", "whatsapp-web.desktop"),
			"utf8",
		);

		expect(desktop).toContain("Name=WhatsApp Web");
		expect(desktop).toContain(
			`Exec=sh -lc 'exec chromium --user-data-dir="$HOME/.config/chromium-haoshoku/whatsapp" --class=chromium-whatsapp --app=https://web.whatsapp.com/'`,
		);
		expect(desktop).toContain("Type=Application");
		expect(desktop).toContain("StartupWMClass=chromium-whatsapp");
	});

	it("restores the working WhatsApp Exec on every later mimeapps sync", async () => {
		const liveApplications = path.join(
			tmpHome,
			".local",
			"share",
			"applications",
		);
		fs.mkdirSync(liveApplications, { recursive: true });
		fs.writeFileSync(
			path.join(liveApplications, "whatsapp-web.desktop"),
			"[Desktop Entry]\nExec=caelestia toggle communication\n",
		);

		await mimeapps.syncMimeappsConfig({
			home: tmpHome,
			projectRoot: PROJECT_ROOT,
		});

		const deployed = fs.readFileSync(
			path.join(liveApplications, "whatsapp-web.desktop"),
			"utf8",
		);
		expect(deployed).toContain(
			`Exec=sh -lc 'exec chromium --user-data-dir="$HOME/.config/chromium-haoshoku/whatsapp" --class=chromium-whatsapp --app=https://web.whatsapp.com/'`,
		);
		expect(deployed).not.toContain("Exec=caelestia toggle communication");
	});

	it("sets Omarchy's Files app as the XDG default for directories", () => {
		const content = fs.readFileSync(
			path.join(CONFIGS_MIMEAPPS_DIR, "mimeapps.list"),
			"utf8",
		);

		expect(content).toContain("inode/directory=org.gnome.Nautilus.desktop");
	});

	it("routes notion:// links to the isolated Chromium Notion app", () => {
		const content = fs.readFileSync(
			path.join(CONFIGS_MIMEAPPS_DIR, "mimeapps.list"),
			"utf8",
		);
		const desktop = fs.readFileSync(
			path.join(
				CONFIGS_MIMEAPPS_DIR,
				"applications",
				"notion-chromium.desktop",
			),
			"utf8",
		);

		expect(content).toContain(
			"x-scheme-handler/notion=notion-chromium.desktop",
		);
		expect(content).not.toContain("x-scheme-handler/notion=cohesion.desktop");
		expect(desktop).toContain("Name=Genesis Block | Notion");
		expect(desktop).toContain(
			`Exec=sh -lc 'exec chromium --user-data-dir="$HOME/.config/chromium-haoshoku/notion" --class=chromium-notion --app=https://www.notion.so/'`,
		);
		expect(desktop).toContain("StartupWMClass=chromium-notion");
	});

	it("covers every managed desktop entry with either a deployed handler or installed package", () => {
		const mimeapps = fs.readFileSync(
			path.join(CONFIGS_MIMEAPPS_DIR, "mimeapps.list"),
			"utf8",
		);
		const packageLists = [
			fs.readFileSync(
				path.join(PROJECT_ROOT, "common", "paru_applist.txt"),
				"utf8",
			),
			fs.readFileSync(
				path.join(PROJECT_ROOT, "common", "flatpacks_arch.txt"),
				"utf8",
			),
		].join("\n");
		const deployedHandlersDir = path.join(CONFIGS_MIMEAPPS_DIR, "applications");
		const deployedHandlers = fs.existsSync(deployedHandlersDir)
			? new Set(fs.readdirSync(deployedHandlersDir))
			: new Set();
		const referenced = [
			...new Set(
				[...mimeapps.matchAll(/=([^\n;]+\.desktop)/g)].map((match) => match[1]),
			),
		];

		const providerAliases = {
			"chromium.desktop": "chromium",
			"com.anthropic.Claude.desktop": "claude-desktop",
			"org.gnome.Nautilus.desktop": "nautilus",
		};
		const installed = new Set(
			packageLists.split("\n").map((line) => line.trim()),
		);
		const uncovered = referenced.filter((desktopFile) => {
			if (deployedHandlers.has(desktopFile)) return false;
			const packageName = desktopFile.replace(/\.desktop$/, "");
			if (installed.has(packageName)) return false;
			const alias = providerAliases[desktopFile];
			return !(alias && installed.has(alias));
		});

		expect(uncovered).toEqual([]);
	});
});
