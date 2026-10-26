import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import {
	CLASSES,
	SCRIPT_PATH,
	SCREEN_GEOMETRIES,
	guarded,
	loadPlacementHarness,
} from "./helpers.js";

describe("KWin activities placement asset", () => {
	it("uses only syntax supported by KWin's QJSEngine", () => {
		const source = fs.readFileSync(SCRIPT_PATH, "utf8");
		// Bun's parser accepts newer JavaScript than KWin's QJSEngine. Keep this
		// explicit denylist aligned with the newer constructs QJSEngine rejects.
		const unsupportedSyntax = [
			["optional catch binding", /\bcatch\s*\{/],
			["optional chaining", /\?\.(?!\d)/],
			["nullish coalescing", /\?\?/],
			["spread syntax (including object spread)", /\.\.\./],
			[
				"class fields",
				/\bclass(?:\s+[A-Za-z_$][\w$]*)?(?:\s+extends\s+[^{]+)?\s*\{[\s\S]*?(?:^|\n)\s*(?:static\s+)?#?[A-Za-z_$][\w$]*\s*(?:=|;)/m,
			],
		];
		const violations = unsupportedSyntax
			.filter(([, pattern]) => pattern.test(source))
			.map(([name]) => name);

		expect(violations).toEqual([]);
	});

	it("the activity-read guard throws when its activities property is read", () => {
		const fake = guarded({ resourceClass: "vesktop" });
		expect(() => fake.activities).toThrow("activities must not be read");
	});

	it("the KWin window double rejects writes to its read-only output", () => {
		const fake = guarded({ output: guarded({ name: "DP-1" }) });
		expect(() => {
			fake.output = guarded({ name: "DP-2" });
		}).toThrow("output is read-only");
	});

	it("leaves matching non-normal windows untouched", () => {
		const { callbacks } = loadPlacementHarness();
		const originalOutput = guarded({ name: "original" });
		const originalFrame = { x: 99, y: 88, width: 800, height: 600 };
		const window = guarded({
			normalWindow: false,
			resourceClass: CLASSES.steam,
			output: originalOutput,
			frameGeometry: originalFrame,
		});

		callbacks[0](window);

		expect(window.output).toBe(originalOutput);
		expect(window.frameGeometry).toBe(originalFrame);
	});

	it("falls back to output geometry when clientArea is absent and clamps within it", () => {
		const { callbacks, workspace } = loadPlacementHarness();
		expect(callbacks).toHaveLength(1);
		const expected = {
			[CLASSES.notion]: "DP-2",
			[CLASSES.spotify]: "DP-2",
			[CLASSES.braveFlux]: "DP-1",
			[CLASSES.steam]: "DP-1",
			[CLASSES.braveDefi]: "DP-1",
			[CLASSES.vesktop]: "HDMI-A-1",
			[CLASSES.whatsapp]: "HDMI-A-1",
			[CLASSES.telegram]: "HDMI-A-1",
			[CLASSES.signal]: "HDMI-A-1",
			[CLASSES.teams]: "HDMI-A-1",
		};

		for (const [resourceClass, outputName] of Object.entries(expected)) {
			const originalOutput = guarded({ name: "original" });
			const window = guarded({
				normalWindow: true,
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

	it("places matching normal windows using the output work area", () => {
		const workArea = { x: 1090, y: 274, width: 2540, height: 1380 };
		const { callbacks } = loadPlacementHarness(
			undefined,
			(area, output, desktop) => {
				if (area !== 0 || output.name !== "DP-1" || desktop !== "desktop-1") {
					throw new Error("unexpected clientArea arguments");
				}
				return workArea;
			},
		);
		const window = guarded({
			normalWindow: true,
			resourceClass: CLASSES.braveFlux,
			output: guarded({ name: "original" }),
			frameGeometry: { x: 99, y: 88, width: 3000, height: 1500 },
		});

		callbacks[0](window);

		expect(window.frameGeometry).toEqual(workArea);
	});

	it("places only Steam's own class in the DP-1 work area", () => {
		const workArea = { x: 1080, y: 244, width: 2560, height: 1410 };
		const { callbacks } = loadPlacementHarness(
			undefined,
			(area, output, desktop) => {
				if (area !== 0 || output.name !== "DP-1" || desktop !== "desktop-1") {
					throw new Error("unexpected clientArea arguments");
				}
				return workArea;
			},
		);
		const steam = guarded({
			normalWindow: true,
			resourceClass: CLASSES.steam,
			output: guarded({ name: "original" }),
			frameGeometry: { x: 99, y: 88, width: 3000, height: 1500 },
		});

		callbacks[0](steam);

		expect(steam.frameGeometry).toEqual(workArea);
		const gameFrame = { x: 10, y: 20, width: 1920, height: 1080 };
		const game = guarded({
			normalWindow: true,
			resourceClass: "steam_app_730",
			output: guarded({ name: "original" }),
			frameGeometry: gameFrame,
		});
		callbacks[0](game);
		expect(game.frameGeometry).toBe(gameFrame);
	});

	it("falls back to output geometry when clientArea throws", () => {
		const { callbacks } = loadPlacementHarness(undefined, () => {
			throw new Error("clientArea unavailable");
		});
		const window = guarded({
			normalWindow: true,
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
				normalWindow: true,
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
				normalWindow: true,
				resourceClass: CLASSES.vesktop,
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
