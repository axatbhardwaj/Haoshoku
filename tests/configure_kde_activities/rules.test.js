import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
	IDS,
	CLASSES,
	FIXTURES_PATH,
	activitiesModule,
	section,
} from "./helpers.js";

describe("updateKwinRulesContent", () => {
	it("replaces stale Haoshoku rules while preserving unrelated blocks byte-for-byte", async () => {
		const { updateKwinRulesContent } = await activitiesModule();
		const unrelated =
			"[keep-me]\n# duplicate keys and spacing are intentional\nvalue=one\nvalue=two\n\n";
		const original = [
			"# preamble stays",
			"[General]",
			"custom = untouched",
			"count=99",
			"rules=keep-me,haoshoku-brave-flux,haoshoku-brave-work,haoshoku-agents",
			"",
			unrelated.trimEnd(),
			"[haoshoku-brave-flux]",
			"desktops=4",
			"desktopsrule=2",
			"",
			"[haoshoku-brave-work]",
			"desktops=5",
			"",
			"[haoshoku-brave]",
			"Description=orphan",
			"",
			"[haoshoku-agents]",
			"wmclass=kitty-agents",
			"",
		].join("\n");

		const result = updateKwinRulesContent(original, IDS, CLASSES);

		expect(result).toContain(
			"# preamble stays\n[General]\ncustom = untouched\n",
		);
		expect(result).toContain(unrelated);
		expect(result).not.toContain("haoshoku-brave-work");
		expect(result).not.toContain("[haoshoku-brave]\n");
		expect(result).not.toContain("[haoshoku-agents]\n");
		const rules = section(result, "General")
			.match(/^rules=(.*)$/m)[1]
			.split(",");
		expect(rules).toEqual([
			"keep-me",
			"haoshoku-notion",
			"haoshoku-spotify",
			"haoshoku-brave-flux",
			"haoshoku-steam",
			"haoshoku-vesktop",
			"haoshoku-whatsapp",
			"haoshoku-telegram",
			"haoshoku-signal",
			"haoshoku-brave-defi",
			"haoshoku-teams",
		]);
		expect(section(result, "General")).toContain("count=11\n");
	});

	it("emits the measured Wayland classes and explicit forced activity UUIDs", async () => {
		const { updateKwinRulesContent } = await activitiesModule();
		const result = updateKwinRulesContent("", IDS, CLASSES);
		const allActivities = `${IDS.flux},${IDS.defi},${IDS.palmUSD}`;
		const expected = {
			"haoshoku-notion": [CLASSES.notion, allActivities],
			"haoshoku-spotify": [CLASSES.spotify, allActivities],
			"haoshoku-brave-flux": [CLASSES.braveFlux, IDS.flux],
			"haoshoku-steam": [CLASSES.steam, IDS.flux],
			"haoshoku-vesktop": [CLASSES.vesktop, IDS.flux],
			"haoshoku-whatsapp": [CLASSES.whatsapp, IDS.flux],
			"haoshoku-telegram": [CLASSES.telegram, IDS.flux],
			"haoshoku-signal": [CLASSES.signal, IDS.flux],
			"haoshoku-brave-defi": [CLASSES.braveDefi, IDS.defi],
			"haoshoku-teams": [CLASSES.teams, IDS.defi],
		};

		for (const [rule, [wmclass, activity]] of Object.entries(expected)) {
			const block = section(result, rule);
			expect(block).toContain(`wmclass=${wmclass}\n`);
			expect(block).toContain("wmclassmatch=1\n");
			expect(block).toContain(`activity=${activity}\n`);
			expect(block).toContain("activityrule=2\n");
			expect(block).toMatch(/^Description=Haoshoku /m);
		}
		expect(section(result, "haoshoku-agents")).toBeUndefined();
	});

	it("replaces the retired Discord rule with Vesktop idempotently", async () => {
		const { updateKwinRulesContent } = await activitiesModule();
		const original =
			"[General]\nrules=haoshoku-discord\ncount=1\n\n[haoshoku-discord]\nwmclass=discord\n";
		const result = updateKwinRulesContent(original, IDS, CLASSES);
		expect(result).not.toContain("haoshoku-discord");
		expect(section(result, "haoshoku-vesktop")).toContain("wmclass=vesktop\n");
		expect(section(result, "haoshoku-vesktop")).toContain(
			`activity=${IDS.flux}\n`,
		);
		expect(updateKwinRulesContent(result, IDS, CLASSES)).toBe(result);
	});

	it("pins only Steam's exact measured class to flux", async () => {
		const { updateKwinRulesContent } = await activitiesModule();
		const result = updateKwinRulesContent("", IDS, CLASSES);
		const steam = section(result, "haoshoku-steam");
		const allActivities = `${IDS.flux},${IDS.defi},${IDS.palmUSD}`;

		expect(steam).toContain("wmclass=steam\n");
		expect(steam).toContain("wmclassmatch=1\n");
		expect(steam).toContain(`activity=${IDS.flux}\n`);
		expect(steam).toContain("activityrule=2\n");
		expect(steam).not.toContain(`activity=${allActivities}\n`);
		expect(steam).not.toContain("wmclasscomplete=");
	});

	it("never emits screen or desktop placement keys", async () => {
		const { updateKwinRulesContent } = await activitiesModule();
		const result = updateKwinRulesContent(
			"[General]\nrules=\ncount=0\n",
			IDS,
			CLASSES,
		);

		expect(result).not.toMatch(
			/^(?:screen|screenrule|desktops|desktopsrule)=/m,
		);
	});

	it("preserves CRLF and unrelated sections with both trailing-newline variants", async () => {
		const { updateKwinRulesContent } = await activitiesModule();
		for (const trailing of ["", "\r\n"]) {
			const keep = `[custom]\r\n; keep comment\r\ndupe=a\r\ndupe=b${trailing}`;
			const result = updateKwinRulesContent(keep, IDS, CLASSES);
			expect(result).toContain(keep);
			expect(result).not.toMatch(/(^|[^\r])\n/);
			expect(updateKwinRulesContent(result, IDS, CLASSES)).toBe(result);
		}
	});

	it("preserves comments that document the section after a retired rule", async () => {
		const { updateKwinRulesContent } = await activitiesModule();
		const fixture = JSON.parse(
			fs.readFileSync(
				path.join(FIXTURES_PATH, "kwinrulesrc-comments-before-section.json"),
				"utf8",
			),
		);

		const result = updateKwinRulesContent(fixture.original, IDS, CLASSES);

		expect(result).toContain(fixture.preserved);
	});

	it("creates General, rules, and count when each is absent", async () => {
		const { updateKwinRulesContent } = await activitiesModule();
		for (const original of [
			"",
			"[custom]\nvalue=keep",
			"[General]\ncustom=keep\n",
			"[General]\nrules=custom\n\n[custom]\nvalue=keep\n",
			"[General]\ncount=1\n\n[custom]\nvalue=keep\n",
		]) {
			const result = updateKwinRulesContent(original, IDS, CLASSES);
			const general = section(result, "General");
			expect(general).toMatch(/^rules=.+$/m);
			expect(general).toMatch(/^count=\d+$/m);
			if (original.includes("[custom]")) {
				expect(result).toContain("[custom]\nvalue=keep");
			}
		}
	});

	it("fails closed on duplicate sections, malformed headers, and ambiguous General keys", async () => {
		const { updateKwinRulesContent } = await activitiesModule();
		for (const original of [
			"[same]\na=1\n[same]\na=2\n",
			"[General]\ncount=0\n[General]\nrules=\n",
			"[General\ncount=0\n",
			"[General] trailing\ncount=0\n",
			" [General]\ncount=0\n",
			"[General]\nrules=a\nrules=b\n",
			"[General]\ncount=1\ncount=2\n",
			"[General]\nrules=a,,b\n",
		]) {
			expect(() => updateKwinRulesContent(original, IDS, CLASSES)).toThrow();
		}
	});

	it("fails closed when kwinrulesrc contains a lone carriage return", async () => {
		const { updateKwinRulesContent } = await activitiesModule();
		const { content } = JSON.parse(
			fs.readFileSync(
				path.join(FIXTURES_PATH, "kwinrulesrc-lone-cr.json"),
				"utf8",
			),
		);

		expect(() => updateKwinRulesContent(content, IDS, CLASSES)).toThrow(
			"unsupported line endings",
		);
	});

	it("rejects malformed UUIDs and incomplete class maps", async () => {
		const { updateKwinRulesContent } = await activitiesModule();
		expect(() =>
			updateKwinRulesContent("", { ...IDS, flux: "not-a-uuid" }, CLASSES),
		).toThrow();
		expect(() =>
			updateKwinRulesContent("", IDS, { ...CLASSES, spotify: "" }),
		).toThrow();
	});
});
