import { describe, expect, it } from "bun:test";

import { checkOmarchyV4 } from "../src/common/omarchy_version.js";

describe("checkOmarchyV4", () => {
	it("accepts v4+ and preserves the caller environment while forcing the system Omarchy path", async () => {
		const calls = [];
		const result = await checkOmarchyV4({
			env: { SENTINEL: "kept", OMARCHY_PATH: "/live/shim" },
			captureCommandImpl: async (command, options) => {
				calls.push([command, options]);
				return { exitCode: 0, stdout: "Omarchy v4.2.1\n" };
			},
		});

		expect(result).toEqual({ ok: true, major: 4 });
		expect(calls).toEqual([
			[
				"omarchy version",
				{ env: { SENTINEL: "kept", OMARCHY_PATH: "/usr/share/omarchy" } },
			],
		]);
	});

	it("returns one consistent refusal for missing, unparsable, or pre-v4 Omarchy", async () => {
		for (const version of [
			{ exitCode: 127, stdout: "" },
			{ exitCode: 0, stdout: "development build" },
			{ exitCode: 0, stdout: "Omarchy 3.8.5\n" },
		]) {
			const warnings = [];
			const result = await checkOmarchyV4({
				captureCommandImpl: async () => version,
				logImpl: { warning: (message) => warnings.push(message) },
			});
			expect(result).toEqual({
				ok: false,
				status: "refused",
				message: expect.stringContaining("Omarchy 4 or newer"),
			});
			expect(warnings).toEqual([result.message]);
		}
	});

	it("converts a thrown version probe into the standard nonthrowing refusal", async () => {
		const warnings = [];
		const result = await checkOmarchyV4({
			captureCommandImpl: async () => {
				throw new Error("omarchy executable missing");
			},
			logImpl: { warning: (message) => warnings.push(message) },
		});

		expect(result).toEqual({
			ok: false,
			status: "refused",
			message: expect.stringContaining("Omarchy 4 or newer"),
		});
		expect(warnings).toEqual([result.message]);
	});
});
