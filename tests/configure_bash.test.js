import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureBash } from "../src/helpers/configure_bash.js";

describe("configureBash", () => {
	let home;

	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-bash-"));
	});

	afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

	it("preserves Omarchy bashrc content and sources the managed fragment once", () => {
		const bashrc = path.join(home, ".bashrc");
		fs.writeFileSync(bashrc, "source ~/.local/share/omarchy/default/bash/rc\n");

		const first = configureBash({ home });
		const second = configureBash({ home });
		const result = fs.readFileSync(bashrc, "utf8");

		expect(first).toEqual({ changed: true, bashrcChanged: true });
		expect(second).toEqual({ changed: false, bashrcChanged: false });
		expect(result).toStartWith(
			"source ~/.local/share/omarchy/default/bash/rc\n",
		);
		expect(
			result.match(/source "\$HOME\/\.config\/haoshoku\/bashrc"/g),
		).toHaveLength(1);
	});

	it("deploys portable Bash aliases and guarded initializers", () => {
		configureBash({ home });
		const fragment = fs.readFileSync(
			path.join(home, ".config", "haoshoku", "bashrc"),
			"utf8",
		);

		for (const text of [
			"alias ls=",
			"alias dog=",
			"alias antigravity=",
			"alias gd=",
			"alias gpl=",
			"starship init bash",
			"direnv hook bash",
			"zoxide init bash",
			"pyenv init - bash",
			"conda shell.bash hook",
			"secrets.bash",
		]) {
			expect(fragment).toContain(text);
		}
		expect(fragment).not.toMatch(
			/cachyos|caelestia|fish|\babbr\b|\bset -gx\b/i,
		);
	});

	it("migrates stale Antigravity definitions to the agy binary", () => {
		configureBash({ home });
		const bin = path.join(home, "bin");
		fs.mkdirSync(bin, { recursive: true });
		const agy = path.join(bin, "agy");
		fs.writeFileSync(agy, '#!/usr/bin/env bash\necho "$@" >> "$AGY_LOG"\n');
		fs.chmodSync(agy, 0o755);
		const agyLog = path.join(home, "agy.log");
		for (const command of [
			"starship",
			"direnv",
			"zoxide",
			"pyenv",
			"thefuck",
		]) {
			const executable = path.join(bin, command);
			fs.writeFileSync(executable, "#!/bin/sh\nexit 0\n");
			fs.chmodSync(executable, 0o755);
		}
		const conda = path.join(home, "anaconda3", "bin", "conda");
		fs.mkdirSync(path.dirname(conda), { recursive: true });
		fs.writeFileSync(conda, "#!/bin/sh\nexit 0\n");
		fs.chmodSync(conda, 0o755);
		const functionProbe = path.join(home, "antigravity.function");

		const result = spawnSync(
			"bash",
			[
				"--noprofile",
				"--norc",
				"-ic",
				[
					"alias agy='antigravity'",
					'antigravity() { command antigravity --new-window "$@" >/dev/null 2>&1 & }',
					'source "$1"',
					'eval "antigravity from-alias"',
					'eval "agy direct"',
					"type -t agy",
					"type -t antigravity",
					'declare -F antigravity > "$2" || true',
				].join("\n"),
				"bash",
				path.join(home, ".config", "haoshoku", "bashrc"),
				functionProbe,
			],
			{
				encoding: "utf8",
				env: {
					HOME: home,
					PATH: `${home}/bin:/usr/bin:/bin`,
					AGY_LOG: agyLog,
				},
			},
		);

		expect(result.status).toBe(0);
		expect(result.stdout.trim().split("\n").slice(-2)).toEqual([
			"file",
			"alias",
		]);
		expect(fs.readFileSync(functionProbe, "utf8")).toBe("");
		const calls = fs.readFileSync(agyLog, "utf8");
		expect(calls).toContain("from-alias");
		expect(calls).toContain("direct");
	});

	it("configures non-interactive shells without running fastfetch", () => {
		configureBash({ home });
		const bin = path.join(home, "bin");
		fs.mkdirSync(bin, { recursive: true });
		const fastfetch = path.join(bin, "fastfetch");
		fs.writeFileSync(fastfetch, "#!/bin/sh\nprintf 'fastfetch ran\\n'\n");
		fs.chmodSync(fastfetch, 0o755);
		for (const command of [
			"starship",
			"direnv",
			"zoxide",
			"pyenv",
			"thefuck",
		]) {
			const executable = path.join(bin, command);
			fs.writeFileSync(executable, "#!/bin/sh\nexit 0\n");
			fs.chmodSync(executable, 0o755);
		}
		const conda = path.join(home, "anaconda3", "bin", "conda");
		fs.mkdirSync(path.dirname(conda), { recursive: true });
		fs.writeFileSync(conda, "#!/bin/sh\nexit 0\n");
		fs.chmodSync(conda, 0o755);
		for (const directory of [
			path.join(home, ".bun", "bin"),
			path.join(home, ".lmstudio", "bin"),
			path.join(home, "go", "bin"),
			path.join(home, ".cargo", "bin"),
			path.join(home, ".config", ".foundry", "bin"),
			path.join(home, ".claude", "tmp"),
		]) {
			fs.mkdirSync(directory, { recursive: true });
		}
		const secrets = path.join(home, ".config", "haoshoku", "secrets.bash");
		fs.writeFileSync(secrets, "export HAOSHOKU_TEST_SECRET=loaded\n");
		const environmentFile = path.join(home, "environment");

		const result = spawnSync(
			"bash",
			[
				"--noprofile",
				"--norc",
				"-c",
				'source "$1"; env > "$2"',
				"bash",
				path.join(home, ".config", "haoshoku", "bashrc"),
				environmentFile,
			],
			{
				encoding: "utf8",
				env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` },
			},
		);

		expect(result.status).toBe(0);
		expect(result.stdout).toBe("");
		const environment = new Map(
			fs
				.readFileSync(environmentFile, "utf8")
				.trim()
				.split("\n")
				.map((line) => {
					const separator = line.indexOf("=");
					return [line.slice(0, separator), line.slice(separator + 1)];
				}),
		);
		expect(environment.get("BUN_INSTALL")).toBe(path.join(home, ".bun"));
		expect(environment.get("PATH")?.split(":")[0]).toBe(
			path.join(home, ".bun", "bin"),
		);
		expect(environment.get("PATH")?.split(":")).toEqual(
			expect.arrayContaining([
				path.join(home, ".bun", "bin"),
				path.join(home, ".lmstudio", "bin"),
				path.join(home, "go", "bin"),
				path.join(home, ".cargo", "bin"),
				path.join(home, ".config", ".foundry", "bin"),
			]),
		);
		expect(environment.get("TMPDIR")).toBe(path.join(home, ".claude", "tmp"));
		expect(environment.get("HAOSHOKU_TEST_SECRET")).toBe("loaded");
	});

	it("runs fastfetch from managed Bun PATH in nested interactive TTY shells", () => {
		configureBash({ home });
		const bin = path.join(home, ".bun", "bin");
		fs.mkdirSync(bin, { recursive: true });
		const fastfetch = path.join(bin, "fastfetch");
		const fastfetchCall = path.join(home, "fastfetch-call");
		fs.writeFileSync(
			fastfetch,
			"#!/bin/sh\nprintf '%s\\n' \"$SHLVL\" > \"$FASTFETCH_CALL\"\n",
		);
		fs.chmodSync(fastfetch, 0o755);
		const fragment = path.join(home, ".config", "haoshoku", "bashrc");
		const script = Bun.which("script");
		expect(script).not.toBeNull();

		const result = spawnSync(
			script,
			[
				"-qec",
				'bash --noprofile --norc -ic \'source "$HAOSHOKU_FRAGMENT"; :\'',
				"/dev/null",
			],
			{
				encoding: "utf8",
				env: {
					HOME: home,
					PATH: "/usr/bin:/bin",
					FASTFETCH_CALL: fastfetchCall,
					HAOSHOKU_FRAGMENT: fragment,
					SHLVL: "9",
				},
			},
		);

		expect(result.status).toBe(0);
		expect(fs.existsSync(fastfetchCall)).toBe(true);
		expect(Number(fs.readFileSync(fastfetchCall, "utf8").trim())).toBeGreaterThan(
			9,
		);
	});

	it("suppresses fastfetch when an interactive shell stdout is not a TTY", () => {
		configureBash({ home });
		const bin = path.join(home, "bin");
		fs.mkdirSync(bin, { recursive: true });
		const fastfetchCall = path.join(home, "fastfetch-call");
		const fastfetch = path.join(bin, "fastfetch");
		fs.writeFileSync(
			fastfetch,
			"#!/bin/sh\nprintf 'called\\n' > \"$FASTFETCH_CALL\"\n",
		);
		fs.chmodSync(fastfetch, 0o755);

		const result = spawnSync(
			"bash",
			[
				"--noprofile",
				"--norc",
				"-ic",
				'source "$1"; :',
				"bash",
				path.join(home, ".config", "haoshoku", "bashrc"),
			],
			{
				encoding: "utf8",
				env: {
					HOME: home,
					PATH: `${bin}:/usr/bin:/bin`,
					FASTFETCH_CALL: fastfetchCall,
				},
			},
		);

		expect(result.status).toBe(0);
		expect(fs.existsSync(fastfetchCall)).toBe(false);
	});

	it("stays silent in interactive shells when fastfetch is unavailable", () => {
		configureBash({ home });
		const bin = path.join(home, "empty-bin");
		fs.mkdirSync(bin, { recursive: true });
		const dirname = path.join(bin, "dirname");
		fs.writeFileSync(dirname, "#!/bin/sh\nexit 0\n");
		fs.chmodSync(dirname, 0o755);
		const conda = path.join(home, "anaconda3", "bin", "conda");
		fs.mkdirSync(path.dirname(conda), { recursive: true });
		fs.writeFileSync(conda, "#!/bin/sh\nexit 0\n");
		fs.chmodSync(conda, 0o755);

		const bash = Bun.which("bash");
		expect(bash).not.toBeNull();
		const result = spawnSync(
			bash,
			[
				"--noprofile",
				"--norc",
				"-ic",
				'source "$1"; :',
				"bash",
				path.join(home, ".config", "haoshoku", "bashrc"),
			],
			{
				encoding: "utf8",
				env: { HOME: home, PATH: bin },
			},
		);

		expect(result.status).toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr).not.toMatch(/fastfetch|command not found/i);
	});

	it("exposes a user-installed Bun in a clean Bash environment", () => {
		configureBash({ home });
		const fragment = fs.readFileSync(
			path.join(home, ".config", "haoshoku", "bashrc"),
			"utf8",
		);
		expect(fragment).toContain('export BUN_INSTALL="$HOME/.bun"');
		expect(fragment).toContain('"$BUN_INSTALL/bin"');
	});

	it("preserves hashall state without initializer hash warnings", () => {
		const bin = path.join(home, "bin");
		fs.mkdirSync(bin, { recursive: true });
		for (const command of [
			"starship",
			"direnv",
			"zoxide",
			"pyenv",
			"thefuck",
		]) {
			const executable = path.join(bin, command);
			fs.writeFileSync(
				executable,
				"#!/usr/bin/env bash\nprintf 'hash -r\\n'\n",
			);
			fs.chmodSync(executable, 0o755);
		}

		const conda = path.join(home, "anaconda3", "bin", "conda");
		fs.mkdirSync(path.dirname(conda), { recursive: true });
		fs.writeFileSync(conda, "#!/usr/bin/env bash\nprintf 'hash -r\\n'\n");
		fs.chmodSync(conda, 0o755);

		const fragment = path.join(
			import.meta.dir,
			"..",
			"configs",
			"bash",
			"haoshoku.bash",
		);
		const sourceFragment = (
			hashing,
			beforeSource = "",
			afterSource = `set -o | awk '$1 == "hashall" { print $2 }'`,
		) =>
			spawnSync(
				"bash",
				[
					"--noprofile",
					"--norc",
					"-c",
					`set ${hashing ? "-h" : "+h"}; ${beforeSource} source "$1"; ${afterSource}`,
					"bash",
					fragment,
				],
				{
					encoding: "utf8",
					env: {
						...process.env,
						HOME: home,
						PATH: `${bin}:${process.env.PATH}`,
					},
				},
			);

		const initiallyDisabled = sourceFragment(false);
		expect(initiallyDisabled.status).toBe(0);
		expect(initiallyDisabled.stderr).not.toContain("hashing disabled");
		expect(initiallyDisabled.stdout.trim()).toBe("off");

		const initiallyEnabled = sourceFragment(true);
		expect(initiallyEnabled.status).toBe(0);
		expect(initiallyEnabled.stderr).not.toContain("hashing disabled");
		expect(initiallyEnabled.stdout.trim()).toBe("on");

		const initiallyEnabledWithMarker = sourceFragment(
			true,
			"haoshoku_restore_hashall=preexisting;",
			`printf '%s;%s\\n' "$(set -o | awk '$1 == "hashall" { print $2 }')" "$haoshoku_restore_hashall"`,
		);
		expect(initiallyEnabledWithMarker.status).toBe(0);
		expect(initiallyEnabledWithMarker.stderr).not.toContain("hashing disabled");
		expect(initiallyEnabledWithMarker.stdout.trim()).toBe("on;preexisting");
	});

	it("keeps bun-bin in the Arch package set", () => {
		const packages = fs
			.readFileSync(
				path.join(import.meta.dir, "..", "common", "paru_applist.txt"),
				"utf8",
			)
			.split(/\r?\n/);
		expect(packages).toContain("bun-bin");
	});
});
