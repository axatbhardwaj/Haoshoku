import { describe, expect, it } from "bun:test";
import { makeFakeRun, sshRule, runDefaultSetupWithSafeDoubles, f1Capture } from "./fixtures.js";
import { setupFirewall } from "../../src/os_scripts/debian_server.js";

describe("F6 native interface-only rules", () => {
	for (const iface of ["wg0", "tailscale0"])
		for (const action of ["allow", "limit"])
			for (const logging of ["", " log", " log-all"])
				for (const comment of [
					"",
					" comment 'vpc # proto udp in on tailscale0'",
				])
					for (const active of [true, false])
						it(`${active ? "active" : "inactive"}: ${action} in on ${iface}${logging}${comment}`, async () => {
							const { run, calls } = makeFakeRun();
							const { capture } = f1Capture({
								active,
								rows: [
									[`Anywhere on ${iface}`, "Anywhere", action.toUpperCase()],
									[
										`Anywhere (v6) on ${iface}`,
										"Anywhere (v6)",
										action.toUpperCase(),
									],
								],
								rules: `ufw ${action} in on ${iface}${logging}${comment}\n`,
							});
							for (let repeat = 0; repeat < 2; repeat++) {
								const result = await setupFirewall({
									run,
									capture,
									prompt: async () => true,
								});
								expect(result).toMatchObject({ ok: iface === "tailscale0" });
								if (iface !== "tailscale0")
									expect(result.reason).toMatch(/public SSH.*operator.*retry/i);
							}
							const expected = [
								sshRule,
								"sudo ufw default deny incoming",
								"sudo ufw default allow outgoing",
								"sudo ufw allow http",
								"sudo ufw allow https",
								"sudo ufw enable",
							];
							for (const start of [0, expected.length])
								expect(calls.slice(start, start + expected.length)).toEqual(
									expected,
								);
							expect(
								calls.some((c) => /delete|reset|tailscale ssh|sshd/.test(c)),
							).toBe(false);
						});
	for (const iface of ["eth1", "br-vpc.10", "wg+"])
		it(`recognizes valid UFW interface ${iface}`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = f1Capture({
				active: false,
				rules: `ufw allow in on ${iface}\n`,
			});
			const result = await setupFirewall({
				run,
				capture,
				prompt: async () => true,
			});
			expect(result).toMatchObject({ ok: false });
			expect(result.reason).toMatch(/public SSH.*operator.*retry/i);
			expect(calls[0]).toBe(sshRule);
		});
	for (const rule of [
		"ufw allow",
		"ufw allow log",
		"ufw allow in",
		"ufw allow in on",
		"ufw allow in on ''",
		"ufw allow in on .",
		"ufw allow in on ..",
		"ufw allow in on eth0:1",
		"ufw allow in on wg/0",
		"ufw allow in on 1234567890123456",
		"ufw allow in on 'wg 0'",
		"ufw allow in on 'wg;id'",
		"ufw allow in on wg0 nonsense",
		"ufw allow in on wg0 log log-all",
		"ufw allow in on wg0 proto",
		"ufw allow in on tailscale0 proto extra",
		"ufw allow in on tailscale0 nonsense",
	])
		it(`refuses malformed/truncated interface syntax ${rule}`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = f1Capture({ active: false, rules: `${rule}\n` });
			expect(
				await setupFirewall({ run, capture, prompt: async () => true }),
			).toMatchObject({ ok: false });
			expect(calls).toEqual([]);
		});
	for (const active of [true, false])
		it(`keeps interface-qualified UDP eligible on ${active ? "active" : "inactive"} UFW`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = f1Capture({
				active,
				rows: [
					["Anywhere/udp on wg0", "Anywhere/udp"],
					["Anywhere/udp (v6) on wg0", "Anywhere/udp (v6)"],
				],
				rules: "ufw allow in on wg0 log-all proto udp\n",
			});
			expect(
				await setupFirewall({ run, capture, prompt: async () => true }),
			).toMatchObject({ ok: true });
			expect(calls[0]).toBe(sshRule);
		});
	it("propagates truthful interface-only migration guidance and ordering through overall Debian setup", () => {
		const { result, events } = runDefaultSetupWithSafeDoubles({
			firewall: { rules: "ufw allow in on wg0\n" },
		});
		expect(result).toBe(false);
		expect(events).toContainEqual({
			type: "error",
			message: expect.stringMatching(
				/firewall.*incomplete.*public SSH.*operator.*retry/i,
			),
		});
		const commands = events
			.filter((e) => e.type === "command" && e.command.startsWith("sudo ufw "))
			.map((e) => e.command);
		expect(commands).toEqual([
			sshRule,
			"sudo ufw default deny incoming",
			"sudo ufw default allow outgoing",
			"sudo ufw allow http",
			"sudo ufw allow https",
			"sudo ufw enable",
		]);
	});
});
