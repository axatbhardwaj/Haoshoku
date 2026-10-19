import { describe, expect, it } from "bun:test";
import { makeFakeRun, probeOutput, activeFirewall, addedHeader, sshRule, makeFakeCapture, runDefaultSetupWithSafeDoubles } from "./fixtures.js";
import { setupFirewall } from "../../src/os_scripts/debian_server.js";

describe("tailnet firewall hardening evidence", () => {
	for (const rule of [
		"ufw allow OpenSSH",
		"ufw allow ssh",
		"ufw allow 22/tcp",
		"ufw limit 22/tcp",
		"ufw allow from 0.0.0.0/0 to any port 22 proto tcp",
		"ufw allow from ::/0 to any port 22 proto tcp",
		"ufw allow in on eth0 to any port 22 proto tcp",
		"ufw allow 20:25/tcp",
		"ufw allow 22,80,443/tcp",
		"ufw allow from any",
	])
		it(`reports preserved public SSH rule: ${rule}`, async () => {
			const { run, calls } = makeFakeRun();
			const result = await setupFirewall({
				run,
				prompt: async () => true,
				capture: makeFakeCapture({
					"sudo ufw show added": probeOutput(addedHeader + rule + "\n"),
				}).capture,
			});
			expect(result).toMatchObject({ ok: false });
			expect(result.reason).toMatch(/public SSH.*operator.*retry/i);
			expect(calls).toContain(sshRule);
			expect(
				calls.some((c) =>
					/delete|reset|sshd|tailscale ssh|authorized_keys/.test(c),
				),
			).toBe(false);
		});
	it("reports IPv6-only existing public SSH in active status", async () => {
		const { run, calls } = makeFakeRun();
		const result = await setupFirewall({
			run,
			prompt: async () => false,
			capture: makeFakeCapture({
				"sudo ufw status": probeOutput(
					activeFirewall +
						"22/tcp (v6)               ALLOW IN    Anywhere (v6)\n",
				),
			}).capture,
		});
		expect(result).toMatchObject({ ok: false });
		expect(result.reason).toMatch(/public SSH/i);
		expect(calls).toContain(sshRule);
	});
	it("does not invent completeness on repeated setup with public rules", async () => {
		const { run, calls } = makeFakeRun();
		const { capture } = makeFakeCapture({
			"sudo ufw status": probeOutput(activeFirewall),
			"sudo ufw show added": probeOutput(
				addedHeader +
					"ufw allow 22/tcp\nufw allow in on tailscale0 to any app OpenSSH\n",
			),
		});
		for (let i = 0; i < 2; i++)
			expect(
				await setupFirewall({ run, capture, prompt: async () => false }),
			).toMatchObject({ ok: false });
		expect(calls.filter((c) => c === sshRule)).toHaveLength(2);
		expect(calls.some((c) => /delete|reset/.test(c))).toBe(false);
	});
	it("propagates public SSH hardening gap to overall Debian result", () => {
		const { result, events } = runDefaultSetupWithSafeDoubles({
			firewall: { rules: "ufw allow from ::/0 to any port 22 proto tcp\n" },
		});
		expect(result).toBe(false);
		expect(events).toContainEqual({
			type: "error",
			message: expect.stringMatching(/firewall.*incomplete/i),
		});
	});
	for (const output of [
		activeFirewall.replace(
			"OpenSSH (v6) on tailscale0  ALLOW IN    Anywhere (v6)\n",
			"",
		),
		activeFirewall.replace(
			"OpenSSH on tailscale0       ALLOW IN    Anywhere\n",
			"",
		),
		"Status: active\n",
		"Status: inactive\n",
		"Status: active\nStatus: inactive\n",
	])
		it(`requires verified active IPv4 and IPv6 tailnet rules: ${output.slice(0, 30)}`, async () => {
			const { run } = makeFakeRun();
			const base = makeFakeCapture();
			let statuses = 0;
			const capture = (command) =>
				command === "sudo ufw status" && ++statuses === 2
					? probeOutput(output)
					: base.capture(command);
			const result = await setupFirewall({
				run,
				capture,
				prompt: async () => true,
			});
			expect(result).toMatchObject({ ok: false });
			expect(result.reason).toMatch(/verif|inactive/i);
		});
	it("refuses unknown saved-rule format before mutation", async () => {
		const { run, calls } = makeFakeRun();
		expect(
			await setupFirewall({
				run,
				capture: makeFakeCapture({
					"sudo ufw show added": probeOutput(addedHeader + "nonsense\n"),
				}).capture,
			}),
		).toMatchObject({ ok: false });
		expect(calls).toEqual([]);
	});
});

