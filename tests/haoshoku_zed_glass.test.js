import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const SCRIPT_PATH = path.join(
	PROJECT_ROOT,
	"configs",
	"scripts",
	"haoshoku-zed-glass",
);

let tmpHome;

beforeEach(() => {
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-zed-glass-"));
});

afterEach(() => {
	fs.rmSync(tmpHome, { recursive: true, force: true });
});

function themePath() {
	return path.join(tmpHome, ".config", "zed", "themes", "omazed.json");
}

function writeTheme(content) {
	const file = themePath();
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
	return file;
}

function runScript(env = {}) {
	return Bun.spawnSync({
		cmd: ["/bin/bash", SCRIPT_PATH],
		env: { ...process.env, HOME: tmpHome, ...env },
	});
}

function spawnScript(env = {}) {
	return Bun.spawn({
		cmd: ["/bin/bash", SCRIPT_PATH],
		env: { ...process.env, HOME: tmpHome, ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
}

function installBlockingJq(name) {
	const binDir = path.join(tmpHome, `bin-${name}`);
	const started = path.join(tmpHome, `${name}-started`);
	const release = path.join(tmpHome, `${name}-release`);
	const jq = path.join(binDir, "jq");
	fs.mkdirSync(binDir, { recursive: true });
	fs.writeFileSync(
		jq,
		'#!/usr/bin/env bash\nset -euo pipefail\ntouch "$JQ_STARTED"\nwhile [[ ! -f "$JQ_RELEASE" ]]; do sleep 0.01; done\nexec /usr/bin/jq "$@"\n',
	);
	fs.chmodSync(jq, 0o755);
	return {
		env: {
			JQ_RELEASE: release,
			JQ_STARTED: started,
			PATH: `${binDir}:${process.env.PATH}`,
		},
		release,
		started,
	};
}

function temporaryThemeFiles() {
	return fs
		.readdirSync(path.dirname(themePath()))
		.filter((candidate) => candidate.startsWith(".omazed.json."));
}

async function waitForFile(file) {
	const deadline = Date.now() + 3000;
	while (!fs.existsSync(file)) {
		if (Date.now() > deadline) {
			throw new Error(`Timed out waiting for ${path.basename(file)}`);
		}
		await Bun.sleep(10);
	}
}

function stdout(result) {
	return new TextDecoder().decode(result.stdout);
}

function stderr(result) {
	return new TextDecoder().decode(result.stderr);
}

function realisticTheme() {
	const style = {
		background: "#010203",
		"surface.background": "#111213",
		"toolbar.background": "#212223",
		"editor.background": "#313233",
		"editor.gutter.background": "#414243",
		"status_bar.background": "#515253",
		"title_bar.background": "#616263",
		"tab_bar.background": "#717273",
		"panel.background": "#818283",
		"elevated_surface.background": "#919293",
		"tab.active_background": "#A1A2A3",
		"popover.background": "#B1B2B3",
		"editor.active_line.background": "#C1C2C3",
		"scrollbar.thumb.background": "#D1D2D3",
		border: "#E1E2E3",
		"border.variant": "#F1F2F3",
		"border.focused": "#010101",
		"border.selected": "#020202",
		"panel.focused_border": "#030303",
		"pane.focused_border": "#040404",
	};
	return JSON.stringify(
		{
			$schema: "https://zed.dev/schema/themes/v0.2.0.json",
			name: "Omazed",
			themes: [
				{
					name: "Omazed",
					appearance: "dark",
					style,
				},
				{
					name: "Omazed Light",
					appearance: "light",
					style: {
						...style,
						"background.appearance": "opaque",
						background: "#A0A1A2",
						"editor.background": "#B0B1B2",
						"scrollbar.thumb.background": "#C0C1C2",
						border: "#D0D1D2",
						"border.variant": "#E0E1E2",
					},
				},
			],
		},
		null,
		2,
	);
}

describe("haoshoku-zed-glass", () => {
	it("makes every theme transparent while preserving opaque and accent surfaces", () => {
		writeTheme(realisticTheme());

		const result = runScript();

		expect(result.exitCode).toBe(0);
		const [style, secondStyle] = JSON.parse(
			fs.readFileSync(themePath(), "utf8"),
		).themes.map((theme) => theme.style);
		expect(style["background.appearance"]).toBe("transparent");
		expect(secondStyle["background.appearance"]).toBe("transparent");
		for (const key of [
			"background",
			"surface.background",
			"toolbar.background",
			"editor.background",
			"editor.gutter.background",
		]) {
			expect(style[key]).toMatch(/^#[0-9A-Fa-f]{6}E6$/);
		}
		for (const key of [
			"status_bar.background",
			"title_bar.background",
			"tab_bar.background",
			"panel.background",
		]) {
			expect(style[key]).toMatch(/^#[0-9A-Fa-f]{6}D9$/);
		}
		expect(style["editor.background"]).toBe("#313233E6");
		expect(style["elevated_surface.background"]).toBe("#919293");
		expect(style["tab.active_background"]).toBe("#A1A2A3");
		expect(style["popover.background"]).toBe("#B1B2B3");
		expect(style["editor.active_line.background"]).toBe("#C1C2C3");
		expect(style.border).toBe("#D1D2D3");
		expect(style.border).not.toBe("#E1E2E3");
		expect(style.border).not.toBe(style.background);
		expect(style["border.variant"]).toBe("#D1D2D3");
		expect(style["border.focused"]).toBe("#010101");
		expect(style["border.selected"]).toBe("#020202");
		expect(style["panel.focused_border"]).toBe("#030303");
		expect(style["pane.focused_border"]).toBe("#040404");
		expect(secondStyle.background).toBe("#A0A1A2E6");
		expect(secondStyle.border).toBe("#C0C1C2");
		expect(secondStyle["border.variant"]).toBe("#C0C1C2");
	});

	it("is byte-identical after a second run", () => {
		writeTheme(realisticTheme());

		expect(runScript().exitCode).toBe(0);
		const afterFirstRun = fs.readFileSync(themePath());
		expect(runScript().exitCode).toBe(0);
		expect(fs.readFileSync(themePath())).toEqual(afterFirstRun);
	});

	it("silently succeeds without creating a missing theme", () => {
		const result = runScript();

		expect(result.exitCode).toBe(0);
		expect(stdout(result)).toBe("");
		expect(stderr(result)).toBe("");
		expect(fs.existsSync(path.join(tmpHome, ".config"))).toBe(false);
	});

	it("keeps malformed input byte-identical and removes failed temp output", () => {
		const original = '{\n  "themes": [\n';
		writeTheme(original);

		const result = runScript();

		expect(result.exitCode).toBe(0);
		expect(stderr(result)).toContain("warning");
		expect(fs.readFileSync(themePath(), "utf8")).toBe(original);
		expect(fs.readdirSync(path.dirname(themePath()))).toEqual(["omazed.json"]);
	});

	it("keeps schema-invalid theme entries byte-identical and removes failed temp output", () => {
		const original = '{"themes":[{}]}';
		writeTheme(original);

		const result = runScript();

		expect(result.exitCode).toBe(0);
		expect(fs.readFileSync(themePath(), "utf8")).toBe(original);
		expect(stderr(result)).toContain("warning");
		expect(fs.readdirSync(path.dirname(themePath()))).toEqual(["omazed.json"]);
	});

	it("does not delete a concurrent instance's temporary file", async () => {
		writeTheme(realisticTheme());
		const blockingJq = installBlockingJq("concurrent");
		const first = spawnScript(blockingJq.env);

		try {
			await waitForFile(blockingJq.started);
			expect(temporaryThemeFiles()).toHaveLength(1);
			expect(runScript().exitCode).toBe(0);
			fs.writeFileSync(blockingJq.release, "release\n");

			expect(await first.exited).toBe(0);
			expect(temporaryThemeFiles()).toEqual([]);
		} finally {
			fs.writeFileSync(blockingJq.release, "release\n");
			first.kill();
		}
	}, 10000);

	it("cleans its temporary file when terminated by SIGTERM", async () => {
		writeTheme(realisticTheme());
		const blockingJq = installBlockingJq("signal");
		const process = spawnScript(blockingJq.env);

		try {
			await waitForFile(blockingJq.started);
			expect(temporaryThemeFiles()).toHaveLength(1);
			process.kill("SIGTERM");
			fs.writeFileSync(blockingJq.release, "release\n");
			await process.exited;

			expect(temporaryThemeFiles()).toEqual([]);
		} finally {
			fs.writeFileSync(blockingJq.release, "release\n");
			process.kill();
		}
	}, 10000);

	it("warns and leaves the theme untouched when jq is unavailable", () => {
		const original = realisticTheme();
		writeTheme(original);

		const result = runScript({ PATH: "" });

		expect(result.exitCode).toBe(0);
		expect(stderr(result)).toContain("jq");
		expect(fs.readFileSync(themePath(), "utf8")).toBe(original);
	});

	it("preserves existing neutral borders when the scrollbar thumb is absent", () => {
		writeTheme(
			JSON.stringify({
				themes: [
					{
						style: {
							background: "#111111",
							border: "#222222",
							"border.variant": "#333333",
						},
					},
				],
			}),
		);

		const result = runScript();

		expect(result.exitCode).toBe(0);
		const style = JSON.parse(fs.readFileSync(themePath(), "utf8")).themes[0]
			.style;
		expect(style["background.appearance"]).toBe("transparent");
		expect(style.background).toBe("#111111E6");
		expect(style.border).toBe("#222222");
		expect(style["border.variant"]).toBe("#333333");
	});
});
