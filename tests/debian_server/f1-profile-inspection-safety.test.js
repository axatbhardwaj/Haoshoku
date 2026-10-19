import { describe, expect, it } from "bun:test";
import { makeFakeRun, probeOutput, profileInfo, f1Capture } from "./fixtures.js";
import { setupFirewall } from "../../src/os_scripts/debian_server.js";

describe("F1 profile inspection safety", () => {
	const name = "Web app.v2+TLS";
	for (const [label, response] of [
		["lookup failure", probeOutput("", 1)],
		["lookup throw", new Error("fixture unavailable")],
		[
			"missing ports",
			probeOutput(`Profile: ${name}\nTitle: Web\nDescription: Web\n`),
		],
		["wrong profile", probeOutput(profileInfo("Other", ["80/tcp"]))],
		[
			"ambiguous profiles",
			probeOutput(
				profileInfo(name, ["80/tcp"]) + profileInfo("OpenSSH", ["22/tcp"]),
			),
		],
		["unparseable ports", probeOutput(profileInfo(name, ["not-ports"]))],
		[
			"SSH then malformed",
			probeOutput(profileInfo(name, ["22/tcp", "bad/udp"])),
		],
		["empty ports", probeOutput(profileInfo(name, []))],
		["zero port", probeOutput(profileInfo(name, ["0/tcp"]))],
		["out-of-range port", probeOutput(profileInfo(name, ["65536/tcp"]))],
		["reversed range", probeOutput(profileInfo(name, ["443:80/tcp"]))],
	])
		it(`fails closed with specific profile guidance on ${label}`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture, probes } = f1Capture({
				active: false,
				rules: `ufw allow '${name}'\n`,
				profiles: { [name]: response },
			});
			const result = await setupFirewall({
				run,
				capture,
				prompt: async () => true,
			});
			expect(probes.filter(Array.isArray)).toEqual([
				["sudo", "ufw", "app", "info", name],
			]);
			expect(result).toMatchObject({ ok: false });
			expect(result.reason).toContain(name);
			expect(result.reason).toMatch(/inspection.*retry/i);
			expect(calls).toEqual([]);
		});
	it("passes a valid spaced profile name as one argument, not shell text", async () => {
		const { run } = makeFakeRun();
		const { capture, probes } = f1Capture({
			rules: `ufw allow '${name}'\n`,
			profiles: {
				[name]: probeOutput(profileInfo(name, ["80/tcp", "443/udp"])),
			},
		});
		expect(
			await setupFirewall({ run, capture, prompt: async () => false }),
		).toMatchObject({ ok: true });
		expect(probes.filter(Array.isArray)).toContainEqual([
			"sudo",
			"ufw",
			"app",
			"info",
			name,
		]);
	});
	for (const malicious of [
		"Web;touch /tmp/escape",
		"Web$(id)",
		"Web`id`",
		"-all",
		"all",
		"Web\nPorts: 80/tcp",
	])
		it(`refuses invalid profile name ${JSON.stringify(malicious)} without a lookup`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture, probes } = f1Capture({
				rules: `ufw allow '${malicious}'\n`,
			});
			expect(
				await setupFirewall({ run, capture, prompt: async () => true }),
			).toMatchObject({ ok: false });
			expect(probes.filter(Array.isArray)).toEqual([]);
			expect(calls).toEqual([]);
		});
});
