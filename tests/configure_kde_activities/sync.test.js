import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	IDS,
	SCRIPT_PATH,
	FIXTURES_PATH,
	activitiesModule,
	section,
	activityDb,
} from "./helpers.js";

describe("syncKdeActivities", () => {
	let home;

	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-activities-"));
		fs.mkdirSync(path.join(home, ".config"), { recursive: true });
	});

	afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

	it("writes every exact managed class to the generated KWin rules", async () => {
		const { syncKdeActivities } = await activitiesModule();
		const db = activityDb([
			[IDS.flux, "flux"],
			[IDS.defi, "defi"],
			[IDS.palmUSD, "palmUSD"],
		]);
		const expectedClasses = {
			"haoshoku-notion": "brave-dcokohelbbehjlcjjfmhfbpdgfjcoopf-Default",
			"haoshoku-spotify": "Spotify",
			"haoshoku-brave-flux": "brave-flux",
			"haoshoku-steam": "steam",
			"haoshoku-vesktop": "vesktop",
			"haoshoku-whatsapp": "brave-hnpfjngllnobngcgfapefoaidbinmjnm-Default",
			"haoshoku-telegram": "org.telegram.desktop",
			"haoshoku-signal": "signal",
			"haoshoku-brave-defi": "brave-defi",
			"haoshoku-teams": "teams-for-linux",
		};

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
		for (const [rule, windowClass] of Object.entries(expectedClasses)) {
			expect(section(rules, rule)).toContain(`wmclass=${windowClass}\n`);
		}
	});

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
		for (const rule of ["haoshoku-notion", "haoshoku-spotify"]) {
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
			await syncKdeActivities({
				home,
				runCapture: db.runCapture,
				reload: false,
			}),
		).toBe(true);

		const enabled = fs.readFileSync(kwinrc, "utf8");
		expect(enabled).toContain(nestedGroup);
		expect(enabled).toContain(
			"[Plugins]\nkrohnkiteEnabled=true\nhaoshoku-activities-placementEnabled=true\n",
		);
	});

	// Root bypasses the mode-0444 write failure this ordering assertion requires.
	it.skipIf(process.getuid?.() === 0)("installs and enables the placement script before writing rules", async () => {
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
