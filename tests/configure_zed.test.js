import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	backupZedConfig,
	syncZedConfig,
	syncZedTheme,
} from "../src/helpers/configure_zed.js";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const ZED_CONFIG_DIR = path.join(PROJECT_ROOT, "configs", "zed");

describe("Zed Caelestia theme defaults", () => {
	it("selects Caelestia for both Zed theme modes", () => {
		const settingsPath = path.join(ZED_CONFIG_DIR, "settings.json");
		const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));

		expect(settings.theme).toEqual({
			mode: "system",
			light: "Caelestia",
			dark: "Caelestia",
		});
	});

	it("vendors a parseable Caelestia Zed theme", () => {
		const themePath = path.join(ZED_CONFIG_DIR, "themes", "caelestia.json");
		const theme = JSON.parse(fs.readFileSync(themePath, "utf8"));

		expect(theme.name).toBe("Caelestia");
		expect(theme.themes[0].name).toBe("Caelestia");
		expect(theme.themes[0].appearance).toBe("dark");
		// Theme colors are personal and drift via --zed-backup; assert shape, not exact hex.
		const style = theme.themes[0].style;
		expect(style["editor.background"]).toMatch(/^#[0-9a-fA-F]{6,8}$/);
		expect(style["border.focused"]).toMatch(/^#[0-9a-fA-F]{6,8}$/);
	});
});

// ---------------------------------------------------------------------------
// Behavioral tests — injectable tmp dirs (never touch real $HOME / repo)
// ---------------------------------------------------------------------------

let tmpZedConfigDir;
let tmpBackupDir;

beforeEach(() => {
	tmpZedConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-zed-live-"));
	tmpBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-zed-backup-"));
});

afterEach(() => {
	fs.rmSync(tmpZedConfigDir, { recursive: true, force: true });
	fs.rmSync(tmpBackupDir, { recursive: true, force: true });
});

/** Seed a live settings.json with the given object/string. */
function seedLiveSettings(content) {
	const body = typeof content === "string" ? content : JSON.stringify(content, null, 2);
	fs.writeFileSync(path.join(tmpZedConfigDir, "settings.json"), body);
}

/** Read the backed-up sanitized settings.json as a parsed object. */
function readBackupSettings() {
	const raw = fs.readFileSync(path.join(tmpBackupDir, "settings.json"), "utf8");
	return JSON.parse(raw);
}

