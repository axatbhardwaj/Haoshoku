import { expect, test } from "bun:test";
import { ensureTailscaleOperator } from "../src/helpers/t3_tailscale.js";

function fixture(initial, verified = '{"OperatorUser":"xzat"}') {
	let output = initial;
	const events = [];
	const warnings = [];
	return {
		events,
		warnings,
		options: {
			user: "xzat",
			probe: async (command) => {
				events.push(command);
				return output;
			},
			runCommandImpl: async (command) => {
				events.push(command);
				output = verified;
				return true;
			},
			logger: { warning: (message) => warnings.push(message) },
		},
	};
}

test.each([
	"{}",
	'{"OperatorUser":""}',
])("sets and verifies an unset operator from %s", async (prefs) => {
	const f = fixture(prefs);
	expect(await ensureTailscaleOperator(f.options)).toBe(true);
	expect(f.events).toEqual([
		"tailscale debug prefs",
		"sudo -n tailscale set --operator='xzat'",
		"tailscale debug prefs",
	]);
	expect(f.warnings).toEqual([]);
});

test("keeps a matching operator without setting it", async () => {
	const f = fixture('{"OperatorUser":"xzat"}');
	expect(await ensureTailscaleOperator(f.options)).toBe(true);
	expect(f.events).toEqual(["tailscale debug prefs"]);
	expect(f.warnings).toEqual([]);
});

test.each([
	"not json",
	"null",
	"[]",
	"true",
	'{"OperatorUser":42}',
])("refuses unverifiable operator preferences %s", async (prefs) => {
	const f = fixture(prefs);
	expect(await ensureTailscaleOperator(f.options)).toBe(false);
	expect(f.events).toEqual(["tailscale debug prefs"]);
	expect(f.warnings).toHaveLength(1);
	expect(f.warnings[0]).toContain(
		"Cannot verify Tailscale operator preferences",
	);
});

test.each([
	"{}",
	'{"OperatorUser":""}',
	'{"OperatorUser":"other"}',
	"not json",
])("does not claim operator access when the set is not verified: %s", async (verified) => {
	const f = fixture('{"OperatorUser":""}', verified);
	expect(await ensureTailscaleOperator(f.options)).toBe(false);
	expect(f.events).toHaveLength(3);
	expect(f.warnings).toHaveLength(1);
	expect(f.warnings[0]).toContain("Cannot verify Tailscale operator");
	expect(f.warnings[0]).toContain("haoshoku --server-t3-code");
});

test("reports a failed sudo set with the exact retry hint", async () => {
	const f = fixture("{}");
	f.options.runCommandImpl = async () => false;
	f.options.retryFlag = "--tailscale-t3";
	expect(await ensureTailscaleOperator(f.options)).toBe(false);
	expect(f.events).toEqual(["tailscale debug prefs"]);
	expect(f.warnings).toHaveLength(1);
	expect(f.warnings[0]).toContain("Cannot set Tailscale operator to xzat");
	expect(f.warnings[0]).toContain("sudo tailscale set --operator='xzat'");
	expect(f.warnings[0]).toContain("haoshoku --tailscale-t3");
});
