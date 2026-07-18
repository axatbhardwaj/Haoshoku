import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as userScripts from "../src/helpers/install_user_scripts.js";

let tmpHome;
let tmpProjectRoot;

function scriptsSrcDir(tmpProjectRoot) {
	return path.join(tmpProjectRoot, "configs", "scripts");
}

function seedScript(tmpProjectRoot, name, content = "#!/bin/sh\necho hi\n") {
	const dir = scriptsSrcDir(tmpProjectRoot);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, name), content);
}

beforeEach(() => {
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-scripts-home-"));
	tmpProjectRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "haoshoku-scripts-root-"),
	);
});

afterEach(() => {
	fs.rmSync(tmpHome, { recursive: true, force: true });
	fs.rmSync(tmpProjectRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Module shape
// ---------------------------------------------------------------------------

describe("install_user_scripts module shape", () => {
	it("exports installUserScripts as a function", () => {
		expect(typeof userScripts.installUserScripts).toBe("function");
	});
});

// ---------------------------------------------------------------------------
// installUserScripts — basic deployment
// ---------------------------------------------------------------------------

describe("installUserScripts — deployment", () => {
	it("copies scripts to ~/.local/bin/", async () => {
		seedScript(tmpProjectRoot, "my-tool");

		await userScripts.installUserScripts({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const dest = path.join(tmpHome, ".local", "bin", "my-tool");
		expect(fs.existsSync(dest)).toBe(true);
		expect(fs.readFileSync(dest, "utf8")).toContain("echo hi");
	});

	it("sets chmod 755 on deployed scripts", async () => {
		seedScript(tmpProjectRoot, "my-tool");

		await userScripts.installUserScripts({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const dest = path.join(tmpHome, ".local", "bin", "my-tool");
		const mode = fs.statSync(dest).mode;
		// Check owner, group, other exec bits
		expect(mode & 0o111).toBe(0o111);
	});

	it("creates ~/.local/bin/ if it does not exist", async () => {
		seedScript(tmpProjectRoot, "my-tool");

		expect(fs.existsSync(path.join(tmpHome, ".local", "bin"))).toBe(false);

		await userScripts.installUserScripts({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		expect(fs.existsSync(path.join(tmpHome, ".local", "bin"))).toBe(true);
	});

	it("skips hidden files (dot-files like .gitkeep)", async () => {
		seedScript(tmpProjectRoot, "real-tool");
		const dir = scriptsSrcDir(tmpProjectRoot);
		fs.writeFileSync(path.join(dir, ".gitkeep"), "");

		await userScripts.installUserScripts({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const localBin = path.join(tmpHome, ".local", "bin");
		expect(fs.existsSync(path.join(localBin, ".gitkeep"))).toBe(false);
		expect(fs.existsSync(path.join(localBin, "real-tool"))).toBe(true);
	});

	it("skips Markdown guidance files", async () => {
		seedScript(tmpProjectRoot, "real-tool");
		const dir = scriptsSrcDir(tmpProjectRoot);
		const localBin = path.join(tmpHome, ".local", "bin");
		fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# guidance\n");
		fs.mkdirSync(localBin, { recursive: true });
		fs.writeFileSync(path.join(localBin, "CLAUDE.md"), "# stale guidance\n");
		fs.writeFileSync(path.join(localBin, "CLAUDE.md.bak"), "# stale backup\n");

		await userScripts.installUserScripts({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		expect(fs.existsSync(path.join(localBin, "CLAUDE.md"))).toBe(false);
		expect(fs.existsSync(path.join(localBin, "CLAUDE.md.bak"))).toBe(false);
		expect(fs.existsSync(path.join(localBin, "real-tool"))).toBe(true);
	});

	it("is a no-op (no error) when configs/scripts/ does not exist", async () => {
		// No seedScript — source dir absent
		await expect(
			userScripts.installUserScripts({
				home: tmpHome,
				projectRoot: tmpProjectRoot,
			}),
		).resolves.toBeUndefined();

		expect(
			fs.existsSync(path.join(tmpHome, ".local", "bin")),
		).toBe(false);
	});

	it("removes retired streaming scripts from ~/.local/bin/", async () => {
		seedScript(tmpProjectRoot, "my-tool");
		const localBin = path.join(tmpHome, ".local", "bin");
		fs.mkdirSync(localBin, { recursive: true });
		for (const script of [
			"primevideo-setup",
			"primevideo-hd",
			"zee5-hd",
			"crunchyroll-hd",
			"jiohotstar-hd",
			"ai-webapps-toggle",
		]) {
			fs.writeFileSync(path.join(localBin, script), "# stale\n");
		}

		await userScripts.installUserScripts({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		expect(fs.existsSync(path.join(localBin, "my-tool"))).toBe(true);
		for (const script of [
			"primevideo-setup",
			"primevideo-hd",
			"zee5-hd",
			"crunchyroll-hd",
			"jiohotstar-hd",
			"ai-webapps-toggle",
		]) {
			expect(fs.existsSync(path.join(localBin, script))).toBe(false);
		}
	});

	it("ships game-performance with a reset mode for crash-stale VRR", () => {
		const script = fs.readFileSync(
			path.join(
				process.cwd(),
				"configs",
				"scripts",
				"game-performance",
			),
			"utf8",
		);

		expect(script).toContain(`if [ "$` + `{1:-}" = "--reset" ]; then`);
		expect(script).toContain("set_dp1_vrr 0");
		expect(script).toContain("exit 0");
		expect(script).toContain("/usr/bin/game-performance");
	});

	it("toggles game VRR without reloading all monitor outputs", () => {
		const script = fs.readFileSync(
			path.join(
				process.cwd(),
				"configs",
				"scripts",
				"game-performance",
			),
			"utf8",
		);

		expect(script).toContain(
			'hyprctl keyword monitor "DP-1,2560x1440@143.97,1080x240,1,vrr,$1"',
		);
		expect(script).not.toContain("hyprctl reload");
		expect(script).not.toContain("sed -i");
	});

	it("ships warp-workspace-7 as a plain home Warp launcher", () => {
		const script = fs.readFileSync(
			path.join(process.cwd(), "configs", "scripts", "warp-workspace-7"),
			"utf8",
		);

		expect(script).toContain("WS=7");
		expect(script).toContain(
			String.raw`cd \"\$HOME\" && exec warp-terminal`,
		);
		expect(script).toContain("dev.warp.Warp");
		expect(script).toContain("movetoworkspacesilent");
		expect(script).toContain('hyprctl dispatch workspace "$WS"');
		expect(script).not.toContain("tab_config");
		expect(script).not.toContain("warp://");
		expect(script).not.toContain("agents");
	});

	it("ships mic-toggle for the default audio source with a notification", () => {
		const script = fs.readFileSync(
			path.join(process.cwd(), "configs", "scripts", "mic-toggle"),
			"utf8",
		);

		expect(script).toContain("wpctl set-mute @DEFAULT_AUDIO_SOURCE@ toggle");
		expect(script).toContain("wpctl set-volume @DEFAULT_AUDIO_SOURCE@ 100%");
		expect(script).toContain("pactl set-source-mute @DEFAULT_SOURCE@ toggle");
		expect(script).toContain("pactl set-source-volume @DEFAULT_SOURCE@ 100%");
		expect(script).toContain("notify-send");
		expect(script).toContain("Microphone muted");
		expect(script).toContain("Microphone unmuted");
		expect(script).not.toContain("@DEFAULT_AUDIO_SINK@");
	});

	it("ships caelestia-restart with a bounded recovery ladder and IPC health check", () => {
		const script = fs.readFileSync(
			path.join(process.cwd(), "configs", "scripts", "caelestia-restart"),
			"utf8",
		);

		// Behavioural assertions run against executable text only. The helper
		// documents its own commands in the header, so asserting against the
		// raw file lets a comment satisfy an ordering check and the test then
		// passes no matter what the code does.
		const code = script
			.split("\n")
			.filter((line) => !line.trim().startsWith("#"))
			.join("\n");

		expect(code).toContain("flock -n");

		// Every call that talks to the shell socket must be bounded, or it can
		// hang while holding the lock and silently disable the shortcut.
		expect(code).toMatch(/timeout\s+5\s+caelestia shell -k/);
		expect(code).toContain("timeout 5 qs list --all");
		expect(code).toContain("timeout 3 qs -c caelestia ipc show");

		// The IPC wait is bounded by wall clock, not by an iteration count:
		// each probe can burn its own timeout, which would multiply the bound.
		expect(code).toContain("date +%s");

		// Stop before start.
		expect(code).toContain("caelestia shell -d");
		expect(code.indexOf("caelestia shell -k")).toBeLessThan(
			code.indexOf("caelestia shell -d"),
		);

		// Escalate cooperative -> TERM -> KILL, in that order.
		expect(code).toContain("kill -TERM");
		expect(code).toContain("kill -KILL");
		expect(code.indexOf("kill -TERM")).toBeLessThan(
			code.indexOf("kill -KILL"),
		);

		// Healthy IPC alone is not success: a ladder survivor answers exactly
		// as a fresh shell would, and --no-duplicate would have refused ours.
		expect(code).toMatch(/if wait_for_ipc[\s\S]*any_alive \$pids/);

		// The started shell is a daemon that outlives this script. If it
		// inherits fd 9 it holds the flock for the rest of the session, and
		// every later press takes the silent exit-2 path — the shortcut would
		// work exactly once per login and then die without a word.
		expect(code).toMatch(/caelestia shell -d[^\n]*9>&-/);

		// A negative PID is a process-group selector: `kill -TERM -1` would
		// signal every process this user owns. Validate before kill can see it.
		expect(code).toContain("$3 ~ /^[0-9]+$/");

		// A bare /caelestia/ substring also matches unrelated quickshell
		// configs nested under a directory of that name.
		expect(code).toContain(String.raw`\/caelestia\/shell\.qml`);

		expect(code).toContain("hyprctl notify");
		expect(script).not.toContain("notify-send");
		expect(script).not.toContain("pgrep");
		expect(script).not.toContain("by-pid");
		expect(script).not.toContain("hyprctl reload");
	});

	it("ships claude-desktop-toggle as a Claude-only special workspace", () => {
		const script = fs.readFileSync(
			path.join(process.cwd(), "configs", "scripts", "claude-desktop-toggle"),
			"utf8",
		);
		// Directives only: the file documents the ChatGPT stack it used to be,
		// so matching raw text would trip on the comment's own history.
		const code = script
			.split("\n")
			.filter((line) => !line.trim().startsWith("#"))
			.join("\n");

		expect(code).toContain("MONITOR=DP-2");
		expect(code).toContain("WS=special:claude-desktop");
		expect(code).toContain("WS_NAME=claude-desktop");
		// Claude is the native app, launched directly (no --app-id).
		expect(code).toContain("CLAUDE_CLASS=com.anthropic.Claude");
		expect(code).toContain("app2unit -- claude-desktop");

		// Super+I is Claude alone — no PWA class, no Brave, no app-id.
		expect(code).not.toContain("cadlkienfkclaiaibeoongdcgmdikeeg");
		expect(code).not.toContain("CHATGPT");
		expect(code).not.toContain("--app-id");
		expect(code).not.toContain("brave");

		// One window tiles into the work area on its own, honouring both the
		// reserved bar strip and DP-2's portrait transform, so the hand-rolled
		// two-window geometry is gone with the second window.
		expect(code).not.toContain("place_stack");
		expect(code).not.toContain("movewindowpixel");
		expect(code).not.toContain("resizewindowpixel");
		expect(code).not.toContain("reserved_left");
		// Reclaim a window the old stacking version left floating at half height.
		expect(code).toContain("settiled");
	});

	it("does not ship deprecated streaming launcher scripts", () => {
		for (const script of [
			"primevideo-setup",
			"primevideo-hd",
			"zee5-hd",
			"crunchyroll-hd",
			"jiohotstar-hd",
		]) {
			expect(
				fs.existsSync(path.join(process.cwd(), "configs", "scripts", script)),
			).toBe(false);
		}
	});

	it("ships whatsapp-web as a native Brave app launcher in a dedicated profile", () => {
		const script = fs.readFileSync(
			path.join(process.cwd(), "configs", "scripts", "whatsapp-web"),
			"utf8",
		);

		expect(script).toContain("https://web.whatsapp.com");
		expect(script).toContain("--app=");
		expect(script).toContain(".local/share/whatsapp-brave-profile");
		expect(script).not.toContain("bottles-cli");
		expect(script).not.toContain("brave.exe");
		expect(script).not.toContain("remote-debugging-port");
	});
});

// ---------------------------------------------------------------------------
// installUserScripts — .bak backup behavior via safeCopyFile
// ---------------------------------------------------------------------------

describe("installUserScripts — .bak behavior for pre-existing different files", () => {
	it("creates a .bak of a pre-existing file with different content", async () => {
		seedScript(tmpProjectRoot, "my-tool", "#!/bin/sh\necho new\n");

		// Pre-seed a different version at the destination
		const localBin = path.join(tmpHome, ".local", "bin");
		fs.mkdirSync(localBin, { recursive: true });
		const destFile = path.join(localBin, "my-tool");
		const ORIGINAL = "#!/bin/sh\necho old\n";
		fs.writeFileSync(destFile, ORIGINAL);

		await userScripts.installUserScripts({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const bakPath = `${destFile}.bak`;
		expect(fs.existsSync(bakPath)).toBe(true);
		expect(fs.readFileSync(bakPath, "utf8")).toBe(ORIGINAL);
		// New content deployed
		expect(fs.readFileSync(destFile, "utf8")).toContain("echo new");
	});

	it("does not create a .bak and does not change the file when content is unchanged (second run)", async () => {
		seedScript(tmpProjectRoot, "my-tool", "#!/bin/sh\necho hi\n");

		await userScripts.installUserScripts({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		// First run may have created a .bak (it won't — no pre-existing file), ensure none exists
		const destFile = path.join(tmpHome, ".local", "bin", "my-tool");
		const bakPath = `${destFile}.bak`;
		expect(fs.existsSync(bakPath)).toBe(false);

		// Record mtime before second run
		const mtimeBefore = fs.statSync(destFile).mtimeMs;

		// Small delay to ensure mtime would differ if re-written
		await new Promise((r) => setTimeout(r, 20));

		// Second run — identical content; safeCopyFile should no-op
		await userScripts.installUserScripts({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const mtimeAfter = fs.statSync(destFile).mtimeMs;
		// File not re-written (mtime unchanged)
		expect(mtimeAfter).toBe(mtimeBefore);
		// Still no .bak
		expect(fs.existsSync(bakPath)).toBe(false);
	});

	it("preserves original .bak across two syncs (second run is no-op when content same as repo)", async () => {
		const NEW_CONTENT = "#!/bin/sh\necho new\n";
		seedScript(tmpProjectRoot, "my-tool", NEW_CONTENT);

		const localBin = path.join(tmpHome, ".local", "bin");
		fs.mkdirSync(localBin, { recursive: true });
		const destFile = path.join(localBin, "my-tool");
		const ORIGINAL = "#!/bin/sh\necho old\n";
		fs.writeFileSync(destFile, ORIGINAL);

		// First sync: backs up ORIGINAL → .bak, writes NEW_CONTENT
		await userScripts.installUserScripts({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		// Second sync: live already matches repo → no-op; .bak still holds ORIGINAL
		await userScripts.installUserScripts({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		const bakPath = `${destFile}.bak`;
		expect(fs.existsSync(bakPath)).toBe(true);
		// .bak must NOT be overwritten with current content
		expect(fs.readFileSync(bakPath, "utf8")).toBe(ORIGINAL);
	});
});
