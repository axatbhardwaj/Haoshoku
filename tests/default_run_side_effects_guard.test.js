import { expect, it } from "bun:test";

import { runCachyOSSetup } from "../src/os_scripts/cachyos.js";

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
	"configureOmazedImpl",
];

const EXPECTED_AWAITED_STEPS = [
	"promptDeviceTypeImpl",
	"prepareArchPackageManagerImpl",
	"ensureRustToolchainImpl",
	"ensureAurHelperImpl",
	"installDevToolsImpl",
	"commandExistsImpl",
	"installSystemPackagesImpl",
	"installFlatpakAppsImpl",
	"configureUserAppsImpl",
	"configureBraveManagedPolicies",
	"configureHyprmoncfg",
	"configureOmarchyWorkspaces",
	"configureOmarchyPlugins",
	"configureOmazed",
];

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
		configureOmazedImpl: record("omazed"),
	});

	expect(result).toBe(true);
	expect(performance.now() - startedAt).toBeLessThan(250);
	expect(calls).toEqual([
		"deviceType",
		"packageManager",
		"rust",
		"aurHelper",
		"devTools",
		"commandExists",
		"systemPackages",
		"flatpaks",
		"userApps",
		"bravePolicies",
		"hyprmoncfg",
		"workspaces",
		"plugins",
		"omazed",
	]);
});
