import { describe, expect, it } from "bun:test";
import { makeFakeRun, probeOutput, activeFirewall, sshRule, makeFakeCapture, makeFakePrompt } from "./fixtures.js";
import { setupFirewall } from "../../src/os_scripts/debian_server.js";

describe("tailnet firewall command outcomes", () => {
	it("installs interface OpenSSH before defaults, preserves web rules and confirms enable", async () => {
		const { run, calls } = makeFakeRun();
		const { prompt, calls: prompts } = makeFakePrompt(true);
		const result = await setupFirewall({
			run,
			prompt,
			capture: makeFakeCapture().capture,
		});
		expect(result).toMatchObject({ ok: true });
		expect(calls).toEqual([
			sshRule,
			"sudo ufw default deny incoming",
			"sudo ufw default allow outgoing",
			"sudo ufw allow http",
			"sudo ufw allow https",
			"sudo ufw enable",
		]);
		expect(prompts).toEqual(["Enable UFW now?"]);
	});
	it("applies the same rule-first ordering on active UFW without reset", async () => {
		const { run, calls } = makeFakeRun();
		const { prompt, calls: prompts } = makeFakePrompt(false);
		const result = await setupFirewall({
			run,
			prompt,
			capture: makeFakeCapture({
				"sudo ufw status": probeOutput(activeFirewall),
			}).capture,
		});
		expect(result).toMatchObject({ ok: true });
		expect(calls).toEqual([
			sshRule,
			"sudo ufw default deny incoming",
			"sudo ufw default allow outgoing",
			"sudo ufw allow http",
			"sudo ufw allow https",
		]);
		expect(prompts).toEqual(["Enable UFW now?"]);
	});
	it("reports inactive UFW incomplete when enable is declined", async () => {
		const { run, calls } = makeFakeRun();
		const result = await setupFirewall({
			run,
			prompt: async () => false,
			capture: makeFakeCapture().capture,
		});
		expect(result).toMatchObject({ ok: false });
		expect(result.reason).toMatch(/inactive.*retry/i);
		expect(calls).not.toContain("sudo ufw enable");
	});
	for (const command of [
		sshRule,
		"sudo ufw default deny incoming",
		"sudo ufw default allow outgoing",
		"sudo ufw allow http",
		"sudo ufw allow https",
		"sudo ufw enable",
	]) {
		it(`reports failed ${command} and refuses unsafe continuation`, async () => {
			const { run, calls } = makeFakeRun({ [command]: false });
			const { prompt, calls: prompts } = makeFakePrompt(true);
			const result = await setupFirewall({
				run,
				prompt,
				capture: makeFakeCapture().capture,
			});
			expect(result).toMatchObject({ ok: false });
			expect(result.reason).toContain(command);
			expect(calls.at(-1)).toBe(command);
			if (command !== "sudo ufw enable") expect(prompts).toEqual([]);
		});
	}
	for (const command of [
		"sudo ufw status",
		"sudo ufw show added",
		"sudo cat /etc/default/ufw",
	])
		it(`refuses failed ${command} inspection before mutation`, async () => {
			const { run, calls } = makeFakeRun();
			const result = await setupFirewall({
				run,
				capture: makeFakeCapture({ [command]: probeOutput("", 1) }).capture,
			});
			expect(result).toMatchObject({ ok: false });
			expect(calls).toEqual([]);
		});
	for (const [command, output] of [
		["sudo ufw status", ""],
		["sudo ufw status", "Status: active\nStatus: inactive"],
		["sudo ufw show added", "not a report"],
		["sudo cat /etc/default/ufw", "IPV6=no"],
		["sudo cat /etc/default/ufw", "IPV6=yes\nIPV6=no"],
	])
		it(`refuses ambiguous or unsupported inspection: ${output}`, async () => {
			const { run, calls } = makeFakeRun();
			expect(
				await setupFirewall({
					run,
					capture: makeFakeCapture({ [command]: probeOutput(output) }).capture,
				}),
			).toMatchObject({ ok: false });
			expect(calls).toEqual([]);
		});
});
