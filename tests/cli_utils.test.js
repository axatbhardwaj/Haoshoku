import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	detectOS,
	findActiveModeFlags,
	MODE_FLAGS,
} from "../src/common/cli_utils.js";

function registeredModeFlags(source) {
	return [
		...source.matchAll(
			/\.(?:option|addOption\(\s*new\s+Option)\(\s*(["'])([^"']*--[a-z0-9-]+[^"']*)\1/g,
		),
	]
		.map((match) => match[2].match(/--[a-z0-9-]+/)[0])
		.filter((flag) => flag !== "--os")
		.map((flag) =>
			flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()),
		);
}

describe("detectOS", () => {
	let tmpDir;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-os-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	const writeOsRelease = (content) => {
		const p = path.join(tmpDir, "os-release");
		fs.writeFileSync(p, content);
		return p;
	};

	it("detects CachyOS (ID=cachyos) as Arch family", () => {
		const p = writeOsRelease('NAME="CachyOS"\nID=cachyos\nID_LIKE=arch\n');
		expect(detectOS(p)).toBe("arch");
	});

	it("detects vanilla Arch (ID=arch only, no ID_LIKE) as Arch family", () => {
		const p = writeOsRelease('NAME="Arch Linux"\nID=arch\n');
		expect(detectOS(p)).toBe("arch");
	});

	it("detects an Arch derivative (ID_LIKE=arch) as Arch family", () => {
		const p = writeOsRelease(
			'NAME="EndeavourOS"\nID=endeavouros\nID_LIKE=arch\n',
		);
		expect(detectOS(p)).toBe("arch");
	});

	it("detects Debian (ID=debian) as debian-server", () => {
		const p = writeOsRelease('NAME="Debian GNU/Linux"\nID=debian\n');
		expect(detectOS(p)).toBe("debian-server");
	});

	it("detects Ubuntu (ID=ubuntu ID_LIKE=debian) as debian-server", () => {
		const p = writeOsRelease('NAME="Ubuntu"\nID=ubuntu\nID_LIKE=debian\n');
		expect(detectOS(p)).toBe("debian-server");
	});

	it("returns null when the os-release file is missing", () => {
		const p = path.join(tmpDir, "does-not-exist");
		expect(detectOS(p)).toBeNull();
	});

	it("returns null for garbage / unrecognized content", () => {
		const p = writeOsRelease("this is not a valid os-release file\n!!!\n");
		expect(detectOS(p)).toBeNull();
	});

	it("defaults to /etc/os-release when called with no argument", () => {
		// Smoke check: a no-arg call must not throw and returns a known shape.
		const result = detectOS();
		expect(result === null || typeof result === "string").toBe(true);
	});
});

describe("findActiveModeFlags", () => {
	it("returns an empty array when no mode flags are set", () => {
		expect(findActiveModeFlags({})).toEqual([]);
	});

	it("ignores the --os option (not a mode flag)", () => {
		expect(findActiveModeFlags({ os: "cachyos" })).toEqual([]);
	});

	it("returns the single set flag when exactly one is set", () => {
		expect(findActiveModeFlags({ claude: true })).toEqual(["claude"]);
	});

	it("ignores falsy flag values", () => {
		expect(findActiveModeFlags({ claude: false, skills: undefined })).toEqual(
			[],
		);
	});

	it("returns both names when two mode flags are set", () => {
		const result = findActiveModeFlags({ claude: true, audio: true });
		expect(result.length).toBe(2);
		expect(result).toContain("claude");
		expect(result).toContain("audio");
	});

	it("covers every Commander one-shot option and excludes only --os", () => {
		const source = fs.readFileSync(
			path.resolve(import.meta.dir, "..", "haoshoku.js"),
			"utf8",
		);
		const registeredModes = registeredModeFlags(source);

		expect(MODE_FLAGS).toEqual(registeredModes);
		for (const flag of registeredModes) {
			expect(findActiveModeFlags({ [flag]: true })).toEqual([flag]);
		}
	});

	it("derives mode flags from short aliases and addOption registrations", () => {
		const source = `program
			.option("-x, --xyz", "short alias")
			.addOption(new Option("--via-option", "long-only Option"))
			.addOption(new Option("-q, --aliased-option", "aliased Option"));`;

		expect(registeredModeFlags(source)).toEqual([
			"xyz",
			"viaOption",
			"aliasedOption",
		]);
	});
});
