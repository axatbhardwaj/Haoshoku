import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { configureT3CodeServer } from "../../src/helpers/configure_t3_code_server.js";
import { fixture } from "./fixture.js";

describe("Debian T3 drop-in idempotency", () => {
	it("writes each root drop-in once, repairs changed PATH, and leaves the generated unit alone", async () => {
		const f = fixture();
		f.options.uid = 0;
		const writes = [];
		f.options.fsImpl = {
			...f.options.fsImpl,
			writeFileSync: (file, value) => {
				writes.push(path.basename(file));
				fs.writeFileSync(file, value);
			},
		};
		expect(await configureT3CodeServer(f.options)).toBe(true);
		expect(writes.sort()).toEqual([
			"axstack-loopback.conf",
			"axstack-path.conf",
			"axstack-sandbox.conf",
			"axstack-tailscale.conf",
			"browser-sandbox.conf",
		]);
		writes.length = 0;
		expect(await configureT3CodeServer(f.options)).toBe(true);
		expect(writes).toEqual([]);
		fs.writeFileSync(path.join(f.dropIns, "axstack-path.conf"), "stale");
		expect(await configureT3CodeServer(f.options)).toBe(true);
		expect(writes).toEqual(["axstack-path.conf"]);
		expect(
			fs.readFileSync(path.join(f.dropIns, "axstack-path.conf"), "utf8"),
		).toBe(
			'[Service]\nEnvironment="PATH=%h/.local/bin:%h/.bun/bin:%h/.grok/bin:/usr/local/bin:/usr/bin:/bin"\n',
		);
	});
});

describe("Debian T3 loopback reconciliation", () => {
	it("persists loopback before installing a fresh service", async () => {
		const f = fixture();
		const file = path.join(f.dropIns, "axstack-loopback.conf");
		const run = f.options.runCommandImpl;
		f.options.runCommandImpl = async (command) => {
			if (command.includes(" service install"))
				expect(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null).toBe(
					'[Service]\nEnvironment="T3CODE_HOST=127.0.0.1"\n',
				);
			return run(command);
		};
		expect(await configureT3CodeServer(f.options)).toBe(true);
	});

	it.each([
		null,
		"stale",
	])("repairs %s binding with reload/restart and leaves a rerun unchanged", async (value) => {
		const f = fixture();
		expect(await configureT3CodeServer(f.options)).toBe(true);
		const base = path.join(f.home, ".t3");
		const unit = path.join(f.dropIns, "../t3code.service");
		const unitContent = `[Service]\nEnvironment=T3CODE_HOME=${base}\n`;
		fs.writeFileSync(unit, unitContent);
		fs.mkdirSync(path.join(base, "runtime"), { recursive: true });
		fs.writeFileSync(
			path.join(base, "runtime/service-state.json"),
			'{"protocol":3,"activeVersion":"0.1.0"}',
		);
		f.overrides.set(
			"systemctl --user show t3code.service --property=LoadState,Environment,ExecStart,EnvironmentFiles",
			f.response(`LoadState=loaded\nEnvironment=T3CODE_HOME=${base}\n`),
		);
		const file = path.join(f.dropIns, "axstack-loopback.conf");
		if (value === null) {
			if (fs.existsSync(file)) fs.unlinkSync(file);
		} else fs.writeFileSync(file, value);
		const run = f.options.runCommandImpl;
		f.options.runCommandImpl = async (command) => {
			if (command.includes(" service restart"))
				expect(fs.readFileSync(file, "utf8")).toBe(
					'[Service]\nEnvironment="T3CODE_HOST=127.0.0.1"\n',
				);
			return run(command);
		};
		f.events.length = 0;
		expect(await configureT3CodeServer(f.options)).toBe(true);
		const changes = () =>
			f.events.filter(
				(command) =>
					command === "systemctl --user daemon-reload" ||
					/ service (install|restart)/.test(command),
			);
		expect(changes()).toEqual([
			"systemctl --user daemon-reload",
			`t3 service restart --base-dir '${base}'`,
		]);
		expect(fs.readFileSync(unit, "utf8")).toBe(unitContent);
		f.events.length = 0;
		expect(await configureT3CodeServer(f.options)).toBe(true);
		expect(changes()).toEqual([]);
	});
});
