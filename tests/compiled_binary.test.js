import { expect, test } from "bun:test";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dir, "..");

test("release bundle runs help and deploys a real config without Bun or the checkout", () => {
	const scratch = fs.mkdtempSync(path.join(tmpdir(), "haoshoku-compiled-"));
	try {
		const output = path.join(scratch, "output");
		fs.mkdirSync(output);
		const arch = process.arch === "arm64" ? "arm64" : "x64";
		const script = path.join(root, "scripts/package-binary.sh");
		const build = spawnSync("bash", [script, arch, output], {
			cwd: root,
			encoding: "utf8",
		});
		expect(build.status).toBe(0);
		const home = path.join(scratch, "home");
		fs.mkdirSync(home);
		const options = {
			cwd: home,
			env: { ...process.env, HOME: home, PATH: "/usr/bin:/bin" },
			encoding: "utf8",
		};
		const install = spawnSync("/bin/bash", [], {
			...options,
			input: fs.readFileSync(path.join(root, "install.sh")),
			env: {
				...options.env,
				HAOSHOKU_HOME: path.join(home, ".local/share/haoshoku"),
				HAOSHOKU_TARBALL: `file://${output}/haoshoku-linux-${arch}.tar.gz`,
			},
		});
		expect(install.status).toBe(0);
		const installed = path.join(home, ".local/share/haoshoku");
		for (const dir of ["configs", "common", "deskback", "icons"]) {
			expect(fs.readdirSync(path.join(installed, dir)).length).toBeGreaterThan(
				0,
			);
		}
		const qml = "src/helpers/kde_connect_commands_writer.qml";
		expect(fs.readFileSync(path.join(installed, qml))).toEqual(
			fs.readFileSync(path.join(root, qml)),
		);
		const binary = path.join(home, ".local/bin/haoshoku");
		const help = spawnSync(binary, ["--help"], options);
		expect(help.status).toBe(0);
		expect(help.stdout).toContain("Usage: haoshoku");
		const packagedConfig = path.join(installed, "configs/codex/AGENTS.md");
		expect(fs.existsSync(packagedConfig)).toBe(true);
		// Distinguish the shipped asset from the still-readable build checkout.
		const expected = `${fs.readFileSync(packagedConfig, "utf8")}\nPackaged asset probe\n`;
		fs.writeFileSync(packagedConfig, expected);
		const deploy = spawnSync(binary, ["--codex"], options);
		expect(deploy.status).toBe(0);
		expect(fs.existsSync(path.join(home, ".codex/AGENTS.md"))).toBe(true);
		expect(fs.readFileSync(path.join(home, ".codex/AGENTS.md"), "utf8")).toBe(
			expected,
		);
	} finally {
		fs.rmSync(scratch, { recursive: true, force: true });
	}
}, 120000);
