import { describe, expect, it } from "bun:test";
import { makeFakeRun, sshRule, runDefaultSetupWithSafeDoubles, ufwRow, realTailnetStatus, f1Capture } from "./fixtures.js";
import { setupFirewall } from "../../src/os_scripts/debian_server.js";

describe("F5 native UFW protocol grammar", () => {
	// util.py's supported protocols; ipv6 and igmp are IPv4-only, all but UDP
	// here are portless. Strings follow backend_iptables.py's status renderer.
	for (const protocol of ["udp", "esp", "ah", "gre", "ipv6", "igmp", "vrrp"]) {
		const destinations = ["Anywhere", "203.0.113.5", "203.0.113.0/24"];
		if (!["ipv6", "igmp"].includes(protocol))
			destinations.push(
				"Anywhere (v6)",
				"2001:db8::5",
				"2001:db8::/32",
				"2001:db8::/64",
			);
		for (const destination of destinations) {
			const address = destination.replace(" (v6)", "");
			const to = `${address}/${protocol}${destination.endsWith("(v6)") ? " (v6)" : ""}`;
			for (const active of [true, false])
				it(`completes ${active ? "active status" : "inactive saved"} ${to}`, async () => {
					const { run, calls } = makeFakeRun();
					const { capture, probes } = f1Capture({
						active,
						rows: active
							? [
									[
										to,
										address === "Anywhere"
											? to
											: destination.includes("v6") || address.includes(":")
												? "Anywhere (v6)"
												: "Anywhere",
									],
								]
							: [],
						rules: `ufw allow log-all from any to ${address === "Anywhere" ? "any" : address} proto ${protocol} comment 'TCP SSH stays on tailscale0'\n`,
					});
					const result = await setupFirewall({
						run,
						capture,
						prompt: async () => true,
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
					expect(probes.filter(Array.isArray)).toEqual([]);
				});
		}
		it(`accepts native source-address-only ${protocol} protocol display`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = f1Capture({
				rows: [["Anywhere", `203.0.113.0/24/${protocol}`]],
				rules: `ufw allow from 203.0.113.0/24 to any proto ${protocol}\n`,
			});
			expect(
				await setupFirewall({ run, capture, prompt: async () => true }),
			).toMatchObject({ ok: true });
			expect(calls[0]).toBe(sshRule);
		});
	}
	for (const [to, from, saved] of [
		["22/udp", "Anywhere", "ufw allow 22/udp"],
		[
			"2001:db8::/64 20:25/udp",
			"Anywhere (v6)",
			"ufw allow to 2001:db8::/64 port 20:25 proto udp",
		],
		[
			"203.0.113.0/24 80,443/udp",
			"Anywhere",
			"ufw allow to 203.0.113.0/24 port 80,443 proto udp",
		],
		["Anywhere", "53/udp", "ufw allow from any port 53 to any proto udp"],
		[
			"2001:db8::/64",
			"2001:db8:1::/64 53/udp",
			"ufw allow from 2001:db8:1::/64 port 53 to 2001:db8::/64 proto udp",
		],
	])
		it(`keeps native UDP port variant ${to} from ${from} non-SSH`, async () => {
			const { run } = makeFakeRun();
			const { capture } = f1Capture({
				rows: [[to, from]],
				rules: `${saved}\n`,
			});
			expect(
				await setupFirewall({ run, capture, prompt: async () => true }),
			).toMatchObject({ ok: true });
		});
	for (const [to, saved] of [
		["203.0.113.0/24/tcp", "ufw allow to 203.0.113.0/24 proto tcp"],
		["2001:db8::/64/tcp", "ufw allow to 2001:db8::/64 proto tcp"],
		["Anywhere/tcp", "ufw allow to any proto tcp"],
		["Anywhere (v6)", "ufw allow to any"],
		["2001:db8::/64", "ufw allow to 2001:db8::/64"],
		[
			"203.0.113.0/24 20:25/tcp",
			"ufw allow to 203.0.113.0/24 port 20:25 proto tcp",
		],
	])
		it(`preserves truthful public SSH guidance for ${to}`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = f1Capture({ rows: [[to]], rules: `${saved}\n` });
			for (let repeat = 0; repeat < 2; repeat++) {
				const result = await setupFirewall({
					run,
					capture,
					prompt: async () => true,
				});
				expect(result).toMatchObject({ ok: false });
				expect(result.reason).toMatch(/public SSH.*operator.*retry/i);
			}
			expect(calls[0]).toBe(sshRule);
			expect(calls.some((c) => /delete|reset/.test(c))).toBe(false);
		});
	for (const [to, from, saved] of [
		["203.0.113.0/33/udp", "Anywhere", "ufw allow to 203.0.113.0/33 proto udp"],
		[
			"2001:db8::/129/esp",
			"Anywhere (v6)",
			"ufw allow to 2001:db8::/129 proto esp",
		],
		[
			"2001:db8::/64/extra",
			"Anywhere (v6)",
			"ufw allow to 2001:db8::/64 proto extra",
		],
		[
			"2001:db8::/64/udp/extra",
			"Anywhere (v6)",
			"ufw allow to 2001:db8::/64 proto udp proto extra",
		],
		["Anywhere/icmp", "Anywhere", "ufw allow to any proto icmp"],
		["Anywhere/UDP", "Anywhere", "ufw allow to any proto UDP"],
		["Anywhere/", "Anywhere", "ufw allow to any proto"],
		[
			"Anywhere/esp (v6)",
			"Anywhere (v6)",
			"ufw allow to any proto esp proto udp",
		],
		[
			"Anywhere/ipv6 (v6)",
			"Anywhere (v6)",
			"ufw allow to 2001:db8::/64 proto ipv6",
		],
		[
			"2001:db8::/64/igmp",
			"Anywhere (v6)",
			"ufw allow to 2001:db8::/64 proto igmp",
		],
		["22/esp", "Anywhere", "ufw allow to any port 22 proto esp"],
		["Anywhere/gre", "22/gre", "ufw allow from any port 22 to any proto gre"],
		["Anywhere", "53/extra", "ufw allow from any port 53 to any proto extra"],
		["22/tcp", "53/udp", "ufw allow to any port 22 proto tcp proto udp"],
	])
		for (const active of [true, false])
			it(`refuses malformed ${active ? "status" : "saved"} protocol ${to} / ${saved}`, async () => {
				const { run, calls } = makeFakeRun();
				const { capture } = f1Capture({
					active,
					rows: active ? [[to, from]] : [],
					rules: `${saved}\n`,
				});
				expect(
					await setupFirewall({ run, capture, prompt: async () => true }),
				).toMatchObject({ ok: false });
				expect(calls).toEqual([]);
			});
	for (const saved of [
		"ufw allow to any port 22/udp proto tcp",
		"ufw allow to any port 22/tcp proto udp",
		"ufw allow from any port 53/tcp to any proto udp",
	])
		it(`refuses malformed full saved port/protocol syntax ${saved}`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = f1Capture({ active: false, rules: `${saved}\n` });
			expect(
				await setupFirewall({ run, capture, prompt: async () => true }),
			).toMatchObject({ ok: false });
			expect(calls).toEqual([]);
		});
	it("propagates valid CIDR/protocol coexistence into overall Debian success", () => {
		const { result, events } = runDefaultSetupWithSafeDoubles({
			firewall: {
				status:
					realTailnetStatus +
					ufwRow("203.0.113.0/24/udp") +
					"\n" +
					ufwRow("Anywhere/esp") +
					"\n",
				rules:
					"ufw allow to 203.0.113.0/24 proto udp\nufw allow to any proto esp\n",
			},
		});
		expect(result).toBe(true);
		expect(events).toContainEqual({
			type: "success",
			message: "Debian Server setup finished.",
		});
	});
	it("propagates CIDR TCP public SSH guidance into overall incomplete", () => {
		const { result, events } = runDefaultSetupWithSafeDoubles({
			firewall: {
				status:
					realTailnetStatus +
					ufwRow("2001:db8::/64/tcp", "Anywhere (v6)") +
					"\n",
				rules: "ufw allow to 2001:db8::/64 proto tcp\n",
			},
		});
		expect(result).toBe(false);
		expect(events).toContainEqual({
			type: "error",
			message: expect.stringMatching(
				/firewall.*incomplete.*public SSH.*retry/i,
			),
		});
	});
});
