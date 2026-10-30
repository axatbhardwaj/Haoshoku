import { beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import * as routing from "../src/helpers/configure_fleet_routing.js";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = fs.readFileSync(
	new URL("../configs/fleet-routing.json", import.meta.url),
);
let home;
let source;
let target;
beforeEach(() => {
	home = fs.mkdtempSync(path.join(os.homedir(), "fleet-policy-"));
	source = path.join(home, "source.json");
	target = path.join(home, ".config/haoshoku/fleet-routing.json");
	fs.writeFileSync(source, canonical);
});
const deploy = (options = {}) =>
	routing.deployFleetRouting({ home, source, ...options });

it("accepts evidence-shaped local facts without claiming remote author proof", () => {
	const config = JSON.parse(canonical);
	const host = config.hosts[0];
	const evidence = {
		environmentId: host.environmentId,
		pointer: "axat-vps:fixture-only",
		observedAt: 1,
	};
	host.capabilities["worktree-isolation"] = { value: true, evidence };
	const local = config.routes.find(
		(r) => r.kind === "local" && r.environmentId === host.environmentId,
	);
	local.enabled = true;
	local.evidence = evidence;
	fs.writeFileSync(source, JSON.stringify(config));
	expect(deploy().ok).toBe(true);
	expect(JSON.parse(fs.readFileSync(target)).hosts[0].capabilities).toEqual(
		host.capabilities,
	);
});

it("refuses a symlink destination without changing the referred file", () => {
	fs.mkdirSync(path.dirname(target), { recursive: true });
	const unrelated = path.join(home, "unrelated.json");
	fs.writeFileSync(unrelated, "private fixture");
	fs.symlinkSync(unrelated, target);
	expect(() =>
		deploy({ expectedPreviousDigest: digest("private fixture") }),
	).toThrow("symlink");
	expect(fs.readFileSync(unrelated, "utf8")).toBe("private fixture");
	expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
});

it("refuses a symlink parent without writing outside the account", () => {
	const elsewhere = path.join(home, "elsewhere");
	fs.mkdirSync(elsewhere);
	fs.symlinkSync(elsewhere, path.join(home, ".config"));
	expect(() => deploy()).toThrow("symlink");
	expect(fs.readdirSync(elsewhere)).toEqual([]);
});

it("backs up inspected bytes and rolls back only its own deployment", () => {
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, "previous policy", { mode: 0o640 });
	expect(() => deploy()).toThrow("local-conflict");
	const receipt = deploy({ expectedPreviousDigest: digest("previous policy") });
	expect(fs.readFileSync(receipt.backup, "utf8")).toBe("previous policy");
	expect(fs.statSync(receipt.backup).mode & 0o777).toBe(0o600);
	expect(deploy({ rollback: receipt }).ok).toBe(true);
	expect(fs.readFileSync(target, "utf8")).toBe("previous policy");
	expect(fs.statSync(target).mode & 0o777).toBe(0o640);
});

it("fresh rollback refuses subsequent edits and removes only unchanged owned bytes", () => {
	const receipt = deploy();
	fs.writeFileSync(target, "subsequent edit");
	expect(() => deploy({ rollback: receipt })).toThrow("changed");
	expect(fs.readFileSync(target, "utf8")).toBe("subsequent edit");
	fs.writeFileSync(target, canonical);
	expect(deploy({ rollback: receipt }).ok).toBe(true);
	expect(fs.existsSync(target)).toBe(false);
	expect(fs.readFileSync(source)).toEqual(canonical);
});

describe("validation before deployment", () => {
	it.each([
		[
			"unknown schema field",
			(c) => {
				c.hosts[0].capabilities["browser:headed"] = {
					value: null,
					evidence: null,
					token: "private fixture",
				};
			},
		],
		[
			"schema version",
			(c) => {
				c.schemaVersion = 2;
			},
		],
		[
			"invalid threshold",
			(c) => {
				c.balanceLimitBp = 10001;
			},
		],
		[
			"duplicate host",
			(c) => {
				c.hosts.push(c.hosts[0]);
			},
		],
		[
			"unknown pool",
			(c) => {
				c.pool.push("unknown");
			},
		],
		[
			"incomplete task order",
			(c) => {
				c.taskOrders.playwright.pop();
			},
		],
		[
			"route identity",
			(c) => {
				c.routes[0].environmentId = "unknown";
			},
		],
		[
			"secret",
			(c) => {
				c.apiKey = "private fixture";
			},
		],
		[
			"settings",
			(c) => {
				c.hosts[0].settings = { token: "private fixture" };
			},
		],
		[
			"live load",
			(c) => {
				c.telemetry = [];
			},
		],
		[
			"session contents",
			(c) => {
				c.hosts[0].capabilities.auth = {
					value: true,
					session: "private fixture",
				};
			},
		],
	])("rejects %s without touching existing bytes", (_name, mutate) => {
		deploy();
		const config = JSON.parse(canonical);
		mutate(config);
		fs.writeFileSync(source, JSON.stringify(config));
		expect(() => deploy()).toThrow("fleet-config-schema");
		expect(fs.readFileSync(target)).toEqual(canonical);
	});

	it("rejects digest mismatch and malformed JSON before creating the destination", () => {
		expect(() => deploy({ expectedDigest: "0".repeat(64) })).toThrow(
			"digest-mismatch",
		);
		fs.writeFileSync(source, "{");
		expect(() => deploy()).toThrow();
		expect(fs.existsSync(target)).toBe(false);
	});

	it("reruns without backups or inode churn and returns the content digest", () => {
		const receipt = deploy({ expectedDigest: digest(canonical) });
		const inode = fs.statSync(target).ino;
		expect(deploy()).toMatchObject({
			ok: true,
			changed: false,
			sha256: receipt.sha256,
		});
		expect(fs.statSync(target).ino).toBe(inode);
		expect(fs.readdirSync(path.dirname(target))).toEqual([
			"fleet-routing.json",
		]);
	});
});

it("reports invalid JSON without exposing its contents", () => {
	fs.writeFileSync(source, "sensitivevalue");
	let reason;
	try {
		deploy();
	} catch (error) {
		reason = error.message;
	}
	expect(reason).toContain("fleet-config-json");
	expect(reason).not.toContain("sensitivevalue");
	expect(fs.existsSync(target)).toBe(false);
});
