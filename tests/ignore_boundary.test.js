import { expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");

it("keeps active ignore configuration free of the former identifier", () => {
	const formerIdentifier = ["dvan", "dva"].join("");
	const legacyDirectory = `.${formerIdentifier}`;
	const projectIgnore = fs.readFileSync(
		path.join(PROJECT_ROOT, ".gitignore"),
		"utf8",
	);
	for (const ignoreFile of [".gitignore", ".npmignore"]) {
		expect(
			fs.readFileSync(path.join(PROJECT_ROOT, ignoreFile), "utf8"),
		).not.toContain(formerIdentifier);
	}
	expect(projectIgnore).toContain(".dvan[d]va/");
	expect(projectIgnore).not.toContain("/report.json");
	expect(
		fs.readFileSync(path.join(PROJECT_ROOT, ".npmignore"), "utf8"),
	).toContain(".dvan[d]va/");

	const repository = fs.mkdtempSync(
		path.join(os.tmpdir(), "haoshoku-ignore-boundary-"),
	);
	try {
		const init = Bun.spawnSync(["git", "init", "--quiet"], { cwd: repository });
		expect(init.exitCode).toBe(0);
		fs.writeFileSync(
			path.join(repository, ".gitignore"),
			fs.readFileSync(path.join(PROJECT_ROOT, ".gitignore"), "utf8"),
		);
		fs.mkdirSync(path.join(repository, legacyDirectory));
		fs.writeFileSync(
			path.join(repository, legacyDirectory, "state"),
			"state\n",
		);

		const checkIgnore = Bun.spawnSync(
			["git", "check-ignore", "--quiet", `${legacyDirectory}/state`],
			{ cwd: repository },
		);
		expect(checkIgnore.exitCode).toBe(0);
	} finally {
		fs.rmSync(repository, { recursive: true, force: true });
	}
});
