import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	DEFAULT_CHROMIUM_PROFILES,
	configureChromiumProfiles,
} from "../src/helpers/configure_chromium_profiles.js";

describe("configureChromiumProfiles", () => {
	let home;
	let configFile;

	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-profiles-"));
		configFile = path.join(home, ".haoshoku.json");
	});

	afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

	// Mutation caught: replacing the whole config instead of merging drops
	// unrelated user settings when the browser registry is first introduced.
	it("seeds the default registry while preserving unrelated configuration", () => {
		fs.writeFileSync(
			configFile,
			JSON.stringify({ theme: "ocean", monitorLayout: { primary: "DP-1" } }),
		);

		const result = configureChromiumProfiles({ home });
		const configured = JSON.parse(fs.readFileSync(configFile, "utf8"));

		expect(result).toEqual({ changed: true, skipped: false });
		expect(configured).toEqual({
			theme: "ocean",
			monitorLayout: { primary: "DP-1" },
			chromiumProfiles: DEFAULT_CHROMIUM_PROFILES,
		});
	});

	// Mutation caught: replacing a valid custom registry loses future browser
	// profiles and silently changes the user's selected default browser profile.
	it("preserves a non-empty valid custom registry verbatim", () => {
		const customConfig = `{
  "chromiumProfiles": [
    {"id":"markets","class":"chromium-markets","monitor":"DP-2","default":true}
  ],
  "theme": "ocean"
}\n`;
		fs.writeFileSync(configFile, customConfig);

		const result = configureChromiumProfiles({ home });

		expect(result).toEqual({ changed: false, skipped: false });
		expect(fs.readFileSync(configFile, "utf8")).toBe(customConfig);
	});

	// Mutation caught: retaining a malformed profile list would make shell
	// launchers interpret untrusted values instead of using the shipped registry.
	it("replaces an invalid registry without dropping unrelated configuration", () => {
		fs.writeFileSync(
			configFile,
			JSON.stringify({
				theme: "ocean",
				chromiumProfiles: [
					{
						id: "markets;unsafe",
						class: "chromium-markets",
						monitor: "DP-2",
						default: true,
					},
				],
			}),
		);

		const result = configureChromiumProfiles({ home });
		const configured = JSON.parse(fs.readFileSync(configFile, "utf8"));

		expect(result).toEqual({ changed: true, skipped: false });
		expect(configured.theme).toBe("ocean");
		expect(configured.chromiumProfiles).toEqual(DEFAULT_CHROMIUM_PROFILES);
	});

	// Mutation caught: parsing malformed configuration as code or overwriting it
	// would destroy user data instead of leaving runtime fallback to handle it.
	it("leaves malformed JSON untouched", () => {
		const malformed = '{"theme":"ocean",';
		fs.writeFileSync(configFile, malformed);

		const result = configureChromiumProfiles({ home });

		expect(result).toEqual({ changed: false, skipped: true });
		expect(fs.readFileSync(configFile, "utf8")).toBe(malformed);
	});

	it("is idempotent after seeding the default registry", () => {
		const first = configureChromiumProfiles({ home });
		const afterFirst = fs.readFileSync(configFile, "utf8");
		const second = configureChromiumProfiles({ home });

		expect(first).toEqual({ changed: true, skipped: false });
		expect(second).toEqual({ changed: false, skipped: false });
		expect(fs.readFileSync(configFile, "utf8")).toBe(afterFirst);
	});
});
