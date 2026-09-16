import { describe, expect, it } from "bun:test";
import {
	buildExecutorComposeFile,
	chooseHttpsPort,
	executorBaseUrlFromTailnetName,
	isExecutorReachable,
	parseTailnetDnsName,
	tailscaleServeCommand,
	waitForExecutor,
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

// --- Regression: first real VPS run, 2026-09-16 -----------------------------
// The host already ran nginx on 0.0.0.0:443, which covers the Tailscale IP, so
// `tailscale serve --https=443` silently lost the port and the MagicDNS name
// answered with the wrong certificate. The helper still reported success
// because the serve COMMAND exited 0. Both halves are pinned here.

describe("HTTPS port selection", () => {
	it("prefers 443 when nothing else holds it", () => {
		expect(chooseHttpsPort({ portInUse: () => false })).toBe(443);
	});

	it("falls back to 8443 when 443 is already bound", () => {
		expect(chooseHttpsPort({ portInUse: (port) => port === 443 })).toBe(8443);
	});

	it("throws when neither port is available rather than guessing", () => {
		expect(() => chooseHttpsPort({ portInUse: () => true })).toThrow();
	});
});

describe("base URL carries a non-default HTTPS port", () => {
	it("omits the port for 443", () => {
		expect(executorBaseUrlFromTailnetName("vps.ts.net", 443)).toBe(
			"https://vps.ts.net",
		);
	});

	it("includes the port when serve is not on 443", () => {
		expect(executorBaseUrlFromTailnetName("vps.ts.net", 8443)).toBe(
			"https://vps.ts.net:8443",
		);
	});

	it("still defaults to 443 when no port is given", () => {
		expect(executorBaseUrlFromTailnetName("vps.ts.net")).toBe(
			"https://vps.ts.net",
		);
	});
});

describe("serve command targets the chosen HTTPS port", () => {
	it("uses the selected port, not a hardcoded 443", () => {
		expect(tailscaleServeCommand(4788, 8443)).toBe(
			"sudo tailscale serve --bg --https=8443 http://127.0.0.1:4788",
		);
	});
});

describe("reachability verification", () => {
	// The bug was reporting success on a command exit code. Success now requires
	// the endpoint to actually answer.
	it("accepts a 2xx or 4xx answer (4xx still proves Executor is serving)", async () => {
		expect(
			await isExecutorReachable("https://vps.ts.net", {
				fetchImpl: async () => ({ status: 200 }),
			}),
		).toBe(true);
		expect(
			await isExecutorReachable("https://vps.ts.net", {
				fetchImpl: async () => ({ status: 401 }),
			}),
		).toBe(true);
	});

	it("reports unreachable when TLS or connection fails", async () => {
		expect(
			await isExecutorReachable("https://vps.ts.net", {
				fetchImpl: async () => {
					throw new Error("unable to verify the first certificate");
				},
			}),
		).toBe(false);
	});

	it("reports unreachable on a 5xx", async () => {
		expect(
			await isExecutorReachable("https://vps.ts.net", {
				fetchImpl: async () => ({ status: 502 }),
			}),
		).toBe(false);
	});
});

describe("waiting for readiness", () => {
	// Third defect from the same VPS run: the probe fired while the container was
	// still `health: starting`, so a working deploy reported failure. Readiness
	// is a poll, not a single shot.
	it("succeeds once a later attempt answers", async () => {
		let calls = 0;
		const ok = await waitForExecutor("https://vps.ts.net", {
			attempts: 5,
			delayMs: 0,
			isReachableImpl: async () => {
				calls += 1;
				return calls >= 3;
			},
		});
		expect(ok).toBe(true);
		expect(calls).toBe(3);
	});

	it("gives up after the attempt budget instead of hanging", async () => {
		let calls = 0;
		const ok = await waitForExecutor("https://vps.ts.net", {
			attempts: 4,
			delayMs: 0,
			isReachableImpl: async () => {
				calls += 1;
				return false;
			},
		});
		expect(ok).toBe(false);
		expect(calls).toBe(4);
	});
});
