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
			"alias agy=",
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
		const sourceFragment = (hashing) =>
			spawnSync(
				"bash",
				[
					"--noprofile",
					"--norc",
					"-c",
					`set ${hashing ? "-h" : "+h"}; source "$1"; set -o | awk '$1 == "hashall" { print $2 }'`,
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
