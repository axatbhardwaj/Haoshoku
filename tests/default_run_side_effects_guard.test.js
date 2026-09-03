import { expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import {
	configureBrowserIntegration,
	configureUserApps,
	runCachyOSSetup,
} from "../src/os_scripts/cachyos.js";

const EXPECTED_OPTIONS = [
	"prepareArchPackageManagerImpl",
	"ensureRustToolchainImpl",
	"ensureAurHelperImpl",
	"installDevToolsImpl",
	"commandExistsImpl",
	"installSystemPackagesImpl",
	"installFlatpakAppsImpl",
	"configureUserAppsImpl",
	"promptDeviceTypeImpl",
	"configureBraveManagedPoliciesImpl",
	"configureHyprmoncfgImpl",
	"configureOmarchyWorkspacesImpl",
	"configureOmarchyPluginsImpl",
	"configureKdeConnectCommandsImpl",
	"configureOmarchyBarImpl",
	"configureOmazedImpl",
	"configureOmarchyAppearanceImpl",
	"startSudoSessionImpl",
];

const EXPECTED_AWAITED_STEPS = [
	"promptDeviceTypeImpl",
	"startSudoSessionImpl",
	"commandExistsImpl",
	"prepareArchPackageManagerImpl",
	"ensureRustToolchainImpl",
	"ensureAurHelperImpl",
	"installDevToolsImpl",
	"installSystemPackagesImpl",
	"installFlatpakAppsImpl",
	"configureUserAppsImpl",
	"configureBraveManagedPolicies",
	"configureHyprmoncfg",
	"configureOmarchyWorkspaces",
	"configureOmarchyPlugins",
	"configureKdeConnectCommands",
	"configureOmarchyBar",
	"configureOmazed",
	"configureOmarchyAppearance",
];

const TEST_CALLER_CONTRACTS = new Map([
	["runCachyOS" + "Setup", EXPECTED_OPTIONS],
	[
		"configureUser" + "Apps",
		[
			"promptUserImpl",
			"configureGitImpl",
			"configureBrowserIntegrationImpl",
			"configureAudioImpl",
			"configureBashImpl",
			"configureFastfetchImpl",
			"configureKittyImpl",
			"runCommandImpl",
			"enableServicesImpl",
			"configureClaudeImpl",
			"installGhStackImpl",
			"configureClaudeStayAwakeImpl",
			"configureClaudeRemoteControlImpl",
			"configurePrWatchImpl",
			"syncWorktreeCleanupImpl",
			"configureCodexImpl",
			"configureSkillsImpl",
			"configureTailscaleImpl",
		],
	],
	[
		"configureBrowser" + "Integration",
		[
			"configureChromiumProfilesImpl",
			"configureMimeappsImpl",
			"installUserScriptsImpl",
		],
	],
]);

const GUARDED_ENTRY_POINTS = new Map([
	["runCachyOS" + "Setup", runCachyOSSetup],
	["configureUser" + "Apps", configureUserApps],
	["configureBrowser" + "Integration", configureBrowserIntegration],
]);

function matchingDelimiter(source, openingIndex, opening, closing) {
	let depth = 0;
	let quote = null;
	let escaped = false;
	for (let index = openingIndex; index < source.length; index += 1) {
		const character = source[index];
		if (quote) {
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === quote) quote = null;
			continue;
		}
		if (character === '"' || character === "'" || character === "`") {
			quote = character;
			continue;
		}
		if (character === opening) depth += 1;
		else if (character === closing && --depth === 0) return index;
	}
	return -1;
}

function callSites(source, entryPoint) {
	const calls = [];
	const pattern = new RegExp(`\\b${entryPoint}\\s*\\(`, "g");
	for (const match of source.matchAll(pattern)) {
		const openingIndex = source.indexOf("(", match.index);
		const closingIndex = matchingDelimiter(source, openingIndex, "(", ")");
		if (closingIndex === -1) continue;
		calls.push({
			argumentsSource: source.slice(openingIndex + 1, closingIndex),
			line: source.slice(0, match.index).split("\n").length,
		});
	}
	return calls;
}

function functionBody(source, functionName) {
	const declaration = new RegExp(`\\bfunction\\s+${functionName}\\s*\\(`).exec(
		source,
	);
	if (!declaration) return "";
	const parametersStart = source.indexOf("(", declaration.index);
	const parametersEnd = matchingDelimiter(source, parametersStart, "(", ")");
	const bodyStart = source.indexOf("{", parametersEnd);
	const bodyEnd = matchingDelimiter(source, bodyStart, "{", "}");
	return bodyEnd === -1 ? "" : source.slice(bodyStart + 1, bodyEnd);
}