describe("backupZedConfig — deep sanitization", () => {
	it("strips top-level ssh_connections", async () => {
		seedLiveSettings({
			theme: "Caelestia",
			ssh_connections: [{ host: "box", username: "me" }],
		});

		await backupZedConfig({
			zedConfigDir: tmpZedConfigDir,
			backupDir: tmpBackupDir,
		});

		const out = readBackupSettings();
		expect(out.ssh_connections).toBeUndefined();
		expect(out.theme).toBe("Caelestia");
	});

	it("strips a nested token at any depth", async () => {
		seedLiveSettings({
			language_models: {
				openai_compatible: {
					NVIDIA: {
						api_url: "https://example.com/v1",
						api_key: "sk-secret-should-be-gone",
					},
				},
			},
		});

		await backupZedConfig({
			zedConfigDir: tmpZedConfigDir,
			backupDir: tmpBackupDir,
		});

		const out = readBackupSettings();
		const nvidia = out.language_models.openai_compatible.NVIDIA;
		expect(nvidia.api_key).toBeUndefined();
		// Sibling non-sensitive key survives.
		expect(nvidia.api_url).toBe("https://example.com/v1");
	});

	it("strips a deeply nested 'token' key inside an array element", async () => {
		seedLiveSettings({
			servers: [
				{ name: "a", token: "leak-me" },
				{ name: "b", config: { bearer: "also-leak" } },
			],
		});

		await backupZedConfig({
			zedConfigDir: tmpZedConfigDir,
			backupDir: tmpBackupDir,
		});

		const out = readBackupSettings();
		expect(out.servers[0].token).toBeUndefined();
		expect(out.servers[0].name).toBe("a");
		expect(out.servers[1].config.bearer).toBeUndefined();
		expect(out.servers[1].name).toBe("b");
	});

	it("strips an 'env' object under context_servers (MCP token block)", async () => {
		seedLiveSettings({
			context_servers: {
				my_mcp: {
					command: "node",
					args: ["server.js"],
					env: { GITHUB_TOKEN: "ghp_secret", FOO: "bar" },
				},
			},
		});

		await backupZedConfig({
			zedConfigDir: tmpZedConfigDir,
			backupDir: tmpBackupDir,
		});

		const out = readBackupSettings();
		const server = out.context_servers.my_mcp;
		expect(server.env).toBeUndefined();
		// Non-sensitive siblings survive.
		expect(server.command).toBe("node");
		expect(server.args).toEqual(["server.js"]);
	});

	it("keeps non-sensitive keys like api_url, keymap, signing", async () => {
		seedLiveSettings({
			api_url: "https://api.example.com",
			keymap: "vim",
			signing: true,
		});

		await backupZedConfig({
			zedConfigDir: tmpZedConfigDir,
			backupDir: tmpBackupDir,
		});

		const out = readBackupSettings();
		expect(out.api_url).toBe("https://api.example.com");
		expect(out.keymap).toBe("vim");
		expect(out.signing).toBe(true);
	});

	it("matches credential/access_key/private_key/passw variants", async () => {
		seedLiveSettings({
			my_credential: "x",
			access_key: "y",
			"private-key": "z",
			password: "p",
			my_secret: "s",
			apikey: "k",
			keep_me: "ok",
		});

		await backupZedConfig({
			zedConfigDir: tmpZedConfigDir,
			backupDir: tmpBackupDir,
		});

		const out = readBackupSettings();
		expect(out.my_credential).toBeUndefined();
		expect(out.access_key).toBeUndefined();
		expect(out["private-key"]).toBeUndefined();
		expect(out.password).toBeUndefined();
		expect(out.my_secret).toBeUndefined();
		expect(out.apikey).toBeUndefined();
		expect(out.keep_me).toBe("ok");
	});

	it("strips headers.Authorization bearer tokens (PR #8 review C1)", async () => {
		seedLiveSettings({
			context_servers: {
				my_api: {
					url: "https://example.com/mcp",
					headers: { Authorization: "Bearer SUPERSECRET123" },
				},
			},
		});

		await backupZedConfig({
			zedConfigDir: tmpZedConfigDir,
			backupDir: tmpBackupDir,
		});

		const out = readBackupSettings();
		const server = out.context_servers.my_api;
		expect(server.headers?.Authorization).toBeUndefined();
		expect(server.url).toBe("https://example.com/mcp");
		// The raw backup file must not contain the token anywhere.
		expect(JSON.stringify(out)).not.toContain("SUPERSECRET123");
	});

	it("strips Proxy-Authorization and an 'authorization' key outside headers", async () => {
		seedLiveSettings({
			headers: { "Proxy-Authorization": "Basic dXNlcjpwYXNz" },
			authorization: "Bearer top-level-leak",
			keep_me: "ok",
		});

		await backupZedConfig({
			zedConfigDir: tmpZedConfigDir,
			backupDir: tmpBackupDir,
		});

		const out = readBackupSettings();
		expect(out.headers?.["Proxy-Authorization"]).toBeUndefined();
		expect(out.authorization).toBeUndefined();
		expect(out.keep_me).toBe("ok");
	});

	it("strips auth-scheme values under headers even with benign key names", async () => {
		seedLiveSettings({
			headers: {
				"X-Custom": "Bearer sneaky-token",
				"X-Other": "Basic dXNlcjpwYXNz",
				Cookie: "session=abc123",
				"Content-Type": "application/json",
				Accept: "application/json",
			},
		});

		await backupZedConfig({
			zedConfigDir: tmpZedConfigDir,
			backupDir: tmpBackupDir,
		});

		const out = readBackupSettings();
		expect(out.headers["X-Custom"]).toBeUndefined();
		expect(out.headers["X-Other"]).toBeUndefined();
		expect(out.headers.Cookie).toBeUndefined();
		// Benign headers survive.
		expect(out.headers["Content-Type"]).toBe("application/json");
		expect(out.headers.Accept).toBe("application/json");
	});
});

describe("backupZedConfig — tolerant JSONC parsing", () => {
	it("parses inline // comments and trailing commas", async () => {
		seedLiveSettings(
			[
				"{",
				'  "theme": "Caelestia", // my favorite',
				'  "autosave": "on_focus_change",',
				"  // a whole-line comment",
				'  "git_panel": { "dock": "right", },',
				"}",
			].join("\n"),
		);

		await backupZedConfig({
			zedConfigDir: tmpZedConfigDir,
			backupDir: tmpBackupDir,
		});

		const out = readBackupSettings();
		expect(out.theme).toBe("Caelestia");
		expect(out.autosave).toBe("on_focus_change");
		expect(out.git_panel.dock).toBe("right");
	});

	it("parses /* block */ comments and does not strip // inside strings", async () => {
		seedLiveSettings(
			[
				"{",
				"  /* block comment */",
				'  "api_url": "https://example.com/v1", // keep this url',
				'  "note": "protocol is https://not-a-comment",',
				"}",
			].join("\n"),
		);

		await backupZedConfig({
			zedConfigDir: tmpZedConfigDir,
			backupDir: tmpBackupDir,
		});

		const out = readBackupSettings();
		expect(out.api_url).toBe("https://example.com/v1");
		expect(out.note).toBe("protocol is https://not-a-comment");
	});

	it("does not corrupt string values that contain ',}' or ',]'", async () => {
		// The trailing-comma strip must be string-literal aware: a value that
		// literally contains ",}" / ",]" is data, not syntax, and must survive
		// the JSONC → JSON normalization untouched.
		seedLiveSettings({
			note: "trailing,}here",
			list_note: "bracket,]case",
			// A real trailing comma in structural position still gets stripped.
			git_panel: { dock: "right" },
		});

		await backupZedConfig({
			zedConfigDir: tmpZedConfigDir,
			backupDir: tmpBackupDir,
		});

		const out = readBackupSettings();
		expect(out.note).toBe("trailing,}here");
		expect(out.list_note).toBe("bracket,]case");
		expect(out.git_panel.dock).toBe("right");
	});

	it("does not crash on malformed JSON; continues backing up the rest", async () => {
		// Unparseable settings.json
		seedLiveSettings("{ this is : not json ]");
		// A valid keymap should still get backed up.
		fs.writeFileSync(
			path.join(tmpZedConfigDir, "keymap.json"),
			'[{"context":"Editor"}]',
		);

		await expect(
			backupZedConfig({
				zedConfigDir: tmpZedConfigDir,
				backupDir: tmpBackupDir,
			}),
		).resolves.toBeUndefined();

		// settings.json was skipped, keymap.json still backed up.
		expect(fs.existsSync(path.join(tmpBackupDir, "settings.json"))).toBe(false);
		expect(fs.existsSync(path.join(tmpBackupDir, "keymap.json"))).toBe(true);
	});
});

