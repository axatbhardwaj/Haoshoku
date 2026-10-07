import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCommandCapture } from "../src/common/utils.js";
import { configureT3CodeServer } from "../src/helpers/configure_t3_code_server.js";
import { configureTailscaleT3 } from "../src/helpers/configure_tailscale_t3.js";

const homes = [];
const serviceShow =
	"systemctl --user show t3code.service --property=LoadState,Environment,ExecStart,EnvironmentFiles";
const scope = "app-com.t3tools.T3Code-3550208.scope";
const scopeShow = `systemctl --user show '${scope}' --property=Environment,ExecStart,EnvironmentFiles`;
// Recorded systemd 261 formats: empty EnvironmentFiles is omitted; an absent
// service omits ExecStart too, and a transient scope has no selected properties.
function loadedService(base, environment = `T3CODE_HOME=${base}`) {
	return `LoadState=loaded\nExecStart={ path=${base}/runtime/versions/1/t3 ; argv[]=${base}/runtime/versions/1/t3 __service-launcher ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }\nEnvironment=${environment}\n`;
}
function runningDesktopScope(f, base = f.base) {
	f.overrides.set("systemctl --user list-units --all --no-legend --no-pager", {
		exitCode: 0,
		stdout: `  ${scope} loaded active running ${scope}\n  t3code.service loaded active running T3 Code server\n`,
	});
	f.overrides.set("systemctl --user list-unit-files --no-legend --no-pager", {
		exitCode: 0,
		stdout: `${scope} transient -\nt3code.service enabled enabled\n`,
	});
	f.overrides.set(scopeShow, { exitCode: 0, stdout: "" });
	f.overrides.set("ps -eo pid=,comm=,args=", {
		exitCode: 0,
		stdout: "42 t3code /usr/lib/t3code-nightly/t3code\n",
	});
	f.overrides.set(
		"/proc/42/environ",
		`PATH=/usr/bin\0HOME=${f.home}\0${base === f.base ? "" : `T3CODE_HOME=${base}\0`}`,
	);
}
afterEach(() => {
	for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true });
});

