import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	detectDeviceType,
	promptDeviceType,
} from "../src/common/device_type.js";

function promptWithoutDetection(options) {
	return promptDeviceType({ detectDeviceTypeImpl: () => null, ...options });
}

describe("promptDeviceType", () => {
	let tmpDir;
	let configPath;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-device-"));
		configPath = path.join(tmpDir, ".haoshoku.json");
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	function buildPromptFn(scriptedAnswer) {
		const fn = async () => scriptedAnswer;
		return fn;
	}

	it("detects portable chassis types and a battery fallback", () => {
		const chassisTypePath = path.join(tmpDir, "chassis_type");
		const powerSupplyPath = path.join(tmpDir, "power_supply");
		fs.writeFileSync(chassisTypePath, "10\n");
		expect(detectDeviceType({ chassisTypePath, powerSupplyPath })).toBe(
			"laptop",
		);

		fs.writeFileSync(chassisTypePath, "3\n");
		expect(detectDeviceType({ chassisTypePath, powerSupplyPath })).toBe("pc");

		fs.writeFileSync(chassisTypePath, "2\n");
		fs.mkdirSync(path.join(powerSupplyPath, "BAT0"), { recursive: true });
		fs.writeFileSync(path.join(powerSupplyPath, "BAT0", "type"), "Battery\n");
		expect(detectDeviceType({ chassisTypePath, powerSupplyPath })).toBe(
			"laptop",
		);
	});

	it("persists an automatically detected type without prompting", async () => {
		let promptCalls = 0;
		const result = await promptDeviceType({
			configPath,
			detectDeviceTypeImpl: () => "laptop",
			promptFn: async () => {
				promptCalls += 1;
				return { device: "pc" };
			},
		});

		expect(result).toBe("laptop");
		expect(promptCalls).toBe(0);
		expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toEqual({
			deviceType: "laptop",
		});
	});

	it("honors a stored explicit type without detecting or prompting", async () => {
		fs.writeFileSync(
			configPath,
			`${JSON.stringify({ deviceType: "pc", preserved: true })}\n`,
		);
		let detectionCalls = 0;
		let promptCalls = 0;
		const result = await promptDeviceType({
			configPath,
			detectDeviceTypeImpl: () => {
				detectionCalls += 1;
				return "laptop";
			},
			promptFn: async () => {
				promptCalls += 1;
				return { device: "laptop" };
			},
		});

		expect(result).toBe("pc");
		expect(detectionCalls).toBe(0);
		expect(promptCalls).toBe(0);
		expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toEqual({
			deviceType: "pc",
			preserved: true,
		});
	});

	it("lets an explicit CLI value replace a stored type", async () => {
		fs.writeFileSync(configPath, `${JSON.stringify({ deviceType: "pc" })}\n`);

		expect(
			await promptDeviceType({
				configPath,
				forcedDeviceType: "laptop",
				detectDeviceTypeImpl: () => "pc",
			}),
		).toBe("laptop");
		expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toEqual({
			deviceType: "laptop",
		});
	});

	it("prompts for an invalid stored type and preserves unrelated settings", async () => {
		fs.writeFileSync(
			configPath,
			`${JSON.stringify({ deviceType: "other", customSetting: "existing" })}\n`,
		);
		let question;

		expect(
			await promptWithoutDetection({
				configPath,
				isTTY: true,
				promptFn: async (receivedQuestion) => {
					question = receivedQuestion;
					return { device: "laptop" };
				},
			}),
		).toBe("laptop");
		expect(question.choices[question.initial].value).toBe("pc");
		expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toEqual({
			deviceType: "laptop",
			customSetting: "existing",
		});
	});

	it("preselects PC instead of Skip when stored deviceType is null", async () => {
		fs.writeFileSync(
			configPath,
			`${JSON.stringify({ deviceType: null, customSetting: "existing" })}\n`,
		);
		let question;

		await promptWithoutDetection({
			configPath,
			isTTY: true,
			promptFn: async (receivedQuestion) => {
				question = receivedQuestion;
				return { device: null };
			},
		});

		expect(question.choices[question.initial].value).toBe("pc");
		expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toEqual({
			deviceType: null,
			customSetting: "existing",
		});
	});

	it("persists 'laptop' to ~/.haoshoku.json when the user picks Laptop", async () => {
		const result = await promptWithoutDetection({
			configPath,
			promptFn: buildPromptFn({ device: "laptop" }),
		});
		expect(result).toBe("laptop");
		expect(JSON.parse(fs.readFileSync(configPath, "utf8")).deviceType).toBe(
			"laptop",
		);
	});

	it("offers only device types that have routable config variants", async () => {
		let question;
		await promptWithoutDetection({
			configPath,
			promptFn: async (receivedQuestion) => {
				question = receivedQuestion;
				return { device: null };
			},
		});

		expect(question.choices.map(({ value }) => value)).toEqual([
			"pc",
			"laptop",
			null,
		]);
	});

	it("does NOT modify ~/.haoshoku.json when the user picks Skip", async () => {
		fs.writeFileSync(
			configPath,
			JSON.stringify({ customSetting: "existing" }, null, 2),
		);
		const before = fs.readFileSync(configPath, "utf8");
		const result = await promptWithoutDetection({
			configPath,
			promptFn: buildPromptFn({ device: null }),
		});
		expect(result).toBeNull();
		expect(fs.readFileSync(configPath, "utf8")).toBe(before);
	});

	it("preserves existing config keys when persisting deviceType (merge, not overwrite)", async () => {
		fs.writeFileSync(
			configPath,
			JSON.stringify({ customSetting: "keep-me", extra: 42 }, null, 2),
		);
		await promptWithoutDetection({
			configPath,
			promptFn: buildPromptFn({ device: "pc" }),
		});
		const persisted = JSON.parse(fs.readFileSync(configPath, "utf8"));
		expect(persisted.deviceType).toBe("pc");
		expect(persisted.customSetting).toBe("keep-me");
		expect(persisted.extra).toBe(42);
	});

	it("warns when replacing a malformed ~/.haoshoku.json while persisting deviceType", async () => {
		fs.writeFileSync(configPath, "{ not valid json");
		const messages = [];
		const originalLog = console.log;
		console.log = (...args) => messages.push(args.join(" "));
		try {
			await promptWithoutDetection({
				configPath,
				promptFn: buildPromptFn({ device: "laptop" }),
			});
		} finally {
			console.log = originalLog;
		}

		expect(JSON.parse(fs.readFileSync(configPath, "utf8")).deviceType).toBe(
			"laptop",
		);
		expect(messages.join("\n")).toMatch(/Malformed .*\.haoshoku\.json/i);
	});

	it("does not promise replacing a malformed config when non-interactive fallback will not save", async () => {
		fs.writeFileSync(configPath, "{ not valid json");
		const before = fs.readFileSync(configPath, "utf8");
		const warnings = [];
		const originalLog = console.log;
		console.log = (...args) => warnings.push(args.join(" "));

		try {
			expect(
				await promptWithoutDetection({
					configPath,
					isTTY: false,
					promptFn: async () => {
						throw new Error("prompt must not run");
					},
				}),
			).toBe("pc");
		} finally {
			console.log = originalLog;
		}

		expect(fs.readFileSync(configPath, "utf8")).toBe(before);
		expect(warnings.join("\n")).not.toContain(
			"replacing it while saving deviceType",
		);
	});

	it("uses the stored device type without prompting or rewriting it when non-interactive", async () => {
		fs.writeFileSync(
			configPath,
			`${JSON.stringify({ deviceType: "laptop", customSetting: "existing" })}\n`,
		);
		const before = fs.readFileSync(configPath, "utf8");

		expect(
			await promptWithoutDetection({
				configPath,
				isTTY: false,
				promptFn: async () => {
					throw new Error("prompt must not run");
				},
			}),
		).toBe("laptop");
		expect(fs.readFileSync(configPath, "utf8")).toBe(before);
	});

	it("keeps the stored laptop type without opening an interactive prompt", async () => {
		fs.writeFileSync(
			configPath,
			`${JSON.stringify({ deviceType: "laptop", customSetting: "existing" })}\n`,
		);
		const before = fs.readFileSync(configPath, "utf8");
		const messages = [];
		let promptCalls = 0;
		const originalWarning = console.log;
		console.log = (...args) => messages.push(args.join(" "));

		try {
			expect(
				await promptWithoutDetection({
					configPath,
					isTTY: true,
					promptFn: async () => {
						promptCalls += 1;
						return { device: "pc" };
					},
				}),
			).toBe("laptop");
		} finally {
			console.log = originalWarning;
		}

		expect(fs.readFileSync(configPath, "utf8")).toBe(before);
		expect(promptCalls).toBe(0);
		expect(messages.join("\n")).toContain("Using stored deviceType laptop");
	});

	it("does not persist the non-interactive pc fallback and prompts on the next run", async () => {
		const warnings = [];
		const originalWarning = console.log;
		console.log = (...args) => warnings.push(args.join(" "));
		let fallbackResult;
		try {
			fallbackResult = await promptWithoutDetection({
				configPath,
				isTTY: false,
				promptFn: async () => {
					throw new Error("prompt must not run");
				},
			});
		} finally {
			console.log = originalWarning;
		}

		expect(fallbackResult).toBe("pc");
		expect(fs.existsSync(configPath)).toBeFalse();
		expect(warnings.join("\n")).toContain(
			"returning deviceType pc without saving it",
		);
		expect(warnings.join("\n")).toContain(
			"full setup routing reads persisted config independently",
		);

		let promptCalls = 0;
		const interactiveResult = await promptWithoutDetection({
			configPath,
			isTTY: true,
			promptFn: async () => {
				promptCalls += 1;
				return { device: "laptop" };
			},
		});

		expect(interactiveResult).toBe("laptop");
		expect(promptCalls).toBe(1);
		expect(JSON.parse(fs.readFileSync(configPath, "utf8")).deviceType).toBe(
			"laptop",
		);
	});

	it("does not modify a non-object config during the unattended pc fallback", async () => {
		fs.writeFileSync(configPath, "null\n");
		const before = fs.readFileSync(configPath, "utf8");

		expect(
			await promptWithoutDetection({
				configPath,
				isTTY: false,
				promptFn: async () => {
					throw new Error("prompt must not run");
				},
			}),
		).toBe("pc");
		expect(fs.readFileSync(configPath, "utf8")).toBe(before);
	});

	it("does not persist the pc fallback when the prompt throws and prompts on the next run", async () => {
		const warnings = [];
		const originalWarning = console.log;
		console.log = (...args) => warnings.push(args.join(" "));

		try {
			expect(
				await promptWithoutDetection({
					configPath,
					isTTY: true,
					promptFn: async () => {
						throw new Error("terminal unavailable");
					},
				}),
			).toBe("pc");
		} finally {
			console.log = originalWarning;
		}

		expect(fs.existsSync(configPath)).toBeFalse();
		expect(warnings.join("\n")).toContain("terminal unavailable");
		expect(warnings.join("\n")).toContain("returning deviceType pc");

		let promptCalls = 0;
		expect(
			await promptWithoutDetection({
				configPath,
				isTTY: true,
				promptFn: async () => {
					promptCalls += 1;
					return { device: "laptop" };
				},
			}),
		).toBe("laptop");
		expect(promptCalls).toBe(1);
		expect(JSON.parse(fs.readFileSync(configPath, "utf8")).deviceType).toBe(
			"laptop",
		);
	});
});
