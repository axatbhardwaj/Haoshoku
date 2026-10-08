import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { promptDeviceType } from "../src/common/device_type.js";
import { log, readConfiguredDeviceType } from "../src/common/utils.js";

const manifest = {
	tailnet: "example.ts.net",
	hosts: [
		{
			hostname: "desktop",
			role: "pc",
			os: "arch",
			deviceType: "pc",
			sshUser: "tester",
			transport: "tailscale",
		},
		{
			hostname: "portable",
			role: "laptop",
			os: "arch",
			deviceType: "laptop",
			sshUser: "tester",
			transport: "tailscale",
		},
		{
			hostname: "worker",
			role: "agent box",
			os: "arch",
			deviceType: "iobox",
			sshUser: "tester",
			transport: "tailscale",
		},
		{
			hostname: "server",
			role: "vps",
			os: "debian",
			sshUser: "root",
			transport: "openssh",
			identityFile: "server_key",
		},
	],
};

describe("fleet device detection", () => {
	let home;
	let configPath;
	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-fleet-"));
		configPath = path.join(home, ".haoshoku.json");
	});
	afterEach(() => fs.rmSync(home, { recursive: true }));

	it.each([
		["desktop", "pc"],
		["portable", "laptop"],
		["worker", "iobox"],
	])("persists %s's fleet type before DMI or prompt", async (hostname, deviceType) => {
		fs.writeFileSync(configPath, '{"customSetting":"keep"}\n');
		const result = await promptDeviceType({
			configPath,
			hostname,
			fleetManifest: manifest,
			detectDeviceTypeImpl: () => {
				throw new Error("DMI must not run");
			},
			promptFn: async () => {
				throw new Error("prompt must not run");
			},
		});
		expect(result).toBe(deviceType);
		expect(readConfiguredDeviceType(home)).toBe(deviceType);
		expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toEqual({
			customSetting: "keep",
			deviceType,
		});
	});

	it.each([
		"unknown",
		"server",
	])("falls through to DMI for %s", async (hostname) => {
		expect(
			await promptDeviceType({
				configPath,
				hostname,
				fleetManifest: manifest,
				detectDeviceTypeImpl: () => "laptop",
				isTTY: false,
			}),
		).toBe("laptop");
		expect(readConfiguredDeviceType(home)).toBe("laptop");
	});

	it("honors an explicit override over stored and fleet types", async () => {
		fs.writeFileSync(configPath, '{"deviceType":"pc"}\n');
		expect(
			await promptDeviceType({
				configPath,
				hostname: "worker",
				fleetManifest: manifest,
				forcedDeviceType: "laptop",
			}),
		).toBe("laptop");
		expect(readConfiguredDeviceType(home)).toBe("laptop");
	});

	it.each([
		undefined,
		'{"deviceType":"pc","keep":true}\n',
	])("rejects a duplicate fleet before any config write (%#)", async (stored) => {
		if (stored !== undefined) fs.writeFileSync(configPath, stored);
		await expect(
			promptDeviceType({
				configPath,
				hostname: "worker",
				forcedDeviceType: "laptop",
				fleetManifest: {
					...manifest,
					hosts: [...manifest.hosts, manifest.hosts[0]],
				},
			}),
		).rejects.toThrow(/fleet.*duplicate.*desktop/i);
		if (stored === undefined) expect(fs.existsSync(configPath)).toBe(false);
		else expect(fs.readFileSync(configPath, "utf8")).toBe(stored);
	});

	it.each([
		"pc",
		"iobox",
	])("keeps stored %s and warns only on fleet disagreement", async (deviceType) => {
		const stored = `${JSON.stringify({ deviceType, keep: true })}\n`;
		fs.writeFileSync(configPath, stored);
		const warnings = [];
		const originalWarning = log.warning;
		log.warning = (message) => warnings.push(message);
		try {
			expect(
				await promptDeviceType({
					configPath,
					hostname: "worker",
					fleetManifest: manifest,
					detectDeviceTypeImpl: () => {
						throw new Error("DMI must not run");
					},
					promptFn: async () => {
						throw new Error("prompt must not run");
					},
				}),
			).toBe(deviceType);
		} finally {
			log.warning = originalWarning;
		}
		expect(fs.readFileSync(configPath, "utf8")).toBe(stored);
		if (deviceType === "pc") {
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("haoshoku --device-type iobox");
			expect(warnings[0]).toContain("worker");
		} else expect(warnings).toEqual([]);
	});
});
