import { describe, expect, it } from "bun:test";
import { makeFakeRun, probeOutput, sshRule, runDefaultSetupWithSafeDoubles, profileInfo, f1Capture } from "./fixtures.js";
import { setupFirewall } from "../../src/os_scripts/debian_server.js";

describe("F1 SSH-bearing profile detection", () => {
	for (const [name, rule, rows] of [
		["HTTP", "ufw allow HTTP\n", [["HTTP"], ["HTTP (v6)", "Anywhere (v6)"]]],
		["https", "ufw allow to any app https\n", []],
	])
		it(`does not guess an application called ${name} is a safe web alias`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture, probes } = f1Capture({
				rows,
				rules: rule,
				profiles: {
					[name]: probeOutput(profileInfo(name, ["80/tcp", "22/tcp"])),
				},
			});
			const result = await setupFirewall({
				run,
				capture,
				prompt: async () => true,
			});
			expect(result).toMatchObject({ ok: false });
			expect(result.reason).toMatch(/public SSH/i);
			expect(probes.filter(Array.isArray)).toContainEqual([
				"sudo",
				"ufw",
				"app",
				"info",
				name,
			]);
			expect(calls[0]).toBe(sshRule);
		});
	for (const ports of [
		["22/tcp"],
		["80,22,443/tcp"],
		["20:25/tcp"],
		["22/udp", "20:25/tcp"],
	])
		it(`preserves and reports actual SSH-bearing profile ports ${ports}`, async () => {
			const name = "SSH out of band";
			const { run, calls } = makeFakeRun();
			const { capture } = f1Capture({
				active: false,
				rules: `ufw allow log-all '${name}'\n`,
				profiles: { [name]: probeOutput(profileInfo(name, ports)) },
			});
			for (let i = 0; i < 2; i++) {
				const result = await setupFirewall({
					run,
					capture,
					prompt: async () => true,
				});
				expect(result).toMatchObject({ ok: false });
				expect(result.reason).toMatch(/public SSH.*operator.*retry/i);
			}
			expect(calls.filter((c) => c === sshRule)).toHaveLength(2);
			expect(calls.some((c) => /delete|reset/.test(c))).toBe(false);
		});
	it("keeps profile UDP 22 separate from TCP SSH", async () => {
		const name = "UDP and web";
		const { run } = makeFakeRun();
		const { capture } = f1Capture({
			rules: `ufw allow log "${name}"\n`,
			profiles: {
				[name]: probeOutput(profileInfo(name, ["22/udp", "80,443/tcp"])),
			},
		});
		expect(
			await setupFirewall({ run, capture, prompt: async () => false }),
		).toMatchObject({ ok: true });
	});
	for (const [address, port] of [
		["203.0.113.5", "22/tcp"],
		["2001:db8::5", "20:25/tcp"],
	])
		it(`reports existing SSH at ${address}`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = f1Capture({
				rows: [[`${address} ${port}`]],
				rules: `ufw allow log-all from any to ${address} port ${port.replace("/tcp", "")} proto tcp\n`,
			});
			const result = await setupFirewall({
				run,
				capture,
				prompt: async () => true,
			});
			expect(result).toMatchObject({ ok: false });
			expect(result.reason).toMatch(/public SSH/i);
			expect(calls.some((c) => /delete|reset/.test(c))).toBe(false);
		});
	it("propagates profile lookup failure into overall incomplete setup", () => {
		const { result, events } = runDefaultSetupWithSafeDoubles({
			firewall: { rules: "ufw allow 'Nginx Full'\n" },
		});
		expect(result).toBe(false);
		expect(events).toContainEqual({
			type: "error",
			message: expect.stringMatching(
				/firewall.*incomplete.*Nginx Full.*retry/i,
			),
		});
	});
});

