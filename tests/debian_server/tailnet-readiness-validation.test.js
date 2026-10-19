import { describe, expect, it } from "bun:test";
import { makeFakeRun, tailnetStatus, tailnetInterface, probeOutput, makeFakeCapture } from "./fixtures.js";
import { setupFirewall } from "../../src/os_scripts/debian_server.js";

describe("tailnet readiness validation", () => {
	for (const [name, status] of [
		["logged out", { ...tailnetStatus, BackendState: "NeedsLogin" }],
		["stopped", { ...tailnetStatus, BackendState: "Stopped" }],
		[
			"offline",
			{ ...tailnetStatus, Self: { ...tailnetStatus.Self, Online: false } },
		],
		["userspace networking", { ...tailnetStatus, TUN: false }],
		["missing current tailnet", { ...tailnetStatus, CurrentTailnet: null }],
		["missing addresses", { ...tailnetStatus, Self: { Online: true } }],
		[
			"invalid address",
			{ ...tailnetStatus, Self: { Online: true, TailscaleIPs: ["not-an-ip"] } },
		],
		["malformed", "not json"],
		["empty", null],
	])
		it(`refuses ${name} status without mutation`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = makeFakeCapture({
				"tailscale status --json": probeOutput(
					typeof status === "string" ? status : JSON.stringify(status),
				),
			});
			const result = await setupFirewall({
				run,
				capture,
				prompt: async () => true,
			});
			expect(result).toMatchObject({ ok: false });
			expect(result.reason).toMatch(/Tailscale|tailnet/i);
			expect(calls).toEqual([]);
		});
	for (const [name, value] of [
		["absent", []],
		["ambiguous", [...tailnetInterface, ...tailnetInterface]],
		["wrong interface", [{ ...tailnetInterface[0], ifname: "eth0" }]],
		["down", [{ ...tailnetInterface[0], flags: ["POINTOPOINT"] }]],
		["no addresses", [{ ...tailnetInterface[0], addr_info: [] }]],
		[
			"wrong addresses",
			[
				{
					...tailnetInterface[0],
					addr_info: [{ family: "inet", local: "192.0.2.1" }],
				},
			],
		],
		[
			"IPv6 mismatch",
			[
				{
					...tailnetInterface[0],
					addr_info: [tailnetInterface[0].addr_info[0]],
				},
			],
		],
		["malformed", "not json"],
	])
		it(`refuses ${name} tailscale0 without mutation`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = makeFakeCapture({
				"ip -j address show dev tailscale0": probeOutput(
					typeof value === "string" ? value : JSON.stringify(value),
				),
			});
			const result = await setupFirewall({
				run,
				capture,
				prompt: async () => true,
			});
			expect(result).toMatchObject({ ok: false });
			expect(result.reason).toMatch(/tailscale0/i);
			expect(calls).toEqual([]);
		});
	it("refuses failed interface probe before mutation", async () => {
		const { run, calls } = makeFakeRun();
		const { capture } = makeFakeCapture({
			"ip -j address show dev tailscale0": probeOutput("", 1),
		});
		expect(await setupFirewall({ run, capture })).toMatchObject({ ok: false });
		expect(calls).toEqual([]);
	});
});
