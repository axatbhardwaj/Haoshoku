import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MODULE_PATH = "../src/helpers/configure_kde_activities.js";
const SCRIPT_PATH = path.join(
	import.meta.dir,
	"..",
	"configs",
	"kwin",
	"scripts",
	"haoshoku-activities-placement",
	"contents",
	"code",
	"main.js",
);
const FIXTURES_PATH = path.join(import.meta.dir, "fixtures");

const IDS = {
	flux: "11111111-1111-4111-8111-111111111111",
	defi: "22222222-2222-4222-8222-222222222222",
	palmUSD: "33333333-3333-4333-8333-333333333333",
};
const ADD_FAILURE_ID = "66666666-6666-4666-8666-666666666666";

const CLASSES = {
	notion: "brave-dcokohelbbehjlcjjfmhfbpdgfjcoopf-Default",
	spotify: "Spotify",
	agents: "kitty-agents",
	braveFlux: "brave-flux",
	discord: "discord",
	whatsapp: "brave-web.whatsapp.com__-Default",
	telegram: "org.telegram.desktop",
	signal: "signal",
	braveDefi: "brave-defi",
	teams: "teams-for-linux",
};

const SCREEN_GEOMETRIES = {
	"HDMI-A-1": { x: 3640, y: 491, width: 1920, height: 1080 },
	"DP-1": { x: 1080, y: 244, width: 2560, height: 1440 },
	"DP-2": { x: 0, y: 0, width: 1080, height: 1920 },
};

async function activitiesModule() {
	return import(MODULE_PATH);
}

