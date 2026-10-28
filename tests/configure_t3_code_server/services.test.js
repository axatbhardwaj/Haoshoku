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
