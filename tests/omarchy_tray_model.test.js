import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const modelPath = path.join(
	path.resolve(import.meta.dir, ".."),
	"configs",
	"omarchy",
	"plugins",
	"xzat.tray",
	"TrayModel.js",
);
const moduleShim = { exports: {} };
new Function("module", fs.readFileSync(modelPath, "utf8"))(moduleShim);
const TrayModel = moduleShim.exports;

describe("xzat.tray model", () => {
	it("normalizes configured embedded widgets without changing their order", () => {
		expect(
			TrayModel.normalizeEmbeddedWidgets([
				"aislandener.galaxy-buds",
				{ id: "omarchy.monitor" },
				null,
				"",
				{ items: ["missing-id"] },
			]),
		).toEqual([
			{ id: "aislandener.galaxy-buds" },
			{ id: "omarchy.monitor" },
		]);
	});

	it("counts embedded widgets and status notifier items in one drawer", () => {
		expect(
			TrayModel.drawerItemCount(
				[{ id: "teams" }, { id: "chatgpt" }],
				[{ id: "aislandener.galaxy-buds" }, { id: "omarchy.monitor" }],
			),
		).toBe(4);
	});

	it("accepts QML list-like widget settings", () => {
		expect(
			TrayModel.normalizeEmbeddedWidgets({
				0: { id: "crmne.hyprmoncfg" },
				1: { id: "white.nights" },
				length: 2,
			}),
		).toEqual([{ id: "crmne.hyprmoncfg" }, { id: "white.nights" }]);
	});
});
