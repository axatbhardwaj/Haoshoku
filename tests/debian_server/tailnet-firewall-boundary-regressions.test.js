import { describe, expect, it } from "bun:test";
import { makeFakeRun, probeOutput, activeFirewall, addedHeader, sshRule, makeFakeCapture, runDefaultSetupWithSafeDoubles } from "./fixtures.js";
import { setupFirewall } from "../../src/os_scripts/debian_server.js";

describe("tailnet firewall boundary regressions", () => {
	it("keeps complete reruns complete with saved interface/web/outgoing/UDP rules", async () => {
		const { run, calls } = makeFakeRun();
		const { capture } = makeFakeCapture({
			"sudo ufw status": probeOutput(activeFirewall),
			"sudo ufw show added": probeOutput(
				addedHeader +
					"ufw allow in on tailscale0 to any app OpenSSH\nufw allow http\nufw allow https\nufw allow out 22/tcp\nufw allow 22/udp\nufw deny 22/tcp\nufw route allow from any to any port 22\n",
			),
		});
		for (let i = 0; i < 2; i++)
			expect(
				await setupFirewall({ run, capture, prompt: async () => false }),
			).toMatchObject({ ok: true });
		expect(calls.filter((c) => c === sshRule)).toHaveLength(2);
		expect(calls.filter((c) => c === "sudo ufw allow http")).toHaveLength(2);
		expect(calls.filter((c) => c === "sudo ufw allow https")).toHaveLength(2);
	});
	it("reports a thrown rule command and never changes defaults", async () => {
		const calls = [];
		const run = async (command) => {
			calls.push(command);
			throw new Error("fixture denied");
		};
		expect(
			await setupFirewall({ run, capture: makeFakeCapture().capture }),
		).toMatchObject({ ok: false });
		expect(calls).toEqual([sshRule]);
	});
	it("reports skipped confirmation on inactive UFW", async () => {
		const { run, calls } = makeFakeRun();
		const result = await setupFirewall({
			run,
			capture: makeFakeCapture().capture,
			prompt: async () => {
				throw new Error("confirmation unavailable");
			},
		});
		expect(result).toMatchObject({ ok: false });
		expect(result.reason).toMatch(/skipped.*retry/i);
		expect(calls).not.toContain("sudo ufw enable");
	});
	it("cannot treat a failed final status probe as complete", async () => {
		const { run } = makeFakeRun();
		const base = makeFakeCapture();
		let statuses = 0;
		const capture = (command) =>
			command === "sudo ufw status" && ++statuses === 2
				? probeOutput("", 1)
				: base.capture(command);
		expect(
			await setupFirewall({ run, capture, prompt: async () => true }),
		).toMatchObject({ ok: false });
	});
	it("refuses unknown application profiles without guessing SSH exposure", async () => {
		const { run, calls } = makeFakeRun();
		const result = await setupFirewall({
			run,
			capture: makeFakeCapture({
				"sudo ufw show added": probeOutput(
					addedHeader + "ufw allow CustomProfile\n",
				),
			}).capture,
		});
		expect(result).toMatchObject({ ok: false });
		expect(result.reason).toMatch(/operator inspection/i);
		expect(calls).toEqual([]);
	});
	for (const firewall of [
		{ status: "Status: inactive\n", enable: false },
		{ runFailures: [sshRule] },
		{ runFailures: ["sudo ufw enable"] },
	])
		it(`propagates firewall incompleteness through overall setup: ${JSON.stringify(firewall)}`, () => {
			const { result, events } = runDefaultSetupWithSafeDoubles({ firewall });
			expect(result).toBe(false);
			expect(events).toContainEqual({
				type: "error",
				message: expect.stringMatching(/firewall.*incomplete.*retry/i),
			});
			expect(events).not.toContainEqual({
				type: "success",
				message: expect.stringContaining("Debian Server setup finished"),
			});
			expect(events).toContainEqual({
				type: "command",
				command: "sudo systemctl enable ssh",
			});
			expect(events).toContainEqual({
				type: "command",
				command: "sudo systemctl start ssh",
			});
		});
});

it("accepts UFW's genuine empty saved rules report", async () => {
	const { run, calls } = makeFakeRun();
	const result = await setupFirewall({
		run,
		prompt: async () => true,
		capture: makeFakeCapture({
			"sudo ufw show added": probeOutput(`${addedHeader}(None)\n`),
		}).capture,
	});
	expect(result).toMatchObject({ ok: true });
	expect(calls[0]).toBe(sshRule);
});

// UFW's non-verbose get_status formatter: incoming action has no IN suffix.
