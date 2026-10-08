import { describe, expect, it } from "bun:test";

import { loadFleet, lookupHost } from "../src/common/fleet.js";

const host = {
	hostname: "worker",
	role: "agent box",
	os: "arch",
	deviceType: "iobox",
	sshUser: "tester",
	transport: "tailscale",
};
const fleet = (entry = host) => ({ tailnet: "example.ts.net", hosts: [entry] });

describe("fleet manifest", () => {
	it("loads the tracked fleet for hostname consumers", () => {
		expect(loadFleet().tailnet).toBe("tail140c22.ts.net");
		expect(lookupHost("io")?.deviceType).toBe("pc");
		expect(lookupHost("iobook")?.deviceType).toBe("laptop");
		expect(lookupHost("iobox")?.deviceType).toBe("iobox");
		expect(lookupHost("axat-vps")).toMatchObject({
			os: "debian",
			transport: "openssh",
			identityFile: "id_ed25519_vps",
		});
		expect(lookupHost("unknown")).toBeNull();
	});

	it.each([
		[null, "object"],
		[[], "object"],
		[{}, "tailnet"],
		[{ tailnet: "100.64.0.1", hosts: [] }, "tailnet"],
		[{ tailnet: "example.ts.net\nHost bad", hosts: [] }, "tailnet"],
		[{ tailnet: "example.ts.net", hosts: {} }, "hosts"],
		[{ ...fleet(), token: "fixture" }, "token"],
		[{ ...fleet(), hosts: [host, { ...host }] }, "duplicate.*worker"],
	])("rejects malformed manifest %#", (manifest, message) => {
		expect(() => loadFleet({ manifest })).toThrow(
			new RegExp(`fleet.*${message}`, "i"),
		);
	});

	it.each([
		[null, "object"],
		[{ ...host, hostname: "../worker" }, "hostname"],
		[{ ...host, hostname: "" }, "hostname"],
		[{ ...host, role: "other" }, "role"],
		[{ ...host, os: "windows" }, "os"],
		[{ ...host, deviceType: "other" }, "deviceType"],
		[{ ...host, deviceType: undefined }, "deviceType"],
		[{ ...host, os: "debian" }, "deviceType"],
		[{ ...host, sshUser: "root\nHost bad" }, "sshUser"],
		[{ ...host, transport: "other" }, "transport"],
		[{ ...host, identityFile: "id_key" }, "identityFile"],
		[
			{ ...host, transport: "openssh", identityFile: "../id_key" },
			"identityFile",
		],
		[
			{ ...host, transport: "openssh", identityFile: "/id_key" },
			"identityFile",
		],
		[{ ...host, transport: "openssh", identityFile: ".." }, "identityFile"],
		[
			{ ...host, transport: "openssh", identityFile: "key\\file" },
			"identityFile",
		],
		[
			{ ...host, transport: "openssh", identityFile: "key\nfile" },
			"identityFile",
		],
		[{ ...host, transport: "openssh", identityFile: "" }, "identityFile"],
		[{ ...host, privateKey: "fixture" }, "privateKey"],
	])("rejects invalid host %# before lookup", (entry, message) => {
		expect(() => lookupHost("unknown", { manifest: fleet(entry) })).toThrow(
			new RegExp(`fleet.*${message}`, "i"),
		);
	});

	it("accepts Debian without a device type and a plain OpenSSH filename", () => {
		const server = {
			hostname: "server",
			role: "vps",
			os: "debian",
			sshUser: "root",
			transport: "openssh",
			identityFile: "id_ed25519_vps",
		};
		expect(lookupHost("server", { manifest: fleet(server) })).toEqual(server);
	});

	it.each([
		"\n",
		"\r",
		"\r\n",
	])("rejects trailing line endings in manifest values (%#)", (ending) => {
		for (const [field, value] of [
			["hostname", "worker"],
			["sshUser", "tester"],
			["identityFile", "id_key"],
		]) {
			expect(() =>
				loadFleet({
					manifest: fleet({
						...host,
						transport: "openssh",
						[field]: value + ending,
					}),
				}),
			).toThrow(new RegExp(field));
		}
		expect(() =>
			loadFleet({
				manifest: { ...fleet(), tailnet: `example.ts.net${ending}` },
			}),
		).toThrow(/tailnet/);
	});

	it("accepts a hidden plain identity filename", () => {
		expect(
			lookupHost("worker", {
				manifest: fleet({
					...host,
					transport: "openssh",
					identityFile: ".id_key",
				}),
			})?.identityFile,
		).toBe(".id_key");
	});
});
