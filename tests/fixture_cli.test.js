import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("preload blocks unstubbed external CLIs before inherited PATH binaries", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-cli-guard-"));
	try {
		const inheritedBin = path.join(root, "inherited-bin");
		fs.mkdirSync(inheritedBin);
		const marker = path.join(root, "escaped-guard");
		for (const command of ["tailscale", "gh"]) {
			// These stand in for live binaries; the child can never reach the host PATH.
			fs.writeFileSync(
				path.join(inheritedBin, command),
				`#!/bin/sh\nprintf 'called\\n' >> '${marker}'\nexit 0\n`,
				{ mode: 0o755 },
			);
		}
		const childTest = path.join(root, "guard.test.js");
		fs.writeFileSync(
			childTest,
			`
import { expect, test } from "bun:test";
import fs from "node:fs";
test("unstubbed CLI calls are blocked and recorded, including subprocess inheritance", async () => {
	const expected = [];
	for (const command of ["tailscale", "gh"]) {
		expect(Bun.which(command)).not.toStartWith(${JSON.stringify(inheritedBin)});
		for (const argv of [[command, "arg with spaces", "--probe"], ["/bin/sh", "-c", command + ' "arg with spaces" --probe']]) {
			const result = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
			expect(result.exitCode).toBe(1);
			expected.push([command, "arg with spaces", "--probe"]);
			const child = Bun.spawn({ cmd: argv, stdout: "pipe", stderr: "pipe" });
			expect(await child.exited).toBe(1);
			expected.push([command, "arg with spaces", "--probe"]);
		}
	}
	const calls = fs.readFileSync(process.env.HAOSHOKU_TEST_CLI_CALLS, "utf8").trim().split("\\n").map(JSON.parse);
	expect(calls).toEqual(expected);
});
test("tests can prepend their own CLI fixtures", () => {
	const result = Bun.spawnSync(["gh", "custom behavior"], {
		env: { ...process.env, PATH: ${JSON.stringify(inheritedBin)} + ":" + process.env.PATH },
		stdout: "pipe", stderr: "pipe",
	});
	expect(result.exitCode).toBe(0);
});
`,
		);
		const result = Bun.spawnSync(
			[
				process.execPath,
				"test",
				"--preload",
				path.resolve(import.meta.dir, "fixture_home.js"),
				childTest,
			],
			{
				cwd: path.resolve(import.meta.dir, ".."),
				env: { ...process.env, PATH: inheritedBin },
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const output = `${result.stdout.toString()}${result.stderr.toString()}`;
		expect(result.exitCode, output).toBe(0);
		// Only the intentional fixture override may hit our fake inherited binary.
		expect(fs.readFileSync(marker, "utf8")).toBe("called\n");
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
