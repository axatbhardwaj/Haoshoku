import { describe, expect, it } from "bun:test";
import { configureTailscaleT3 } from "../src/helpers/configure_tailscale_t3.js";

const dropIn =
	"/home/test/.config/systemd/user/t3code.service.d/axstack-tailscale.conf";
const content = '[Service]\nEnvironment="T3CODE_TAILSCALE_SERVE=true"\n';
const pathDropIn =
	"/home/test/.config/systemd/user/t3code.service.d/axstack-path.conf";
const pathContent =
	'[Service]\nEnvironment="PATH=%h/.local/bin:%h/.bun/bin:%h/.local/share/mise/shims:/usr/local/bin:/usr/bin:/bin"\n';
const url = "https://laptop.tail123.ts.net";
const serve = {
	TCP: { 443: { HTTPS: true } },
	Web: {
		"laptop.tail123.ts.net:443": {
			Handlers: { "/": { Proxy: "http://127.0.0.1:3773" } },
		},
	},
};

function fixture({ fresh = false, loggedOut = fresh } = {}) {
	let serviceActive = !fresh;
	const events = [];
	const warnings = [];
	const messages = [];
	const files = new Map(
		fresh
			? []
			: [
					[dropIn, content],
					[pathDropIn, pathContent],
					["/home/test/.config/systemd/user/t3code.service", "installed"],
				],
	);
	const mutations = [];
	const overrides = new Map();
	const options = {
		home: "/home/test",
		user: "test",
		env: {},
		fsImpl: {
			readFileSync: (file) => {
				if (!files.has(file))
					throw Object.assign(new Error("missing"), { code: "ENOENT" });
				return files.get(file);
			},
			mkdirSync: (file) => mutations.push(`mkdir ${file}`),
			writeFileSync: (file, value) => {
				mutations.push(`write ${file}`);
				files.set(file, value);
			},
		},
		captureCommandImpl: async (command) => {
			events.push(command);
			if (overrides.has(command)) return overrides.get(command);
			let stdout = "";
			let exitCode = 0;
			if (command === "pacman -Q tailscale") exitCode = fresh ? 1 : 0;
			else if (command.includes("--user is-active"))
				exitCode = serviceActive ? 0 : 1;
			else if (command.includes("is-enabled") || command.includes("is-active"))
				exitCode = fresh ? 1 : 0;
			else if (command === "tailscale status --json")
				stdout = JSON.stringify({
					BackendState: loggedOut ? "NeedsLogin" : "Running",
				});
			else if (command === "tailscale debug prefs")
				stdout = JSON.stringify({ OperatorUser: fresh ? "" : "test" });
			else if (command === "t3 --version")
				stdout = "t3 v0.0.46-nightly.20261004.2644";
			else if (command === "tailscale serve status --json")
				stdout = JSON.stringify(serve);
			else throw new Error(`Unexpected probe: ${command}`);
			return { stdout, exitCode };
		},
		runCommandImpl: async (command, init) => {
			events.push(command);
			mutations.push(command);
			if (command.startsWith("t3 service install")) serviceActive = true;
			if (command === "sudo -n tailscale up") {
				expect(init).toMatchObject({ stdout: "inherit", stderr: "inherit" });
				loggedOut = false;
			}
			return true;
		},
		fetchImpl: async (target, init) => {
			events.push(target);
			expect(init.redirect).toBe("error");
			return new Response("ready");
		},
		sleepImpl: async () => {},
		maxReadinessAttempts: 1,
		logger: {
			warning: (message) => warnings.push(message),
			info: (message) => messages.push(message),
			success: (message) => messages.push(message),
		},
	};
	return { options, events, mutations, warnings, messages, files, overrides };
}

describe("Arch T3 over Tailscale", () => {
	it("installs and enables a fresh laptop in order, then prints HTTPS and pairing", async () => {
		const f = fixture({ fresh: true });
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations.filter((event) => !event.startsWith("mkdir"))).toEqual([
			"sudo -n pacman -S --needed --noconfirm tailscale",
			"sudo -n systemctl enable --now tailscaled.service",
			"sudo -n tailscale up",
			"sudo -n tailscale set --operator='test'",
			`write ${dropIn}`,
			`write ${pathDropIn}`,
			"t3 service install --base-dir '/home/test/.t3'",
		]);
		expect(f.files.get(dropIn)).toBe(content);
		expect(f.files.get(pathDropIn)).toBe(pathContent);
		expect(f.events.at(-1)).toBe(url);
		expect(f.messages.join(" ")).toContain(url);
		expect(f.messages.join(" ")).toContain("t3 pair --tailscale");
	});

	it("leaves a configured machine unchanged, without login or file writes", async () => {
		const f = fixture();
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations).toEqual([]);
		expect(f.messages.join(" ")).toContain(url);
	});

	it("announces browser login and waits only when logged out", async () => {
		const f = fixture({ loggedOut: true });
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations).toEqual(["sudo -n tailscale up"]);
		expect(f.messages.join(" ")).toContain("login URL");
		expect(f.messages.join(" ")).toContain("waiting");
		expect(
			f.events.filter((event) => event === "tailscale status --json"),
		).toHaveLength(2);
	});

	it("reloads and restarts an existing service only when the drop-in changes", async () => {
		const f = fixture();
		f.files.set(dropIn, "old");
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations.filter((event) => !event.startsWith("mkdir"))).toEqual([
			`write ${dropIn}`,
			"systemctl --user daemon-reload",
			"t3 service restart",
		]);
	});

	it("warns and returns on a command failure or exception", async () => {
		for (const throws of [false, true]) {
			const f = fixture({ fresh: true });
			f.options.runCommandImpl = async () => {
				if (throws) throw new Error("denied");
				return false;
			};
			expect(await configureTailscaleT3(f.options)).toBe(false);
			expect(f.warnings.join(" ")).toContain("continuing");
			expect(f.warnings.join(" ")).toContain("--tailscale-t3");
			expect(f.files.has(dropIn)).toBe(false);
		}
	});

	it.each([
		"NoState",
		"Stopped",
		"unknown",
	])("does not request login for unverified backend state %s", async (BackendState) => {
		const f = fixture();
		f.overrides.set("tailscale status --json", {
			stdout: JSON.stringify({ BackendState }),
			exitCode: 0,
		});
		expect(await configureTailscaleT3(f.options)).toBe(false);
		expect(f.mutations).toEqual([]);
		expect(f.warnings.join(" ")).toContain("Tailscale");
	});

	it("warns if HTTPS is unavailable without claiming pairing readiness", async () => {
		const f = fixture();
		f.options.fetchImpl = async () => new Response("starting", { status: 503 });
		expect(await configureTailscaleT3(f.options)).toBe(false);
		expect(f.warnings.join(" ")).toContain("HTTPS");
		expect(f.messages.join(" ")).not.toContain("pair --tailscale");
	});
});

