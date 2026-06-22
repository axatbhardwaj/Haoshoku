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

	it("ships ai-webapps-toggle for the Claude and ChatGPT Brave PWAs", () => {
		const script = fs.readFileSync(
			path.join(process.cwd(), "configs", "scripts", "ai-webapps-toggle"),
			"utf8",
		);

		expect(script).toContain("MONITOR=DP-2");
		expect(script).toContain("WS=special:ai-webapps");
		expect(script).toContain(
			"CLAUDE_CLASS=brave-fmpnliohjhemenmnlpbfagaolkdacoja-Default",
		);
		expect(script).toContain("CLAUDE_APP_ID=fmpnliohjhemenmnlpbfagaolkdacoja");
		expect(script).toContain(
			"CHATGPT_CLASS=brave-cadlkienfkclaiaibeoongdcgmdikeeg-Default",
		);
		expect(script).toContain("CHATGPT_APP_ID=cadlkienfkclaiaibeoongdcgmdikeeg");
		expect(script).toContain("workspace_visible");
		expect(script).toContain("place_stack");
		expect(script).toContain("reserved_left");
		expect(script).toContain("inner_gap=10");
		expect(script).toContain("movewindowpixel");
		expect(script).toContain("resizewindowpixel");
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