describe("syncZedConfig / syncZedTheme — safeCopyFile backups", () => {
	/** Seed the repo backup dir with a settings.json + keymap.json + theme. */
	function seedBackup() {
		fs.writeFileSync(
			path.join(tmpBackupDir, "settings.json"),
			'{\n  "theme": "Caelestia"\n}',
		);
		fs.writeFileSync(
			path.join(tmpBackupDir, "keymap.json"),
			'[{"context":"Editor"}]',
		);
		fs.mkdirSync(path.join(tmpBackupDir, "themes"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpBackupDir, "themes", "caelestia.json"),
			'{"name":"Caelestia"}',
		);
	}

	it("backs up an existing live settings.json to .bak before overwriting", async () => {
		seedBackup();
		// Live file has different content → should be backed up.
		fs.writeFileSync(
			path.join(tmpZedConfigDir, "settings.json"),
			'{\n  "theme": "OldUserTheme"\n}',
		);

		await syncZedConfig({
			zedConfigDir: tmpZedConfigDir,
			backupDir: tmpBackupDir,
		});

		const bak = path.join(tmpZedConfigDir, "settings.json.bak");
		expect(fs.existsSync(bak)).toBe(true);
		expect(fs.readFileSync(bak, "utf8")).toContain("OldUserTheme");
		// Live now matches repo.
		expect(
			fs.readFileSync(path.join(tmpZedConfigDir, "settings.json"), "utf8"),
		).toContain("Caelestia");
	});

	it("second sync run leaves the first .bak intact (identical content skips)", async () => {
		seedBackup();
		fs.writeFileSync(
			path.join(tmpZedConfigDir, "settings.json"),
			'{\n  "theme": "OldUserTheme"\n}',
		);

		await syncZedConfig({
			zedConfigDir: tmpZedConfigDir,
			backupDir: tmpBackupDir,
		});
		const bakAfterFirst = fs.readFileSync(
			path.join(tmpZedConfigDir, "settings.json.bak"),
			"utf8",
		);

		// Second run: live == repo now, so safeCopyFile should skip and not
		// clobber the original .bak.
		await syncZedConfig({
			zedConfigDir: tmpZedConfigDir,
			backupDir: tmpBackupDir,
		});
		const bakAfterSecond = fs.readFileSync(
			path.join(tmpZedConfigDir, "settings.json.bak"),
			"utf8",
		);

		expect(bakAfterSecond).toBe(bakAfterFirst);
		expect(bakAfterSecond).toContain("OldUserTheme");
	});

	it("syncZedTheme backs up an existing live theme before overwriting", async () => {
		fs.mkdirSync(path.join(tmpBackupDir, "themes"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpBackupDir, "themes", "caelestia.json"),
			'{"name":"Caelestia","v":2}',
		);
		fs.mkdirSync(path.join(tmpZedConfigDir, "themes"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpZedConfigDir, "themes", "caelestia.json"),
			'{"name":"Caelestia","v":1}',
		);

		await syncZedTheme({
			zedConfigDir: tmpZedConfigDir,
			backupDir: tmpBackupDir,
		});

		const bak = path.join(tmpZedConfigDir, "themes", "caelestia.json.bak");
		expect(fs.existsSync(bak)).toBe(true);
		expect(fs.readFileSync(bak, "utf8")).toContain('"v":1');
		expect(
			fs.readFileSync(
				path.join(tmpZedConfigDir, "themes", "caelestia.json"),
				"utf8",
			),
		).toContain('"v":2');
	});
});
