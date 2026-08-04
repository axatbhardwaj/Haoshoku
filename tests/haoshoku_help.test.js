import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CLI = path.resolve(import.meta.dir, "..", "haoshoku.js");

function cliResult(args, env = process.env) {
	return Bun.spawnSync([process.execPath, CLI, ...args], {
		env,
		stderr: "pipe",
		stdout: "pipe",
	});
}

function output(result) {
	return [result.stdout, result.stderr]
		.map((stream) => new TextDecoder().decode(stream))
		.join("\n");
}

function installFakeKdeCommands(home) {
	const bin = path.join(home, "bin");
	fs.mkdirSync(bin, { recursive: true });
	fs.writeFileSync(
		path.join(bin, "qdbus6"),
		`#!/usr/bin/env bash
set -euo pipefail
state="$HOME/.fake-kde-activities"
ids="$state/ids"
mkdir -p "$state"
if [ ! -f "$ids" ]; then
  printf '%s\\n' \\
    11111111-1111-4111-8111-111111111111 \\
    22222222-2222-4222-8222-222222222222 \\
    33333333-3333-4333-8333-333333333333 > "$ids"
fi
method="\${3:-}"
case "$method" in
  *.ListActivities)
    if [ "\${HAOSHOKU_TEST_FAIL_ACTIVITY_LIST:-}" = 1 ]; then exit 1; fi
    cat "$ids" ;;
  *.ActivityName)
    case "\${4:-}" in
      11111111-1111-4111-8111-111111111111) echo flux ;;
      22222222-2222-4222-8222-222222222222) echo defi ;;
      33333333-3333-4333-8333-333333333333) echo palmUSD ;;
      *) exit 1 ;;
    esac ;;
  *.AddActivity)
    case "\${4:-}" in
      flux) id=11111111-1111-4111-8111-111111111111 ;;
      defi) id=22222222-2222-4222-8222-222222222222 ;;
      palmUSD) id=33333333-3333-4333-8333-333333333333 ;;
      *) exit 1 ;;
    esac
    grep -qxF "$id" "$ids" || echo "$id" >> "$ids"
    echo "$id" ;;
esac
`,
		{ mode: 0o755 },
	);
	fs.writeFileSync(path.join(bin, "kbuildsycoca6"), "#!/bin/sh\nexit 0\n", {
		mode: 0o755,
	});
	return bin;
}

