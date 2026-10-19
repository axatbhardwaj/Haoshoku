import { describe, expect, it } from "bun:test";
import { makeFakeRun, probeOutput, sshRule, runDefaultSetupWithSafeDoubles, ufwRow, realTailnetStatus, profileInfo, f1Capture } from "./fixtures.js";
import { setupFirewall } from "../../src/os_scripts/debian_server.js";

describe("F1 legitimate firewall coexistence", () => {
	for (const [name, ports] of [
		["Nginx Full", ["80,443/tcp"]],
		["Apache Full", ["80/tcp", "443/tcp"]],
		["Postfix", ["25/tcp"]],
	]) {
		for (const active of [true, false])
			it(`completes with ${name} profile on ${active ? "active" : "inactive"} UFW`, async () => {
				const { run, calls } = makeFakeRun();
				const { capture, probes } = f1Capture({
					active,
					rows: active ? [[name], [name + " (v6)", "Anywhere (v6)"]] : [],
					rules: `ufw allow '${name}'\n`,
					profiles: { [name]: probeOutput(profileInfo(name, ports)) },
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
				expect(probes.filter(Array.isArray)).toContainEqual([
					"sudo",
					"ufw",
					"app",
					"info",
					name,
				]);
			});
	}
	for (const [destination, ports] of [
		["203.0.113.5", "80/tcp"],
		["2001:db8::5", "443/tcp"],
		["203.0.113.0/24", "80,443/tcp"],
	])
		it(`completes with non-SSH destination ${destination} ${ports}`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = f1Capture({
				rows: [[`${destination} ${ports}`]],
				rules: `ufw allow from any to ${destination} port ${ports.replace("/tcp", "")} proto tcp\n`,
			});
			expect(
				await setupFirewall({ run, capture, prompt: async () => false }),
			).toMatchObject({ ok: true });
			expect(calls[0]).toBe(sshRule);
		});
	it("resolves a destination-address application profile", async () => {
		const { run } = makeFakeRun();
		const { capture } = f1Capture({
			rows: [["203.0.113.5 Nginx Full"]],
			rules: "ufw allow from any to 203.0.113.5 app 'Nginx Full'\n",
			profiles: {
				"Nginx Full": probeOutput(profileInfo("Nginx Full", ["80,443/tcp"])),
			},
		});
		expect(
			await setupFirewall({ run, capture, prompt: async () => true }),
		).toMatchObject({ ok: true });
	});
	for (const logMode of ["log", "log-all"])
		it(`does not label ${logMode} web rules as public SSH`, async () => {
			const { run, calls } = makeFakeRun();
			const { capture } = f1Capture({
				rows: [["80/tcp", "Anywhere (log) # web to 22"]],
				rules: `ufw allow ${logMode} 80/tcp comment 'SSH stays on tailscale0'\n`,
			});
			expect(
				await setupFirewall({ run, capture, prompt: async () => true }),
			).toMatchObject({ ok: true });
			expect(calls).not.toContain("sudo ufw delete 80/tcp");
		});
	it("propagates legitimate web coexistence to successful overall Debian setup", () => {
		const { result, events } = runDefaultSetupWithSafeDoubles({
			firewall: {
				status:
					realTailnetStatus +
					ufwRow("Nginx Full") +
					"\n" +
					ufwRow("203.0.113.5 80/tcp") +
					"\n",
				rules: "ufw allow 'Nginx Full'\nufw allow log-all 80/tcp\n",
				profiles: { "Nginx Full": profileInfo("Nginx Full", ["80,443/tcp"]) },
			},
		});
		expect(result).toBe(true);
		expect(events).toContainEqual({
			type: "success",
			message: "Debian Server setup finished.",
		});
	});
});
