import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
	applyChangelogRelease,
	applyVersionBump,
	computeNextVersion,
} from "../scripts/release.js";

describe("computeNextVersion", () => {
	it("bumps the patch component", () => {
		expect(computeNextVersion("5.5.3", "patch")).toBe("5.5.4");
		expect(computeNextVersion("5.5.9", "patch")).toBe("5.5.10");
	});

	it("bumps the minor component and resets patch", () => {
		expect(computeNextVersion("5.5.3", "minor")).toBe("5.6.0");
		expect(computeNextVersion("5.0.7", "minor")).toBe("5.1.0");
	});

	it("bumps the major component and resets minor and patch", () => {
		expect(computeNextVersion("5.5.3", "major")).toBe("6.0.0");
		expect(computeNextVersion("0.9.9", "major")).toBe("1.0.0");
	});

	it("returns the explicit version for a custom bump", () => {
		expect(computeNextVersion("5.5.3", "custom", "9.1.2")).toBe("9.1.2");
	});

	it("throws on a malformed current version", () => {
		expect(() => computeNextVersion("5.x", "patch")).toThrow(/Invalid/);
		expect(() => computeNextVersion("5.5", "minor")).toThrow(/Invalid/);
		expect(() => computeNextVersion("", "major")).toThrow(/Invalid/);
		expect(() => computeNextVersion(undefined, "patch")).toThrow(/Invalid/);
	});

	it("throws on a custom bump with a malformed explicit version", () => {
		expect(() => computeNextVersion("5.5.3", "custom", "9.1")).toThrow(/Invalid/);
		expect(() => computeNextVersion("5.5.3", "custom", "5.6.0-rc1")).toThrow(/Invalid/);
	});

	it("throws on an unknown bump type", () => {
		expect(() => computeNextVersion("5.5.3", "nope")).toThrow();
	});
});

describe("applyVersionBump", () => {
	it("replaces exactly one .version(...) site", () => {
		const content = 'program\n  .name("haoshoku")\n  .version("5.5.3")\n  .parse();\n';
		const updated = applyVersionBump(content, "5.6.0");
		expect(updated).toContain('.version("5.6.0")');
		expect(updated).not.toContain('.version("5.5.3")');
		// Only one occurrence of the new version string.
		expect(updated.split('.version("5.6.0")').length - 1).toBe(1);
	});

	it("throws when the .version(...) pattern is not found", () => {
		const content = 'program\n  .name("haoshoku")\n  .parse();\n';
		expect(() => applyVersionBump(content, "5.6.0")).toThrow(
			/version pattern not found/,
		);
	});
});

describe("applyChangelogRelease", () => {
	it("accepts a real changelog headed by Unreleased or a released version", () => {
		const changelog = fs.readFileSync(
			path.join(import.meta.dir, "..", "CHANGELOG.md"),
			"utf8",
		);
		const unreleased = /^# Changelog\r?\n\r?\n## Unreleased\r?\n/;
		const released =
			/^# Changelog\r?\n\r?\n## \d+\.\d+\.\d+ - \d{4}-\d{2}-\d{2}\r?\n/;
		expect(unreleased.test(changelog) || released.test(changelog)).toBe(
			true,
		);
		if (unreleased.test(changelog)) {
			expect(() =>
				applyChangelogRelease(changelog, "9.0.1", "2099-01-01"),
			).not.toThrow();
		} else {
			expect(() =>
				applyChangelogRelease(changelog, "9.0.1", "2099-01-01"),
			).toThrow(/Unreleased heading not found/);
		}
	});

	it("accepts a synthetic released changelog and refuses to re-release it", () => {
		const fixture =
			"# Changelog\n\n## 8.6.1 - 2026-08-15\n\n- Released behavior.\n";
		expect(fixture).toMatch(
			/^# Changelog\r?\n\r?\n## \d+\.\d+\.\d+ - \d{4}-\d{2}-\d{2}\r?\n/,
		);
		expect(() =>
			applyChangelogRelease(fixture, "9.0.1", "2099-01-01"),
		).toThrow(/Unreleased heading not found/);
	});
	it("renames the Unreleased heading and leaves all other text untouched", () => {
		const content =
			"# Changelog\n\n## Unreleased\n\n- New behavior.\n\n## 7.2.2 - 2026-08-05\n\n- Previous behavior.\n";
		expect(applyChangelogRelease(content, "7.3.0", "2026-08-06")).toBe(
			"# Changelog\n\n## 7.3.0 - 2026-08-06\n\n- New behavior.\n\n## 7.2.2 - 2026-08-05\n\n- Previous behavior.\n",
		);
	});

	it("throws when the Unreleased heading is not found", () => {
		const content = "# Changelog\n\n## 7.2.2 - 2026-08-05\n";
		expect(() =>
			applyChangelogRelease(content, "7.3.0", "2026-08-06"),
		).toThrow(/Unreleased heading not found/);
	});
});
