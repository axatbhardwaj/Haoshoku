import { describe, expect, it } from "bun:test";

import {
	configureTailscale,
	parseTailscaleStatus,
	tailscaleNeedsLogin,
} from "../src/helpers/configure_tailscale.js";

const RUNNING = JSON.stringify({
	BackendState: "Running",
	Self: { DNSName: "pc.tail1234.ts.net." },
});
const NEEDS_LOGIN = JSON.stringify({ BackendState: "NeedsLogin" });

function harness({
	installed = true,
	statuses = [RUNNING],
	runResult = () => true,
} = {}) {
	const commands = [];
	const messages = { info: [], warning: [], success: [] };
	const queue = [...statuses];
	return {
		commands,
		messages,
		opts: {
			osId: "arch",
			commandExistsImpl: async () => installed,
			run: async (command) => {
				commands.push(command);
				return runResult(command);
			},
			capture: async (command) => {
				commands.push(command);
				const stdout = queue.length > 1 ? queue.shift() : queue[0];
				return { exitCode: 0, stdout, stderr: "", failed: false };
			},
			logImpl: {
				info: (m) => messages.info.push(m),
				warning: (m) => messages.warning.push(m),
				success: (m) => messages.success.push(m),
				dim: () => {},
				error: () => {},
			},
		},
	};
}

describe("parseTailscaleStatus", () => {
	it("extracts backend state and strips the trailing dot from DNSName", () => {
		expect(parseTailscaleStatus(RUNNING)).toEqual({
			backendState: "Running",
			dnsName: "pc.tail1234.ts.net",
		});
	});

	it("returns null for garbage or non-object JSON", () => {
		expect(parseTailscaleStatus("not json")).toBeNull();
		expect(parseTailscaleStatus("[]")).toBeNull();
		expect(parseTailscaleStatus("{}")).toBeNull();
	});
});

describe("tailscaleNeedsLogin", () => {
	it("is false only when Running", () => {
		expect(tailscaleNeedsLogin({ backendState: "Running" })).toBe(false);
		expect(tailscaleNeedsLogin({ backendState: "NeedsLogin" })).toBe(true);
		expect(tailscaleNeedsLogin(null)).toBe(true);
	});
});

describe("configureTailscale", () => {
	it("skips install and login when already joined", async () => {
		const h = harness();
		expect(await configureTailscale(h.opts)).toBe("already-joined");
		expect(h.commands).toEqual([
			"sudo systemctl enable --now tailscaled",
			"tailscale status --json",
		]);
		expect(h.messages.info[0]).toContain("pc.tail1234.ts.net");
	});

	it("installs per OS when the binary is missing", async () => {
		const h = harness({ installed: false });
		await configureTailscale(h.opts);
		expect(h.commands[0]).toBe("sudo pacman -S --needed --noconfirm tailscale");

		const d = harness({ installed: false });
		await configureTailscale({ ...d.opts, osId: "debian-server" });
		expect(d.commands[0]).toContain("tailscale.com/install.sh");
	});

	it("refuses unknown OS ids without running anything", async () => {
		const h = harness({ installed: false });
		expect(await configureTailscale({ ...h.opts, osId: "gentoo" })).toBe(
			"unsupported",
		);
		expect(h.commands).toEqual([]);
	});

	it("runs tailscale up when login is needed and reports joined", async () => {
		const h = harness({ statuses: [NEEDS_LOGIN, RUNNING] });
		expect(await configureTailscale(h.opts)).toBe("joined");
		expect(h.commands).toContain("sudo tailscale up");
		expect(h.messages.success[0]).toContain("pc.tail1234.ts.net");
	});

	it("reports failed when the node is still not Running after up", async () => {
		const h = harness({ statuses: [NEEDS_LOGIN, NEEDS_LOGIN] });
		expect(await configureTailscale(h.opts)).toBe("failed");
		expect(h.messages.warning.at(-1)).toContain("haoshoku --tailscale");
	});

	it("reports failed when install or enable fails", async () => {
		const install = harness({
			installed: false,
			runResult: (c) => !c.includes("pacman"),
		});
		expect(await configureTailscale(install.opts)).toBe("failed");

		const enable = harness({ runResult: (c) => !c.includes("systemctl") });
		expect(await configureTailscale(enable.opts)).toBe("failed");
		expect(enable.commands).not.toContain("tailscale status --json");
	});
});