// Public entrypoints, real disposable files, and explicit external responses.
// No guard function is mocked: commands and writes are recorded at the edges.
function fixture(entrypoint) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "t3-guard-"));
	homes.push(home);
	const base = path.join(home, ".t3");
	const settings = path.join(base, "userdata/desktop-settings.json");
	const token = path.join(base, "userdata/pairing-token");
	const unit = path.join(home, ".config/systemd/user/t3code.service");
	const effects = [];
	const reads = [];
	const messages = [];
	const probes = [];
	const overrides = new Map();
	const write = (file, value) => {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, value);
	};
	write(token, "fixture-pairing-secret");
	const options = {
		home,
		uid: 1000,
		user: "fixture",
		env: {},
		fsImpl: {
			...fs,
			readdirSync(directory, ...args) {
				if (directory === "/usr/share/applications") return [];
				return fs.readdirSync(directory, ...args);
			},
			readFileSync(file, ...args) {
				reads.push(file);
				if (overrides.has(file)) {
					const value = overrides.get(file);
					if (typeof value === "string") return value;
					throw value;
				}
				if (file.startsWith("/proc/"))
					throw Object.assign(new Error("absent fixture process"), {
						code: "ENOENT",
					});
				return fs.readFileSync(file, ...args);
			},
			statSync(file, ...args) {
				if (file.startsWith("/usr/") || file.startsWith("/opt/")) {
					if (overrides.get(file)) return { isFile: () => true };
					throw Object.assign(new Error("absent fixture"), { code: "ENOENT" });
				}
				return fs.statSync(file, ...args);
			},
			writeFileSync(file, ...args) {
				effects.push(`write ${file}`);
				return fs.writeFileSync(file, ...args);
			},
			mkdirSync(file, ...args) {
				effects.push(`mkdir ${file}`);
				return fs.mkdirSync(file, ...args);
			},
			unlinkSync(file) {
				effects.push(`unlink ${file}`);
				return fs.unlinkSync(file);
			},
		},
		ensureNodeImpl: async () => true,
		captureCommandImpl: async (command) => {
			probes.push(command);
			if (overrides.has(command)) {
				const value = overrides.get(command);
				if (value instanceof Error) throw value;
				return value;
			}
			let stdout = "";
			let exitCode = 0;
			if (
				command.startsWith("systemctl --user show ") &&
				!command.includes("show t3code.service")
			)
				stdout =
					"Environment=\nExecStart={ path=/usr/bin/t3code ; argv[]=/usr/bin/t3code ; }\n";
			else if (command.startsWith("systemctl --user show "))
				stdout = "LoadState=not-found\nEnvironment=\n";
			else if (command.startsWith("systemctl --user list-")) stdout = "";
			else if (command === "ps -eo pid=,comm=,args=") stdout = "";
			else if (command === "command -v t3code t3code-nightly") exitCode = 1;
			else if (command === "command -v t3") stdout = "/usr/bin/t3";
			else if (command.includes("--version"))
				stdout = "t3 v0.0.46-nightly.20261004.2644";
			else if (command === "pacman -Q t3code-bin") exitCode = 1;
			else if (command === "pacman -Q t3code-nightly-bin") exitCode = 1;
			else if (command === "pacman -Q tailscale") stdout = "tailscale 1.0";
			else if (command.includes("is-enabled") || command.includes("is-active"))
				stdout = "";
			else if (command === "tailscale status") stdout = "Running";
			else if (command === "tailscale status --json")
				stdout = '{"BackendState":"Running"}';
			else if (command === "tailscale debug prefs")
				stdout = '{"OperatorUser":"fixture"}';
			else if (command.includes("connect status --json"))
				stdout = '{"desired":false}';
			else if (command === "tailscale serve status --json")
				stdout = JSON.stringify({
					TCP: { 443: { HTTPS: true } },
					Web: {
						"fixture.tail123.ts.net:443": {
							Handlers: { "/": { Proxy: "http://127.0.0.1:3773" } },
						},
					},
				});
			else if (command === "ss -Hltn 'sport = :3773'")
				stdout = "LISTEN 0 128 127.0.0.1:3773 *:*";
			else throw new Error(`Unexpected fixture probe: ${command}`);
			return { stdout, exitCode };
		},
		runCommandImpl: async (command) => {
			effects.push(command);
			return true;
		},
		fetchImpl: async () => new Response("fixture ready"),
		sleepImpl: async () => {},
		maxReadinessAttempts: 1,
		logger: Object.fromEntries(
			["error", "warning", "info", "success"].map((key) => [
				key,
				(message) => messages.push(message),
			]),
		),
	};
	return {
		home,
		base,
		settings,
		token,
		unit,
		effects,
		reads,
		messages,
		probes,
		overrides,
		options,
		write,
		run: () => entrypoint(options),
	};
}

