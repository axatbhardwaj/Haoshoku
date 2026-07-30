import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

describe("haoshoku CLI help", () => {
	it("--claude does not advertise the retired conventions directory", () => {
		const source = fs.readFileSync(
			path.resolve(import.meta.dir, "..", "haoshoku.js"),
			"utf-8",
		);
		const helpText = source.match(
			/\.option\(\s*"--claude",\s*"([^"]+)"/s,
		)?.[1];

		expect(helpText).toBeDefined();
		expect(helpText).not.toContain("conventions");
	});
});