describe("haoshoku CLI help", () => {
	function helpTextFor(flag) {
		const source = fs.readFileSync(
			path.resolve(import.meta.dir, "..", "haoshoku.js"),
			"utf-8",
		);
		const helpText = source.match(
			new RegExp(`\\.option\\(\\s*"${flag}",\\s*"([^"]+)"`, "s"),
		)?.[1];

		expect(helpText).toBeDefined();
		return helpText;
	}

	it("--claude advertises only its three deployed files", () => {
		expect(helpTextFor("--claude")).toBe(
			"Deploy Claude Code config (CLAUDE.md, statusline, .gitignore)",
		);
	});

	it("--claude-backup advertises a personal-files-only backup", () => {
		expect(helpTextFor("--claude-backup")).toBe(
			"Backup Claude Code personal files to configs/claude/",
		);
	});

	it("--plasma advertises the KDE migration", () => {
		expect(helpTextFor("--plasma")).toBe(
			"Migrate portable Haoshoku desktop settings and shortcuts to KDE Plasma",
		);
	});

	it("--activities advertises opt-in KDE activity placement", () => {
		expect(helpTextFor("--activities")).toBe(
			"Provision KDE Activities and activity-scoped window placement",
		);
	});

	it("rejects --activities with --plasma as mutually exclusive", () => {
		const result = cliResult(["--activities", "--plasma"]);

		expect(result.exitCode).toBe(2);
		expect(output(result)).toContain("mutually exclusive");
	});

	it("a successful --activities run persists opt-in and refreshes launchers", () => {
		const home = fs.mkdtempSync(
			path.join(os.tmpdir(), "haoshoku-cli-activities-"),
		);
		try {
			const bin = installFakeKdeCommands(home);
			const applications = path.join(home, ".local", "share", "applications");
			fs.mkdirSync(applications, { recursive: true });
			fs.writeFileSync(
				path.join(applications, "haoshoku-brave-work.desktop"),
				"retired launcher",
			);

			const result = cliResult(["--activities"], {
				...process.env,
				HOME: home,
				PATH: `${bin}:${process.env.PATH}`,
			});

			expect(result.exitCode).toBe(0);
			expect(
				JSON.parse(fs.readFileSync(path.join(home, ".haoshoku.json"), "utf8")),
			).toMatchObject({
				kdeActivities: true,
			});
			expect(
				fs.readFileSync(
					path.join(applications, "haoshoku-brave-flux.desktop"),
					"utf8",
				),
			).toContain("--class=brave-flux");
			expect(
				fs.readFileSync(
					path.join(applications, "haoshoku-brave-defi.desktop"),
					"utf8",
				),
			).toContain("--class=brave-defi");
			expect(
				fs.existsSync(path.join(applications, "haoshoku-brave-work.desktop")),
			).toBe(false);
		} finally {
			fs.rmSync(home, { recursive: true, force: true });
		}
	});

	it("round trips from activity launchers back to the original recipes", () => {
		const home = fs.mkdtempSync(
			path.join(os.tmpdir(), "haoshoku-cli-activities-round-trip-"),
		);
		try {
			const bin = installFakeKdeCommands(home);
			const env = {
				...process.env,
				HOME: home,
				PATH: `${bin}:${process.env.PATH}`,
			};
			const applications = path.join(home, ".local", "share", "applications");

			const enabled = cliResult(["--activities"], env);
			expect(enabled.exitCode).toBe(0);
			expect(
				fs.existsSync(path.join(applications, "haoshoku-brave-defi.desktop")),
			).toBe(true);
			expect(
				fs.existsSync(path.join(applications, "haoshoku-brave-work.desktop")),
			).toBe(false);

			const disabled = cliResult(["--activities-off"], env);
			expect(disabled.exitCode).toBe(0);
			expect(
				JSON.parse(fs.readFileSync(path.join(home, ".haoshoku.json"), "utf8")),
			).toMatchObject({ kdeActivities: false });
			expect(
				fs.readFileSync(
					path.join(applications, "haoshoku-brave-flux.desktop"),
					"utf8",
				),
			).toContain("Exec=brave --profile-directory=Default");
			expect(
				fs.readFileSync(
					path.join(applications, "haoshoku-brave-work.desktop"),
					"utf8",
				),
			).toContain('Exec=brave --profile-directory="Profile 1"');
			expect(
				fs.existsSync(path.join(applications, "haoshoku-brave-defi.desktop")),
			).toBe(false);
		} finally {
			fs.rmSync(home, { recursive: true, force: true });
		}
	});

	it("an early --activities failure restores non-opted-in launcher state", () => {
		const home = fs.mkdtempSync(
			path.join(os.tmpdir(), "haoshoku-cli-activities-failure-"),
		);
		try {
			const bin = installFakeKdeCommands(home);
			const applications = path.join(home, ".local", "share", "applications");
			const result = cliResult(["--activities"], {
				...process.env,
				HOME: home,
				PATH: `${bin}:${process.env.PATH}`,
				HAOSHOKU_TEST_FAIL_ACTIVITY_LIST: "1",
			});
			const state = JSON.parse(
				fs.readFileSync(path.join(home, ".haoshoku.json"), "utf8"),
			);
			const fluxLauncher = fs.readFileSync(
				path.join(applications, "haoshoku-brave-flux.desktop"),
				"utf8",
			);

			expect({
				exitCode: result.exitCode,
				kdeActivities: state.kdeActivities,
				fluxUsesOriginalProfile: fluxLauncher.includes(
					"Exec=brave --profile-directory=Default",
				),
				workLauncherExists: fs.existsSync(
					path.join(applications, "haoshoku-brave-work.desktop"),
				),
				defiLauncherExists: fs.existsSync(
					path.join(applications, "haoshoku-brave-defi.desktop"),
				),
			}).toEqual({
				exitCode: 1,
				kdeActivities: false,
				fluxUsesOriginalProfile: true,
				workLauncherExists: true,
				defiLauncherExists: false,
			});
		} finally {
			fs.rmSync(home, { recursive: true, force: true });
		}
	});
});