for (const [name, entrypoint] of [
	["Arch --tailscale-t3", configureTailscaleT3],
	["Debian --server-t3-code", configureT3CodeServer],
]) {
	describe(`${name} desktop preflight`, () => {
		it("permits loaded disabled service setup and rerun with omitted optional properties", async () => {
			const f = fixture(entrypoint);
			const value = '{"localEnvironmentEnabled":false}';
			f.write(f.settings, value);
			f.write(f.unit, `[Service]\nEnvironment=T3CODE_HOME=${f.base}\n`);
			f.overrides.set(serviceShow, {
				exitCode: 0,
				stdout: loadedService(f.base),
			});
			for (let invocation = 0; invocation < 2; invocation++) {
				f.effects.length = 0;
				expect(await f.run(), JSON.stringify(f.messages)).toBe(true);
				if (invocation === 0)
					expect(
						f.effects.some((effect) =>
							/service (install|restart)/.test(effect),
						),
					).toBe(true);
				else if (name.startsWith("Arch")) expect(f.effects).toEqual([]);
				expect(fs.readFileSync(f.settings, "utf8")).toBe(value);
				expect(fs.readFileSync(f.token, "utf8")).toBe("fixture-pairing-secret");
				expect(f.reads).not.toContain(f.token);
				expect(f.messages.join(" ")).not.toContain("fixture-pairing-secret");
			}
			expect(
				f.probes.filter((command) => command === serviceShow),
			).toHaveLength(2);
		});

		it.each([
			"default",
			"custom",
		])("permits a running desktop scope with disabled %s settings", async (directory) => {
			const f = fixture(entrypoint);
			const base =
				directory === "custom" ? path.join(f.home, "custom-t3") : f.base;
			if (directory === "custom") f.options.env.T3CODE_HOME = base;
			const settings = path.join(base, "userdata/desktop-settings.json");
			const value = '{"localEnvironmentEnabled":false}';
			f.write(settings, value);
			f.overrides.set(serviceShow, {
				exitCode: 0,
				stdout: loadedService(base),
			});
			runningDesktopScope(f, base);
			expect(await f.run(), JSON.stringify(f.messages)).toBe(true);
			expect(
				f.effects.some((effect) => effect.includes("service install")),
			).toBe(true);
			expect(f.probes).toContain(scopeShow);
			expect(f.reads).toContain("/proc/42/environ");
			expect(fs.readFileSync(settings, "utf8")).toBe(value);
			expect(fs.readFileSync(f.token, "utf8")).toBe("fixture-pairing-secret");
			expect(f.reads).not.toContain(f.token);
			expect(f.messages.join(" ")).not.toContain("fixture-pairing-secret");
		});

		it("refuses missing settings when an empty transient scope signals desktop presence", async () => {
			const f = fixture(entrypoint);
			runningDesktopScope(f);
			f.overrides.set("ps -eo pid=,comm=,args=", { exitCode: 0, stdout: "" });
			expect(await f.run()).toBe(false);
			expect(f.effects).toEqual([]);
			expect(fs.existsSync(f.settings)).toBe(false);
			expect(f.probes).toContain(scopeShow);
			expect(f.reads).toContain(f.settings);
			expect(f.reads).not.toContain(f.token);
		});

		it.each([
			["failed probe", { exitCode: 1, stdout: "" }],
			["malformed output", { exitCode: 0, stdout: "not a property" }],
			[
				"environment file",
				{ exitCode: 0, stdout: "EnvironmentFiles=/tmp/desktop.env" },
			],
			[
				"directory override",
				{
					exitCode: 0,
					stdout: "ExecStart={ argv[]=t3code --base-dir /other ; }",
				},
			],
			[
				"duplicate environment",
				{ exitCode: 0, stdout: "Environment=\nEnvironment=T3CODE_HOME=/other" },
			],
		])("refuses %s for a desktop scope before mutation", async (_kind, result) => {
			const f = fixture(entrypoint);
			f.write(f.settings, '{"localEnvironmentEnabled":false}');
			runningDesktopScope(f);
			f.overrides.set(scopeShow, result);
			expect(await f.run()).toBe(false);
			expect(f.effects).toEqual([]);
			expect(f.probes).toContain(scopeShow);
		});

		it.each([
			"",
			"Environment=",
			"LoadState=failed",
			"LoadState=not-found\nbroken property",
			"LoadState=not-found\nLoadState=not-found\nEnvironment=\nExecStart=\nEnvironmentFiles=",
			"LoadState=not-found\nEnvironment=T3CODE_HOME=/other",
			"LoadState=not-found\nExecStart={ argv[]=t3 __service-launcher ; }",
		])("refuses invalid required service state or ambiguous output: %s", async (stdout) => {
			const f = fixture(entrypoint);
			f.write(f.settings, '{"localEnvironmentEnabled":false}');
			f.overrides.set(serviceShow, { exitCode: 0, stdout });
			expect(await f.run()).toBe(false);
			expect(f.effects).toEqual([]);
		});
		it.each([
			["enabled", '{"localEnvironmentEnabled":true}'],
			["default enabled", "{}"],
			["malformed", "{fixture-pairing-secret"],
			["wrong type", '{"localEnvironmentEnabled":"false"}'],
			["null document", "null"],
			["array document", "[]"],
		])("refuses %s before service commands or writes", async (_name, value) => {
			const f = fixture(entrypoint);
			f.write(f.settings, value);
			expect(await f.run(), JSON.stringify(f.effects)).toBe(false);
			expect(f.effects).toEqual([]);
			expect(fs.readFileSync(f.settings, "utf8")).toBe(value);
			expect(f.reads).not.toContain(f.token);
			expect(fs.readFileSync(f.token, "utf8")).toBe("fixture-pairing-secret");
			expect(f.messages.join(" ")).toContain("disable Local environment");
			expect(f.messages.join(" ")).toContain(
				"pair the desktop to the existing service",
			);
			expect(f.messages.join(" ")).not.toContain("fixture-pairing-secret");
			expect(f.probes.some((command) => /\bpair\b|auth/.test(command))).toBe(
				false,
			);
		});

		it.each([
			"installation",
			"unit",
			"process",
		])("refuses missing settings with desktop %s even without a listener", async (signal) => {
			const f = fixture(entrypoint);
			if (signal === "installation")
				f.overrides.set("command -v t3code t3code-nightly", {
					exitCode: 0,
					stdout: "/usr/bin/t3code-nightly",
				});
			if (signal === "unit")
				f.overrides.set(
					"systemctl --user list-unit-files --no-legend --no-pager",
					{ exitCode: 0, stdout: "t3code-desktop.service disabled" },
				);
			if (signal === "process")
				f.overrides.set("ps -eo pid=,comm=,args=", {
					exitCode: 0,
					stdout: "123 t3code /usr/lib/t3code-nightly/t3code",
				});
			if (signal === "process")
				f.overrides.set("/proc/123/environ", "HOME=fixture\0");
			f.overrides.set("ss -Hltn 'sport = :3773'", { exitCode: 0, stdout: "" });
			expect(await f.run(), JSON.stringify(f.effects)).toBe(false);
			expect(f.effects).toEqual([]);
			expect(fs.existsSync(f.settings)).toBe(false);
		});

		it("refuses unreadable settings without exposing their contents", async () => {
			const f = fixture(entrypoint);
			f.write(f.settings, '{"localEnvironmentEnabled":false}');
			f.overrides.set(
				f.settings,
				Object.assign(new Error("fixture-pairing-secret"), { code: "EACCES" }),
			);
			expect(await f.run(), JSON.stringify(f.effects)).toBe(false);
			expect(f.effects).toEqual([]);
			expect(f.messages.join(" ")).not.toContain("fixture-pairing-secret");
		});

		it.each([
			"systemctl --user show t3code.service --property=LoadState,Environment,ExecStart,EnvironmentFiles",
			"systemctl --user list-unit-files --no-legend --no-pager",
			"systemctl --user list-units --all --no-legend --no-pager",
			"command -v t3code t3code-nightly",
			"ps -eo pid=,comm=,args=",
		])("fails closed on a failed absence probe: %s", async (command) => {
			const f = fixture(entrypoint);
			f.overrides.set(command, {
				exitCode: 127,
				stdout: "",
				stderr: "missing executable",
			});
			expect(await f.run(), JSON.stringify(f.effects)).toBe(false);
			expect(f.effects).toEqual([]);
		});

		it("permits explicit false without rewriting settings or reading tokens", async () => {
			const f = fixture(entrypoint);
			const value = '{"localEnvironmentEnabled":false,"unrelated":42}';
			f.write(f.settings, value);
			f.overrides.set("command -v t3code t3code-nightly", {
				exitCode: 0,
				stdout: "/usr/bin/t3code-nightly",
			});
			expect(await f.run()).toBe(true);
			expect(
				f.effects.some((command) => command.includes("service install")),
			).toBe(true);
			expect(fs.readFileSync(f.settings, "utf8")).toBe(value);
			expect(f.reads).not.toContain(f.token);
			expect(f.messages.join(" ")).not.toContain("fixture-pairing-secret");
		});

		it.each([
			"service conflict",
			"unresolved service",
			"environment file",
			"desktop directory conflict",
		])("refuses ambiguous directory evidence: %s", async (kind) => {
			const f = fixture(entrypoint);
			f.write(f.settings, '{"localEnvironmentEnabled":false}');
			const other = path.join(f.home, "other-t3");
			if (kind === "desktop directory conflict") {
				f.options.env.T3CODE_HOME = other;
				f.write(
					path.join(other, "userdata/desktop-settings.json"),
					'{"localEnvironmentEnabled":false}',
				);
			} else {
				f.overrides.set(
					"systemctl --user show t3code.service --property=LoadState,Environment,ExecStart,EnvironmentFiles",
					{
						exitCode: 0,
						stdout:
							loadedService(
								other,
								kind === "unresolved service" ? "" : `T3CODE_HOME=${other}`,
							) +
							(kind === "environment file"
								? "EnvironmentFiles=/tmp/custom.env\n"
								: ""),
					},
				);
			}
			expect(await f.run(), JSON.stringify(f.effects)).toBe(false);
			expect(f.effects).toEqual([]);
		});

		it("reads disabled settings in a consistent custom service directory and preserves that binding", async () => {
			const f = fixture(entrypoint);
			const other = path.join(f.home, "custom-t3");
			f.options.env.T3CODE_HOME = other;
			f.write(
				path.join(other, "userdata/desktop-settings.json"),
				'{"localEnvironmentEnabled":false}',
			);
			f.write(f.unit, `[Service]\nEnvironment=T3CODE_HOME=${other}\n`);
			f.overrides.set(
				"systemctl --user show t3code.service --property=LoadState,Environment,ExecStart,EnvironmentFiles",
				{
					exitCode: 0,
					stdout: loadedService(other),
				},
			);
			expect(await f.run()).toBe(true);
			expect(f.reads).toContain(
				path.join(other, "userdata/desktop-settings.json"),
			);
			if (name.startsWith("Debian"))
				expect(
					f.effects.some((command) =>
						command.includes(`--base-dir '${other}'`),
					),
				).toBe(true);
		});

		it("refuses a desktop unit using another directory despite disabled default settings", async () => {
			const f = fixture(entrypoint);
			f.write(f.settings, '{"localEnvironmentEnabled":false}');
			f.overrides.set(
				"systemctl --user list-unit-files --no-legend --no-pager",
				{ exitCode: 0, stdout: "t3code-desktop.service enabled" },
			);
			f.overrides.set(
				"systemctl --user show 't3code-desktop.service' --property=Environment,ExecStart,EnvironmentFiles",
				{
					exitCode: 0,
					stdout: `Environment=T3CODE_HOME=${f.home}/other\nExecStart={ path=/usr/bin/t3code ; argv[]=/usr/bin/t3code ; }\n`,
				},
			);
			expect(await f.run(), JSON.stringify(f.effects)).toBe(false);
			expect(f.effects).toEqual([]);
		});

		it("refuses a desktop launcher with a directory override", async () => {
			const f = fixture(entrypoint);
			f.write(f.settings, '{"localEnvironmentEnabled":false}');
			f.write(
				path.join(f.home, ".local/share/applications/t3code.desktop"),
				`[Desktop Entry]\nExec=env T3CODE_HOME=${f.home}/other t3code-nightly\n`,
			);
			expect(await f.run(), JSON.stringify(f.effects)).toBe(false);
			expect(f.effects).toEqual([]);
		});

		it.each([
			"same directory",
			"different directory",
			"unreadable environment",
		])("checks running desktop directory: %s", async (kind) => {
			const f = fixture(entrypoint);
			f.write(f.settings, '{"localEnvironmentEnabled":false}');
			runningDesktopScope(f);
			f.overrides.set("ps -eo pid=,comm=,args=", {
				exitCode: 0,
				stdout: "123 electron /opt/custom/t3code/resources/app.asar",
			});
			const environment = "/proc/123/environ";
			const read = f.options.fsImpl.readFileSync;
			f.options.fsImpl.readFileSync = (file, ...args) => {
				if (file !== environment) return read(file, ...args);
				if (kind === "unreadable environment")
					throw Object.assign(new Error("denied"), { code: "EACCES" });
				return `T3CODE_HOME=${kind === "same directory" ? f.base : `${f.home}/other`}\0`;
			};
			expect(await f.run(), JSON.stringify(f.effects)).toBe(
				kind === "same directory",
			);
			if (kind !== "same directory") expect(f.effects).toEqual([]);
		});

		it("refuses unreadable installation evidence rather than declaring headless", async () => {
			const f = fixture(entrypoint);
			const list = f.options.fsImpl.readdirSync;
			f.options.fsImpl.readdirSync = (directory, ...args) => {
				if (directory.endsWith("applications"))
					throw Object.assign(new Error("denied"), { code: "EACCES" });
				return list(directory, ...args);
			};
			expect(await f.run(), JSON.stringify(f.effects)).toBe(false);
			expect(f.effects).toEqual([]);
		});

		it("refuses settings absence with an installed bundle even when its launcher is off PATH", async () => {
			const f = fixture(entrypoint);
			f.overrides.set("/usr/lib/t3code-nightly/resources/app.asar", true);
			expect(await f.run(), JSON.stringify(f.effects)).toBe(false);
			expect(f.effects).toEqual([]);
		});

		it("accepts a quoted custom service directory with spaces", async () => {
			const f = fixture(entrypoint);
			const other = path.join(f.home, "custom t3");
			f.options.env.T3CODE_HOME = other;
			f.write(
				path.join(other, "userdata/desktop-settings.json"),
				'{"localEnvironmentEnabled":false}',
			);
			f.overrides.set(
				"systemctl --user show t3code.service --property=LoadState,Environment,ExecStart,EnvironmentFiles",
				{
					exitCode: 0,
					stdout: loadedService(other, `"T3CODE_HOME=${other}"`),
				},
			);
			expect(await f.run()).toBe(true);
		});

		it("uses the real shell built-in to establish launcher absence", async () => {
			const f = fixture(entrypoint);
			const capture = f.options.captureCommandImpl;
			const bin = path.join(f.home, "bin");
			fs.mkdirSync(bin);
			fs.symlinkSync("/usr/bin/bash", path.join(bin, "bash"));
			f.options.captureCommandImpl = (command, options) =>
				command === "command -v t3code t3code-nightly"
					? runCommandCapture(command, {
							...options,
							env: { PATH: bin },
							cwd: f.home,
						})
					: capture(command, options);
			expect(await f.run()).toBe(true);
			expect(
				f.effects.some((command) => command.includes("service install")),
			).toBe(true);
		});

		it("does not treat stderr from a failed launcher probe as proven absence", async () => {
			const f = fixture(entrypoint);
			f.overrides.set("command -v t3code t3code-nightly", {
				exitCode: 1,
				stdout: "",
				stderr: "probe could not inspect PATH",
			});
			expect(await f.run(), JSON.stringify(f.effects)).toBe(false);
			expect(f.effects).toEqual([]);
		});

		it("does not expand a shell environment path as a systemd specifier", async () => {
			const f = fixture(entrypoint);
			f.options.env.T3CODE_HOME = "%h/other";
			expect(await f.run(), JSON.stringify(f.effects)).toBe(false);
			expect(f.effects).toEqual([]);
		});

		it("permits fresh not-found genuinely headless setup with omitted properties", async () => {
			const f = fixture(entrypoint);
			expect(await f.run()).toBe(true);
			expect(
				f.effects.some((command) => command.includes("service install")),
			).toBe(true);
			expect(fs.existsSync(f.settings)).toBe(false);
			expect(f.reads).not.toContain(f.token);
			expect(fs.readFileSync(f.token, "utf8")).toBe("fixture-pairing-secret");
			expect(f.messages.join(" ")).not.toContain("fixture-pairing-secret");
		});

		it("checks desktop settings again on an already configured rerun", async () => {
			const f = fixture(entrypoint);
			f.write(f.settings, '{"localEnvironmentEnabled":false}');
			expect(await f.run()).toBe(true);
			f.write(f.unit, `[Service]\nEnvironment=T3CODE_HOME=${f.base}\n`);
			f.overrides.set(serviceShow, {
				exitCode: 0,
				stdout: loadedService(f.base),
			});
			f.write(f.settings, "{}");
			f.effects.length = 0;
			expect(await f.run(), JSON.stringify(f.effects)).toBe(false);
			expect(f.effects).toEqual([]);
		});
	});
}
