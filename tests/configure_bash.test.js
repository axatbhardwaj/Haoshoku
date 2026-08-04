import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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