function providedOptions(source, argumentsSource, requiredOptions) {
	const searchableSources = [argumentsSource];
	for (const [, helperName] of argumentsSource.matchAll(
		/\b([A-Za-z_$][\w$]*)\s*\(/g,
	)) {
		const body = functionBody(source, helperName);
		if (body) searchableSources.push(body);
	}
	return requiredOptions.filter((option) =>
		searchableSources.some((candidate) =>
			new RegExp(`(?:^|[,{]\\s*)${option}\\s*(?=[:,}])`, "m").test(candidate),
		),
	);
}

function testCallerViolations() {
	const violations = [];
	const testFiles = fs
		.readdirSync(import.meta.dir)
		.filter((file) => file.endsWith(".test.js"))
		.sort();

	for (const file of testFiles) {
		const source = fs.readFileSync(path.join(import.meta.dir, file), "utf8");
		for (const [entryPoint, requiredOptions] of TEST_CALLER_CONTRACTS) {
			for (const call of callSites(source, entryPoint)) {
				const provided = new Set(
					providedOptions(source, call.argumentsSource, requiredOptions),
				);
				const missing = requiredOptions.filter(
					(option) => !provided.has(option),
				);
				if (missing.length > 0) {
					violations.push({ file, line: call.line, entryPoint, missing });
				}
			}
		}
	}
	return violations;
}

function injectableOptions(entryPoint) {
	const source = entryPoint.toString();
	const signature = source.slice(0, source.indexOf("} = {})"));
	return [
		...new Set(
			[...signature.matchAll(/\b([A-Za-z]\w+Impl)\b/g)].map(([, name]) => name),
		),
	];
}

function defaultRunContract() {
	const source = runCachyOSSetup.toString();
	const signatureEnd = source.indexOf("} = {})");
	const signature = source.slice(0, signatureEnd);
	const body = source.slice(signatureEnd);
	return {
		options: [...signature.matchAll(/\b([A-Za-z]\w+Impl)\s*=/g)].map(
			([, name]) => name,
		),
		awaitedSteps: [...body.matchAll(/\bawait\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(
			([, name]) => name,
		),
	};
}

it("keeps the default Omarchy run behind explicit injectable side-effect seams", async () => {
	expect(defaultRunContract()).toEqual({
		options: EXPECTED_OPTIONS,
		awaitedSteps: EXPECTED_AWAITED_STEPS,
	});

	const calls = [];
	const record = (name, result) => async () => {
		calls.push(name);
		return result;
	};
	const startedAt = performance.now();
	const result = await runCachyOSSetup({
		promptDeviceTypeImpl: record("deviceType"),
		startSudoSessionImpl: record("sudoSession", () => calls.push("sudoStop")),
		prepareArchPackageManagerImpl: record("packageManager", true),
		ensureRustToolchainImpl: record("rust"),
		ensureAurHelperImpl: record("aurHelper", "paru"),
		installDevToolsImpl: record("devTools"),
		commandExistsImpl: record("commandExists", true),
		installSystemPackagesImpl: record("systemPackages"),
		installFlatpakAppsImpl: record("flatpaks"),
		configureUserAppsImpl: record("userApps"),
		configureBraveManagedPoliciesImpl: record("bravePolicies", true),
		configureHyprmoncfgImpl: record("hyprmoncfg"),
		configureOmarchyWorkspacesImpl: record("workspaces"),
		configureOmarchyPluginsImpl: record("plugins"),
		configureKdeConnectCommandsImpl: record("kdeConnectCommands"),
		configureOmarchyBarImpl: record("bar"),
		configureOmazedImpl: record("omazed"),
		configureOmarchyAppearanceImpl: record("appearance"),
	});

	expect(result).toBe(true);
	expect(performance.now() - startedAt).toBeLessThan(250);
	expect(calls).toEqual([
		"deviceType",
		"sudoSession",
		"commandExists",
		"packageManager",
		"rust",
		"aurHelper",
		"devTools",
		"systemPackages",
		"flatpaks",
		"userApps",
		"bravePolicies",
		"hyprmoncfg",
		"workspaces",
		"plugins",
		"kdeConnectCommands",
		"bar",
		"omazed",
		"appearance",
		"sudoStop",
	]);
});

it("requires every CachyOS test caller to inject all side-effecting implementations", () => {
	for (const [entryPoint, implementation] of GUARDED_ENTRY_POINTS) {
		expect(
			injectableOptions(implementation),
			`${entryPoint} injectable options drifted; update its caller contract`,
		).toEqual(TEST_CALLER_CONTRACTS.get(entryPoint));
	}

	const violations = testCallerViolations();
	const details = violations
		.map(
			({ file, line, entryPoint, missing }) =>
				`${file}:${line} ${entryPoint} missing ${missing.join(", ")}`,
		)
		.join("\n");
	expect(
		violations,
		`CachyOS test callers reached real side-effect defaults:\n${details}`,
	).toEqual([]);
});
