import { describe, expect, it } from "bun:test";
import {
	buildExecutorComposeFile,
	executorBaseUrlFromTailnetName,
	parseTailnetDnsName,
	tailscaleServeCommand,
} from "../src/helpers/configure_executor.js";

// Real `tailscale status --json` shape, trimmed to the fields we read. Self is
// the local node; DNSName is the MagicDNS name and arrives FQDN-style with a
// trailing dot, which is exactly the detail that breaks a naive concatenation.
const statusJson = JSON.stringify({
	Self: {
		DNSName: "vps.tail1a2b3c.ts.net.",
		Online: true,
		TailscaleIPs: ["100.101.102.103", "fd7a::1"],
	},
});

describe("MagicDNS name extraction", () => {
	it("strips the trailing dot from Self.DNSName", () => {
		expect(parseTailnetDnsName(statusJson)).toBe("vps.tail1a2b3c.ts.net");
	});

	it("returns null for malformed, empty, or non-Tailscale output", () => {
		for (const output of [
			null,
			"",
			"not json",
			"[]",
			JSON.stringify({}),
			JSON.stringify({ Self: {} }),
			JSON.stringify({ Self: { DNSName: "" } }),
			JSON.stringify({ Self: { DNSName: "." } }),
		]) {
			expect(parseTailnetDnsName(output)).toBeNull();
		}
	});
});

describe("EXECUTOR_WEB_BASE_URL derivation", () => {
	// Better Auth rejects any request whose Origin != webBaseUrl, so this value
	// has to match what the browser actually loads: https, no port, no slash.
	it("builds an https origin with no port and no trailing slash", () => {
		expect(executorBaseUrlFromTailnetName("vps.tail1a2b3c.ts.net")).toBe(
			"https://vps.tail1a2b3c.ts.net",
		);
	});

	it("tolerates a trailing dot or stray whitespace from the caller", () => {
		expect(executorBaseUrlFromTailnetName("  vps.tail1a2b3c.ts.net.  ")).toBe(
			"https://vps.tail1a2b3c.ts.net",
		);
	});

	it("refuses a name that is missing, empty, or already a URL", () => {
		for (const name of [null, "", "   ", "https://vps.ts.net", "http://x"]) {
			expect(() => executorBaseUrlFromTailnetName(name)).toThrow();
		}
	});
});

describe("compose rendering", () => {
	const compose = buildExecutorComposeFile({
		baseUrl: "https://vps.tail1a2b3c.ts.net",
		dataDir: "/srv/executor",
	});

	// The security boundary of the whole feature: Tailscale serve only proxies
	// http://127.0.0.1, and anything else would put Gmail/Notion tokens on a
	// publicly reachable port.
	it("publishes the port on loopback only", () => {
		expect(compose).toContain("127.0.0.1:4788:4788");
		expect(compose).not.toContain("0.0.0.0");
		expect(compose).not.toMatch(/^\s+- "?4788:4788/m);
	});

	it("mounts the host data directory at /data", () => {
		expect(compose).toContain("/srv/executor:/data");
	});

	it("carries the derived base URL", () => {
		expect(compose).toContain(
			"EXECUTOR_WEB_BASE_URL=https://vps.tail1a2b3c.ts.net",
		);
	});

	it("pins the published self-host image", () => {
		expect(compose).toContain("ghcr.io/rhyssullivan/executor-selfhost");
	});

	it("refuses to render without a base URL or data directory", () => {
		expect(() =>
			buildExecutorComposeFile({ dataDir: "/srv/executor" }),
		).toThrow();
		expect(() =>
			buildExecutorComposeFile({ baseUrl: "https://vps.ts.net" }),
		).toThrow();
	});
});

describe("tailscale serve command", () => {
	it("terminates TLS on 443 and proxies loopback", () => {
		expect(tailscaleServeCommand(4788)).toBe(
			"sudo tailscale serve --bg --https=443 http://127.0.0.1:4788",
		);
	});

	it("rejects a non-numeric or out-of-range port", () => {
		for (const port of [null, 0, -1, 70000, "4788"]) {
			expect(() => tailscaleServeCommand(port)).toThrow();
		}
	});
});
