import { describe, expect, it } from "bun:test";
import { makeFakeRun, tailnetStatus, tailnetInterface, probeOutput, makeFakeCapture } from "./fixtures.js";
import { setupFirewall } from "../../src/os_scripts/debian_server.js";

describe("tailnet malformed readiness fields", () => {
	for (const state of [
		{ ...tailnetStatus, CurrentTailnet: { Name: true } },
		{ ...tailnetStatus, Self: { Online: true, TailscaleIPs: ["192.0.2.1"] } },
		{ ...tailnetStatus, Self: { Online: true, TailscaleIPs: ["100.1.2.3"] } },
		{ ...tailnetStatus, Self: { Online: true, TailscaleIPs: ["2001:db8::1"] } },
		{
			...tailnetStatus,
			Self: {
				Online: true,
				TailscaleIPs: ["100.101.102.103", "100.101.102.103"],
			},
		},
	])
		it(`refuses malformed tailnet identity ${JSON.stringify(state.Self)}`, async () => {
			const interfaces = [
				{
					...tailnetInterface[0],
					addr_info: state.Self.TailscaleIPs.map((local) => ({
						local,
						family: local.includes(":") ? "inet6" : "inet",
					})),
				},
			];
			const { run, calls } = makeFakeRun();
			const { capture } = makeFakeCapture({
				"tailscale status --json": probeOutput(JSON.stringify(state)),
				"ip -j address show dev tailscale0": probeOutput(
					JSON.stringify(interfaces),
				),
			});
			expect(
				await setupFirewall({ run, capture, prompt: async () => true }),
			).toMatchObject({ ok: false });
			expect(calls).toEqual([]);
		});
	for (const iface of [
		{ ...tailnetInterface[0], ifindex: 0 },
		{ ...tailnetInterface[0], ifindex: "7" },
		{
			...tailnetInterface[0],
			addr_info: [
				...tailnetInterface[0].addr_info,
				tailnetInterface[0].addr_info[0],
			],
		},
	])
		it("refuses malformed or ambiguous interface identity", async () => {
			const { run, calls } = makeFakeRun();
			expect(
				await setupFirewall({
					run,
					capture: makeFakeCapture({
						"ip -j address show dev tailscale0": probeOutput(
							JSON.stringify([iface]),
						),
					}).capture,
					prompt: async () => true,
				}),
			).toMatchObject({ ok: false });
			expect(calls).toEqual([]);
		});
});