describe("T3 exposure and service guards", () => {
	it("does not claim readiness when a newly installed service is inactive", async () => {
		const f = fixture({ fresh: true });
		f.overrides.set("systemctl --user is-active --quiet t3code.service", {
			stdout: "",
			exitCode: 1,
		});
		expect(await configureTailscaleT3(f.options)).toBe(false);
		expect(f.events).not.toContain(url);
		expect(f.warnings.join(" ")).toContain("service");
	});

	it("does not report a public Funnel endpoint as tailnet-only access", async () => {
		const f = fixture();
		f.overrides.set("tailscale serve status --json", {
			stdout: JSON.stringify({
				...serve,
				AllowFunnel: { "laptop.tail123.ts.net:443": true },
			}),
			exitCode: 0,
		});
		expect(await configureTailscaleT3(f.options)).toBe(false);
		expect(f.events).not.toContain(url);
		expect(f.warnings.join(" ")).toContain("tailnet");
	});
});

describe("existing T3 service reconciliation", () => {
	it("enables a disabled but running service and restarts it when the drop-in changed", async () => {
		const f = fixture();
		f.files.set(dropIn, "old");
		f.overrides.set("systemctl --user is-enabled --quiet t3code.service", {
			stdout: "",
			exitCode: 1,
		});
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations.filter((event) => !event.startsWith("mkdir"))).toEqual([
			`write ${dropIn}`,
			"systemctl --user daemon-reload",
			"systemctl --user enable --now t3code.service",
			"t3 service restart",
		]);
	});
});

describe("Tailscale operator reconciliation", () => {
	it("selects the invoking desktop user under sudo", async () => {
		const f = fixture();
		f.options.user = "root";
		f.options.env = { SUDO_USER: "desktop" };
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations).toContain("sudo -n tailscale set --operator='desktop'");
		expect(f.mutations).not.toContain(
			"sudo -n tailscale set --operator='root'",
		);
	});

	it("warns before replacing an existing different operator", async () => {
		const f = fixture();
		f.overrides.set("tailscale debug prefs", {
			stdout: '{"OperatorUser":"previous"}',
			exitCode: 0,
		});
		f.options.runCommandImpl = async (command) => {
			expect(f.warnings.join(" ")).toContain("previous");
			expect(f.warnings.join(" ")).toContain("test");
			f.mutations.push(command);
			return true;
		};
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations).toContain("sudo -n tailscale set --operator='test'");
	});

	it("reports operator command failures without readiness success", async () => {
		for (const throws of [false, true]) {
			const f = fixture();
			f.overrides.set("tailscale debug prefs", {
				stdout: '{"OperatorUser":""}',
				exitCode: 0,
			});
			f.options.runCommandImpl = async () => {
				if (throws) throw new Error("operator denied");
				return false;
			};
			expect(await configureTailscaleT3(f.options)).toBe(false);
			expect(f.warnings.join(" ")).toContain("operator");
			expect(f.warnings).toHaveLength(1);
			expect(f.warnings[0]).toContain("haoshoku --tailscale-t3");
			expect(f.messages.join(" ")).not.toContain("are ready");
		}
	});
});

describe("Arch Tailscale operator remediation", () => {
	it("names the invoking user's exact manual command on failure", async () => {
		const f = fixture();
		f.options.user = "root";
		f.options.env = { SUDO_USER: "desktop" };
		f.overrides.set("tailscale debug prefs", {
			stdout: '{"OperatorUser":""}',
			exitCode: 0,
		});
		f.options.runCommandImpl = async () => false;
		expect(await configureTailscaleT3(f.options)).toBe(false);
		expect(f.warnings.join(" ")).toContain(
			"sudo tailscale set --operator='desktop'",
		);
		expect(f.messages.join(" ")).not.toContain("are ready");
	});
});

describe("Arch T3 agent PATH drop-in", () => {
	it.each([
		null,
		"stale",
	])("reconciles missing or stale PATH content %s and restarts", async (value) => {
		const f = fixture();
		if (value === null) f.files.delete(pathDropIn);
		else f.files.set(pathDropIn, value);
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.files.get(pathDropIn)).toBe(pathContent);
		expect(f.mutations.filter((event) => !event.startsWith("mkdir"))).toEqual([
			`write ${pathDropIn}`,
			"systemctl --user daemon-reload",
			"t3 service restart",
		]);
		f.mutations.length = 0;
		expect(await configureTailscaleT3(f.options)).toBe(true);
		expect(f.mutations).toEqual([]);
	});
});