function section(content, name) {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const heading = content.match(
		new RegExp(`^\\[${escaped}\\](?:\\r?\\n|$)`, "m"),
	);
	if (!heading) return;
	const bodyStart = heading.index + heading[0].length;
	const nextSection = content.slice(bodyStart).search(/^\[/m);
	const end = nextSection === -1 ? content.length : bodyStart + nextSection;
	return content.slice(heading.index, end);
}

function activityDb(entries, options = {}) {
	const names = new Map(entries);
	const calls = [];
	let nextId = 4;

	return {
		calls,
		names,
		runCapture: async (args) => {
			calls.push(args);
			const method = args[3];
			if (options.listFailure && method.endsWith(".ListActivities")) {
				return { exitCode: 1, stdout: "", stderr: "unavailable" };
			}
			if (method.endsWith(".ListActivities")) {
				return {
					exitCode: 0,
					stdout: `${[...names.keys()].join("\n")}\n`,
					stderr: "",
				};
			}
			if (method.endsWith(".ActivityName")) {
				const name = names.get(args[4]);
				return {
					exitCode: options.nameFailure === args[4] ? 1 : 0,
					stdout: options.emptyName === args[4] ? "\n" : `${name ?? ""}\n`,
					stderr: "",
				};
			}
			if (method.endsWith(".AddActivity")) {
				if (options.addFailure === args[4]) {
					names.set(ADD_FAILURE_ID, args[4]);
					return {
						exitCode: 1,
						stdout: `${ADD_FAILURE_ID}\n`,
						stderr: "add failed",
					};
				}
				if (options.malformedAdd === args[4]) {
					return { exitCode: 0, stdout: "not-a-uuid\n", stderr: "" };
				}
				const id = `${nextId}${String(nextId).repeat(7)}-${String(nextId).repeat(4)}-4${String(nextId).repeat(3)}-8${String(nextId).repeat(3)}-${String(nextId).repeat(12)}`;
				nextId += 1;
				names.set(id, args[4]);
				return { exitCode: 0, stdout: `${id}\n`, stderr: "" };
			}
			throw new Error(`Unexpected capture command: ${args.join(" ")}`);
		},
	};
}

function guarded(object) {
	return new Proxy(object, {
		get(target, property, receiver) {
			if (property === "activities") {
				throw new Error("activities must not be read");
			}
			return Reflect.get(target, property, receiver);
		},
		set(target, property, value, receiver) {
			if (property === "output") throw new Error("output is read-only");
			return Reflect.set(target, property, value, receiver);
		},
	});
}

function loadPlacementHarness(
	screenNames = ["HDMI-A-1", "DP-1", "DP-2"],
	clientArea,
) {
	const callbacks = [];
	const workspaceState = {
		screens: screenNames.map((name) =>
			guarded({ name, geometry: SCREEN_GEOMETRIES[name] }),
		),
		currentDesktop: "desktop-1",
		windowAdded: {
			connect(callback) {
				callbacks.push(callback);
			},
		},
	};
	if (clientArea) workspaceState.clientArea = clientArea;
	const workspace = guarded(workspaceState);
	const source = fs.readFileSync(SCRIPT_PATH, "utf8");
	new Function("workspace", "print", source)(workspace, () => {});
	return { callbacks, workspace };
}

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
			"rules=keep-me,haoshoku-brave-flux,haoshoku-brave-work",
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
		].join("\n");

		const result = updateKwinRulesContent(original, IDS, CLASSES);

		expect(result).toContain(
			"# preamble stays\n[General]\ncustom = untouched\n",
		);
		expect(result).toContain(unrelated);
		expect(result).not.toContain("haoshoku-brave-work");
		expect(result).not.toContain("[haoshoku-brave]\n");
		const rules = section(result, "General")
			.match(/^rules=(.*)$/m)[1]
			.split(",");
		expect(rules).toEqual([
			"keep-me",
			"haoshoku-notion",
			"haoshoku-spotify",
			"haoshoku-agents",
			"haoshoku-brave-flux",
			"haoshoku-discord",
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
			"haoshoku-agents": [CLASSES.agents, allActivities],
			"haoshoku-brave-flux": [CLASSES.braveFlux, IDS.flux],
			"haoshoku-discord": [CLASSES.discord, IDS.flux],
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

describe("KWin activities placement asset", () => {
	it("the activity-read guard throws when its activities property is read", () => {
		const fake = guarded({ resourceClass: "discord" });
		expect(() => fake.activities).toThrow("activities must not be read");
	});

	it("the KWin window double rejects writes to its read-only output", () => {
		const fake = guarded({ output: guarded({ name: "DP-1" }) });
		expect(() => {
			fake.output = guarded({ name: "DP-2" });
		}).toThrow("output is read-only");
	});

	it("falls back to output geometry when clientArea is absent and clamps within it", () => {
		const { callbacks, workspace } = loadPlacementHarness();
		expect(callbacks).toHaveLength(1);
		const expected = {
			[CLASSES.notion]: "DP-2",
			[CLASSES.spotify]: "DP-2",
			[CLASSES.agents]: "DP-2",
			[CLASSES.braveFlux]: "DP-1",
			[CLASSES.braveDefi]: "DP-1",
			[CLASSES.discord]: "HDMI-A-1",
			[CLASSES.whatsapp]: "HDMI-A-1",
			[CLASSES.telegram]: "HDMI-A-1",
			[CLASSES.signal]: "HDMI-A-1",
			[CLASSES.teams]: "HDMI-A-1",
		};

		for (const [resourceClass, outputName] of Object.entries(expected)) {
			const originalOutput = guarded({ name: "original" });
			const window = guarded({
				resourceClass,
				output: originalOutput,
				frameGeometry: { x: 99, y: 88, width: 1600, height: 1200 },
			});
			callbacks[0](window);
			expect(window.output).toBe(originalOutput);
			const destination = workspace.screens.find(
				(output) => output.name === outputName,
			).geometry;
			expect(window.frameGeometry).toEqual({
				x: destination.x,
				y: destination.y,
				width: Math.min(1600, destination.width),
				height: Math.min(1200, destination.height),
			});
		}
	});

	it("uses the output work area origin and bounds for placement", () => {
		const workArea = { x: 1090, y: 274, width: 2540, height: 1380 };
		const { callbacks } = loadPlacementHarness(undefined, (area, output, desktop) => {
			if (area !== 0 || output.name !== "DP-1" || desktop !== "desktop-1") {
				throw new Error("unexpected clientArea arguments");
			}
			return workArea;
		});
		const window = guarded({
			resourceClass: CLASSES.braveFlux,
			output: guarded({ name: "original" }),
			frameGeometry: { x: 99, y: 88, width: 3000, height: 1500 },
		});

		callbacks[0](window);

		expect(window.frameGeometry).toEqual(workArea);
	});

	it("falls back to output geometry when clientArea throws", () => {
		const { callbacks } = loadPlacementHarness(undefined, () => {
			throw new Error("clientArea unavailable");
		});
		const window = guarded({
			resourceClass: CLASSES.braveFlux,
			output: guarded({ name: "original" }),
			frameGeometry: { x: 99, y: 88, width: 3000, height: 1500 },
		});

		callbacks[0](window);

		expect(window.frameGeometry).toEqual(SCREEN_GEOMETRIES["DP-1"]);
	});

	it("leaves windows alone when the named output is absent or the class is unmanaged", () => {
		const { callbacks } = loadPlacementHarness(["HDMI-A-1", "DP-2"]);
		for (const resourceClass of [CLASSES.braveFlux, "brave-browser"]) {
			const originalOutput = guarded({ name: "original" });
			const originalFrame = { x: 99, y: 88, width: 800, height: 600 };
			const window = guarded({
				resourceClass,
				output: originalOutput,
				frameGeometry: originalFrame,
			});
			callbacks[0](window);
			expect(window.output).toBe(originalOutput);
			expect(window.frameGeometry).toBe(originalFrame);
		}
	});

	it("does not connect geometry, output-change, screen-change, or activity signals", () => {
		const { callbacks } = loadPlacementHarness();
		const forbidden = new Set([
			"frameGeometryChanged",
			"outputChanged",
			"activitiesChanged",
		]);
		const window = new Proxy(
			{
				resourceClass: CLASSES.discord,
				output: null,
				frameGeometry: { x: 0, y: 0, width: 800, height: 600 },
			},
			{
				get(target, property, receiver) {
					if (forbidden.has(property))
						throw new Error(`read ${String(property)}`);
					if (property === "activities")
						throw new Error("activities must not be read");
					return Reflect.get(target, property, receiver);
				},
			},
		);
		expect(() => callbacks[0](window)).not.toThrow();
	});
});

describe("syncKdeActivities", () => {
	let home;

	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-activities-"));
		fs.mkdirSync(path.join(home, ".config"), { recursive: true });
	});

	afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

	it("creates only missing activities, installs owned files, and is idempotent", async () => {
		const { syncKdeActivities } = await activitiesModule();
		const db = activityDb([[IDS.flux, "flux"]]);

		expect(
			await syncKdeActivities({
				home,
				runCapture: db.runCapture,
				reload: false,
			}),
		).toBe(true);
		const firstRules = fs.readFileSync(
			path.join(home, ".config", "kwinrulesrc"),
			"utf8",
		);
		const firstAdds = db.calls.filter((args) =>
			args[3].endsWith(".AddActivity"),
		);
		expect(firstAdds.map((args) => args[4])).toEqual(["defi", "palmUSD"]);
		expect(firstRules).toContain(
			`activity=${IDS.flux},44444444-4444-4444-8444-444444444444,55555555-5555-4555-8555-555555555555`,
		);

		const packageRoot = path.join(
			home,
			".local",
			"share",
			"kwin",
			"scripts",
			"haoshoku-activities-placement",
		);
		expect(
			JSON.parse(
				fs.readFileSync(path.join(packageRoot, "metadata.json"), "utf8"),
			),
		).toMatchObject({
			KPackageStructure: "KWin/Script",
			KPlugin: { Id: "haoshoku-activities-placement" },
			"X-Plasma-API": "javascript",
		});
		expect(
			fs.readFileSync(
				path.join(packageRoot, "contents", "code", "main.js"),
				"utf8",
			),
		).toBe(fs.readFileSync(SCRIPT_PATH, "utf8"));

		await syncKdeActivities({ home, runCapture: db.runCapture, reload: false });
		expect(
			db.calls.filter((args) => args[3].endsWith(".AddActivity")),
		).toHaveLength(2);
		expect(
			fs.readFileSync(path.join(home, ".config", "kwinrulesrc"), "utf8"),
		).toBe(firstRules);
	});

	it("includes every discovered activity in rules intended for all activities", async () => {
		const { syncKdeActivities } = await activitiesModule();
		const extraActivityId = "77777777-7777-4777-8777-777777777777";
		const db = activityDb([
			[IDS.flux, "flux"],
			[IDS.defi, "defi"],
			[IDS.palmUSD, "palmUSD"],
			[extraActivityId, "unrelated"],
		]);

		expect(
			await syncKdeActivities({
				home,
				runCapture: db.runCapture,
				reload: false,
			}),
		).toBe(true);
		const rules = fs.readFileSync(
			path.join(home, ".config", "kwinrulesrc"),
			"utf8",
		);
		const allActivities = `${IDS.flux},${IDS.defi},${IDS.palmUSD},${extraActivityId}`;
		for (const rule of [
			"haoshoku-notion",
			"haoshoku-spotify",
			"haoshoku-agents",
		]) {
			expect(section(rules, rule)).toContain(`activity=${allActivities}\n`);
		}
	});

	it("leaves Brave launcher ownership to the Plasma helper", async () => {
		const { syncKdeActivities } = await activitiesModule();
		const db = activityDb([
			[IDS.flux, "flux"],
			[IDS.defi, "defi"],
			[IDS.palmUSD, "palmUSD"],
		]);
		const applications = path.join(home, ".local", "share", "applications");
		fs.mkdirSync(applications, { recursive: true });
		const launchers = {
			"haoshoku-brave-flux.desktop": "plasma owns flux\n",
			"haoshoku-brave-defi.desktop": "plasma owns defi\n",
			"haoshoku-brave-work.desktop": "plasma owns work\n",
		};
		for (const [name, content] of Object.entries(launchers)) {
			fs.writeFileSync(path.join(applications, name), content);
		}

		await syncKdeActivities({ home, runCapture: db.runCapture, reload: false });

		for (const [name, content] of Object.entries(launchers)) {
			expect(fs.readFileSync(path.join(applications, name), "utf8")).toBe(
				content,
			);
		}
	});

	it("enables the placement plugin in kwinrc with a write-once backup", async () => {
		const { syncKdeActivities } = await activitiesModule();
		const db = activityDb([
			[IDS.flux, "flux"],
			[IDS.defi, "defi"],
			[IDS.palmUSD, "palmUSD"],
		]);
		const kwinrc = path.join(home, ".config", "kwinrc");
		const original = [
			"[Windows]",
			"FocusPolicy=ClickToFocus",
			"",
			"[Plugins]",
			"krohnkiteEnabled=true",
			"",
		].join("\n");
		fs.writeFileSync(kwinrc, original);

		await syncKdeActivities({ home, runCapture: db.runCapture, reload: false });

		const enabled = fs.readFileSync(kwinrc, "utf8");
		expect(enabled).toContain("[Windows]\nFocusPolicy=ClickToFocus\n");
		expect(enabled).toContain("[Plugins]\nkrohnkiteEnabled=true\n");
		expect(enabled).toContain("haoshoku-activities-placementEnabled=true\n");
		expect(fs.readFileSync(`${kwinrc}.haoshoku-first-capture`, "utf8")).toBe(
			original,
		);

		fs.writeFileSync(
			kwinrc,
			enabled.replace(
				"haoshoku-activities-placementEnabled=true",
				"haoshoku-activities-placementEnabled=false",
			),
		);
		await syncKdeActivities({ home, runCapture: db.runCapture, reload: false });
		expect(fs.readFileSync(kwinrc, "utf8")).toContain(
			"haoshoku-activities-placementEnabled=true\n",
		);
		expect(fs.readFileSync(`${kwinrc}.haoshoku-first-capture`, "utf8")).toBe(
			original,
		);
	});

	it("enables the placement plugin without altering nested KConfig groups", async () => {
		const { syncKdeActivities } = await activitiesModule();
		const db = activityDb([
			[IDS.flux, "flux"],
			[IDS.defi, "defi"],
			[IDS.palmUSD, "palmUSD"],
		]);
		const kwinrc = path.join(home, ".config", "kwinrc");
		const original = fs.readFileSync(
			path.join(FIXTURES_PATH, "kwinrc-nested-groups.ini"),
			"utf8",
		);
		const nestedGroup = [
			"[Tiling][15fd81c4-51ed-43cf-a371-f17f9eb5a207][04b73265-3840-4a63-a7a7-fa040415b9df]",
			'tiles={"layout":"keep"}',
			"",
		].join("\n");
		fs.writeFileSync(kwinrc, original);

		expect(
			await syncKdeActivities({ home, runCapture: db.runCapture, reload: false }),
		).toBe(true);

		const enabled = fs.readFileSync(kwinrc, "utf8");
		expect(enabled).toContain(nestedGroup);
		expect(enabled).toContain(
			"[Plugins]\nkrohnkiteEnabled=true\nhaoshoku-activities-placementEnabled=true\n",
		);
	});

	it("installs and enables the placement script before writing rules", async () => {
		const { syncKdeActivities } = await activitiesModule();
		const db = activityDb([
			[IDS.flux, "flux"],
			[IDS.defi, "defi"],
			[IDS.palmUSD, "palmUSD"],
		]);
		const rulesFile = path.join(home, ".config", "kwinrulesrc");
		fs.writeFileSync(rulesFile, "[General]\nrules=\ncount=0\n", {
			mode: 0o444,
		});

		expect(
			await syncKdeActivities({
				home,
				runCapture: db.runCapture,
				reload: false,
			}),
		).toBe(false);
		expect(
			fs.existsSync(
				path.join(
					home,
					".local/share/kwin/scripts/haoshoku-activities-placement/contents/code/main.js",
				),
			),
		).toBe(true);
		expect(
			fs.readFileSync(path.join(home, ".config", "kwinrc"), "utf8"),
		).toContain("haoshoku-activities-placementEnabled=true\n");
	});

	it("resolves current names so a renamed activity gets a new desired replacement", async () => {
		const { syncKdeActivities } = await activitiesModule();
		const db = activityDb([
			[IDS.flux, "renamed-flux"],
			[IDS.defi, "defi"],
			[IDS.palmUSD, "palmUSD"],
		]);

		await syncKdeActivities({ home, runCapture: db.runCapture, reload: false });

		expect(
			db.calls.filter((args) => args[3].endsWith(".AddActivity")),
		).toHaveLength(1);
		expect(db.calls.find((args) => args[3].endsWith(".AddActivity"))[4]).toBe(
			"flux",
		);
		const rules = fs.readFileSync(
			path.join(home, ".config", "kwinrulesrc"),
			"utf8",
		);
		expect(rules).toContain("activity=44444444-4444-4444-8444-444444444444\n");
		expect(rules).not.toContain(`activity=${IDS.flux}\n`);
	});

	it("fails closed without writes or additions when activity queries are unreliable", async () => {
		const { syncKdeActivities } = await activitiesModule();
		const cases = [
			activityDb([[IDS.flux, "flux"]], { listFailure: true }),
			activityDb([[IDS.flux, "flux"]], { emptyName: IDS.flux }),
			activityDb([["not-a-uuid", "flux"]]),
		];

		for (const [index, db] of cases.entries()) {
			const caseHome = path.join(home, String(index));
			fs.mkdirSync(path.join(caseHome, ".config"), { recursive: true });
			const rulesFile = path.join(caseHome, ".config", "kwinrulesrc");
			fs.writeFileSync(rulesFile, "[General]\ncount=0\nrules=\n");
			expect(
				await syncKdeActivities({
					home: caseHome,
					runCapture: db.runCapture,
					reload: false,
				}),
			).toBe(false);
			expect(fs.readFileSync(rulesFile, "utf8")).toBe(
				"[General]\ncount=0\nrules=\n",
			);
			expect(db.calls.some((args) => args[3].endsWith(".AddActivity"))).toBe(
				false,
			);
			expect(
				fs.existsSync(path.join(caseHome, ".local", "share", "kwin")),
			).toBe(false);
		}
	});

	it("fails closed when ActivityName returns a nonzero exit code", async () => {
		const { syncKdeActivities } = await activitiesModule();
		const db = activityDb(
			[
				[IDS.flux, "flux"],
				[IDS.defi, "defi"],
				[IDS.palmUSD, "palmUSD"],
			],
			{ nameFailure: IDS.defi },
		);

		expect(
			await syncKdeActivities({
				home,
				runCapture: db.runCapture,
				reload: false,
			}),
		).toBe(false);
		expect(fs.existsSync(path.join(home, ".config", "kwinrulesrc"))).toBe(
			false,
		);
		expect(fs.existsSync(path.join(home, ".local"))).toBe(false);
		expect(db.calls.some((args) => args[3].endsWith(".AddActivity"))).toBe(
			false,
		);
	});

	it("does not write rules or assets when AddActivity returns malformed output", async () => {
		const { syncKdeActivities } = await activitiesModule();
		const db = activityDb([[IDS.flux, "flux"]], { malformedAdd: "defi" });

		expect(
			await syncKdeActivities({
				home,
				runCapture: db.runCapture,
				reload: false,
			}),
		).toBe(false);
		expect(fs.existsSync(path.join(home, ".config", "kwinrulesrc"))).toBe(
			false,
		);
		expect(fs.existsSync(path.join(home, ".local"))).toBe(false);
	});

	it("fails closed when AddActivity returns a nonzero exit code", async () => {
		const { syncKdeActivities } = await activitiesModule();
		const db = activityDb([[IDS.flux, "flux"]], { addFailure: "defi" });

		expect(
			await syncKdeActivities({
				home,
				runCapture: db.runCapture,
				reload: false,
			}),
		).toBe(false);
		expect(fs.existsSync(path.join(home, ".config", "kwinrulesrc"))).toBe(
			false,
		);
		expect(fs.existsSync(path.join(home, ".local"))).toBe(false);
		expect(
			db.calls.filter((args) => args[3].endsWith(".AddActivity")),
		).toHaveLength(1);
	});

	it("rejects ambiguous existing rules before creating any activities", async () => {
		const { syncKdeActivities } = await activitiesModule();
		const db = activityDb([[IDS.flux, "flux"]]);
		const rulesFile = path.join(home, ".config", "kwinrulesrc");
		const ambiguous = "[duplicate]\na=1\n[duplicate]\na=2\n";
		fs.writeFileSync(rulesFile, ambiguous);

		expect(
			await syncKdeActivities({
				home,
				runCapture: db.runCapture,
				reload: false,
			}),
		).toBe(false);
		expect(fs.readFileSync(rulesFile, "utf8")).toBe(ambiguous);
		expect(db.calls).toEqual([]);
		expect(fs.existsSync(path.join(home, ".local"))).toBe(false);
	});

	it("reloads rules and the named script package deterministically", async () => {
		const { syncKdeActivities } = await activitiesModule();
		const db = activityDb([
			[IDS.flux, "flux"],
			[IDS.defi, "defi"],
			[IDS.palmUSD, "palmUSD"],
		]);
		const commands = [];

		await syncKdeActivities({
			home,
			runCapture: db.runCapture,
			run: async (command) => {
				commands.push(command);
				return true;
			},
		});

		expect(commands).toEqual([
			"qdbus6 org.kde.KWin /KWin reconfigure",
			"qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript haoshoku-activities-placement",
			`qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.loadScript ${path.join(home, ".local/share/kwin/scripts/haoshoku-activities-placement/contents/code/main.js")} haoshoku-activities-placement`,
			"qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.start",
		]);
	});

	it("captureCommand decodes stdout and stderr from an argv command", async () => {
		const { captureCommand } = await activitiesModule();
		const result = await captureCommand([
			"bun",
			"-e",
			'process.stdout.write("out"); process.stderr.write("err")',
		]);

		expect(result).toEqual({ exitCode: 0, stdout: "out", stderr: "err" });
	});
});
