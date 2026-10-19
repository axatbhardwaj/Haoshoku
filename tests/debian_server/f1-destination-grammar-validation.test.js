import { describe, expect, it } from "bun:test";
import { makeFakeRun, f1Capture } from "./fixtures.js";
import { setupFirewall } from "../../src/os_scripts/debian_server.js";

describe("F1 destination grammar validation", () => {
	for (const address of [
		"203.0.113.5/33",
		"2001:db8::5/129",
		"203.0.113.5/garbage",
		"2001:db8::5/64/extra",
	])
		it(`refuses malformed status destination ${address} before mutation`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = f1Capture({ rows: [[`${address} 80/tcp`]] });
			expect(
				await setupFirewall({ run, capture, prompt: async () => true }),
			).toMatchObject({ ok: false });
			expect(calls).toEqual([]);
		});
	for (const address of ["banana", "203.0.113.5/33", "2001:db8::5/129"])
		it(`refuses malformed saved destination ${address} before mutation`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = f1Capture({
				rules: `ufw allow from any to ${address} port 80 proto tcp\n`,
			});
			expect(
				await setupFirewall({ run, capture, prompt: async () => true }),
			).toMatchObject({ ok: false });
			expect(calls).toEqual([]);
		});
});
