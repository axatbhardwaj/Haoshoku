import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { log } from "../src/common/utils.js";
import {
	configureChromiumProfiles,
	DEFAULT_CHROMIUM_PROFILES,
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
	"claudeSessionName": null,
  "theme": "ocean"
}\n`;
		fs.writeFileSync(configFile, customConfig);

		const result = configureChromiumProfiles({ home });

		expect(result).toEqual({ changed: false, skipped: false });
		expect(fs.readFileSync(configFile, "utf8")).toBe(customConfig);
	});

	// Mutation caught: requiring a default profile rewrites a valid custom list
	// even though runtime routing has an explicit Flux fallback for that case.
	it("preserves a non-empty zero-default custom registry verbatim", () => {
		const customConfig = `{
  "chromiumProfiles": [
    {"id":"research","class":"chromium-research","monitor":"DP-2"}
  ],
	"claudeSessionName": null,
  "theme": "ocean"
}\n`;
		fs.writeFileSync(configFile, customConfig);

		const result = configureChromiumProfiles({ home });

		expect(result).toEqual({ changed: false, skipped: false });
		expect(fs.readFileSync(configFile, "utf8")).toBe(customConfig);
	});

	// Mutation caught: allowing multiple defaults makes fallback routing
	// ambiguous instead of restoring the shipped single-default registry.
	it("replaces a registry with multiple default profiles", () => {
		fs.writeFileSync(
			configFile,
			JSON.stringify({
				theme: "ocean",
				chromiumProfiles: [
					{
						id: "flux",
						class: "chromium-flux",
						monitor: "DP-1",
						default: true,
					},
					{
						id: "research",
						class: "chromium-research",
						monitor: "DP-2",
						default: true,
					},
				],
			}),
		);

		const result = configureChromiumProfiles({ home });
		const configured = JSON.parse(fs.readFileSync(configFile, "utf8"));

		expect(result).toEqual({ changed: true, skipped: false });
		expect(configured.chromiumProfiles).toEqual(DEFAULT_CHROMIUM_PROFILES);
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

	it("does not add a redundant session seed and preserves a valid session name", () => {
		const freshFirst = configureChromiumProfiles({ home });
		const freshAfterFirst = fs.readFileSync(configFile, "utf8");
		const freshSecond = configureChromiumProfiles({ home });
		const freshAfterSecond = fs.readFileSync(configFile, "utf8");
		const freshConfig = JSON.parse(freshAfterSecond);

		const customConfig = `${JSON.stringify(
			{
				claudeSessionName: "portable-haki",
				chromiumProfiles: DEFAULT_CHROMIUM_PROFILES,
				theme: "ocean",
			},
			null,
			2,
		)}\n`;
		fs.writeFileSync(configFile, customConfig);
		const customFirst = configureChromiumProfiles({ home });
		const customSecond = configureChromiumProfiles({ home });

		expect({
			fresh: {
				first: freshFirst,
				second: freshSecond,
				hasSessionName: Object.hasOwn(freshConfig, "claudeSessionName"),
				unchangedOnSecondRun: freshAfterSecond === freshAfterFirst,
			},
			custom: {
				first: customFirst,
				second: customSecond,
				contents: fs.readFileSync(configFile, "utf8"),
			},
		}).toEqual({
			fresh: {
				first: { changed: true, skipped: false },
				second: { changed: false, skipped: false },
				hasSessionName: false,
				unchangedOnSecondRun: true,
			},
			custom: {
				first: { changed: false, skipped: false },
				second: { changed: false, skipped: false },
				contents: customConfig,
			},
		});
	});

	// Mutations caught: assigning null changes the bytes/value; omitting either
	// warning detail leaves the user unable to identify the rejected setting.
	it("preserves a rejected session name and logs its key and value", () => {
		const rejectedValue = "team session; keep me";
		const customConfig = `${JSON.stringify(
			{
				chromiumProfiles: DEFAULT_CHROMIUM_PROFILES,
				claudeSessionName: rejectedValue,
				theme: "ocean",
			},
			null,
			2,
		)}\n`;
		fs.writeFileSync(configFile, customConfig);
		const warnings = [];
		const originalWarning = log.warning;
		log.warning = (message) => warnings.push(message);

		let result;
		try {
			result = configureChromiumProfiles({ home });
		} finally {
			log.warning = originalWarning;
		}

		expect({
			result,
			contents: fs.readFileSync(configFile, "utf8"),
			warningNamesKey: warnings.some((message) =>
				message.includes("claudeSessionName"),
			),
			warningNamesValue: warnings.some((message) =>
				message.includes(JSON.stringify(rejectedValue)),
			),
		}).toEqual({
			result: { changed: false, skipped: true },
			contents: customConfig,
			warningNamesKey: true,
			warningNamesValue: true,
		});
	});

	// Mutations caught: continuing after rejection rewrites Infinity as null;
	// JSON.stringify alone also misreports the rejected value as null.
	it("refuses all setup writes when a rejected numeric value cannot round-trip", () => {
		const customConfig = '{"claudeSessionName":1e400,"theme":"ocean"}\n';
		fs.writeFileSync(configFile, customConfig);
		const warnings = [];
		const originalWarning = log.warning;
		log.warning = (message) => warnings.push(message);

		let result;
		try {
			result = configureChromiumProfiles({ home });
		} finally {
			log.warning = originalWarning;
		}

		expect({
			result,
			contents: fs.readFileSync(configFile, "utf8"),
			warningNamesKey: warnings.some((message) =>
				message.includes("claudeSessionName"),
			),
			warningNamesValue: warnings.some((message) =>
				message.includes("Infinity"),
			),
			warningExplainsRefusal: warnings.some(
				(message) =>
					message.includes("Refusing") && message.includes("unchanged"),
			),
		}).toEqual({
			result: { changed: false, skipped: true },
			contents: customConfig,
			warningNamesKey: true,
			warningNamesValue: true,
			warningExplainsRefusal: true,
		});
	});
});
