import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	checkAxstack,
	configureAxstack as runConfigureAxstack,
} from "../src/helpers/configure_axstack.js";

import { startRunLog } from "../src/common/run_log.js";

const LATEST_VERSION = "0.24.7";
const REGISTRY_URL = "https://registry.npmjs.org/axstack/latest";
const homes = [];

function configureAxstack(options) {
	return runConfigureAxstack({
		bunPath: "/test/bin/bun",
		detectOS: () => "debian-server",
		which: () => null,
		nightlyExists: false,
		fetcher: registryFetcher(),
		...options,
	});
}

function registryFetcher(downloaded = fixture(), requests = []) {
	return async (url) => {
		requests.push(url);
		if (url === REGISTRY_URL) return Response.json(downloaded.metadata);
		if (url === downloaded.metadata.dist.tarball)
			return new Response(downloaded.archive);
		throw new Error(`unexpected URL: ${url}`);
	};
}

function makeHome() {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-axstack-"));
	homes.push(home);
	return home;
}

function fixture(bytes = "fixture axstack archive") {
	const archive = Buffer.from(bytes);
	return {
		archive,
		metadata: {
			version: LATEST_VERSION,
			dist: {
				tarball: `https://registry.npmjs.org/axstack/-/axstack-${LATEST_VERSION}.tgz`,
				integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`,
			},
		},
	};
}

function paths(home) {
	return {
		binDir: path.join(home, ".local", "bin"),
		dataDir: path.join(home, ".local", "share", "axstack"),
	};
}

function makeExtractor(calls) {
	return async (_archivePath, destination) => {
		calls.push(destination);
		const packageRoot = path.join(destination, "package");
		fs.mkdirSync(path.join(packageRoot, "bin"), { recursive: true });
		fs.writeFileSync(path.join(packageRoot, "bin", "axstack.js"), "cli");
		fs.writeFileSync(
			path.join(packageRoot, "package.json"),
			JSON.stringify({ version: LATEST_VERSION }),
		);
	};
}

function releasePaths(home, version = LATEST_VERSION) {
	const target = paths(home);
	const release = path.join(target.dataDir, "releases", version, "package");
	return {
		...target,
		cli: path.join(release, "bin", "axstack.js"),
		release,
		shim: path.join(target.binDir, "axstack"),
	};
}

afterEach(() => {
	for (const home of homes.splice(0)) {
		fs.rmSync(home, { force: true, recursive: true });
	}
});

describe("configureAxstack", () => {
	it.each([
		false,
		true,
	])("requires Bun before changing releases or shims (existing=%s)", async (existing) => {
		const home = makeHome();
		const target = releasePaths(home);
		const original = `#!/bin/sh\nexec bun '${target.cli}' "$@"\n`;
		if (existing) {
			fs.mkdirSync(target.binDir, { recursive: true });
			fs.writeFileSync(target.shim, original);
		}
		const requests = [];
		const invocations = [];
		const run = startRunLog({ env: { HOME: home, XDG_STATE_HOME: home } });
		const result = await configureAxstack({
			...target,
			home,
			bunPath: undefined,
			which: () => null,
			fetcher: registryFetcher(fixture(), requests),
			extractor: makeExtractor([]),
			runner: async (...args) => {
				invocations.push(args);
				return { exitCode: 0, stderr: "", stdout: "installed" };
			},
		});
		expect(result.ok).toBe(false);
		expect(result.harnesses.codex.reason).toContain("Bun required for Axstack");
		expect(requests).toEqual([]);
		expect(invocations).toEqual([]);
		expect(fs.existsSync(target.dataDir)).toBe(false);
		if (existing) expect(fs.readFileSync(target.shim, "utf8")).toBe(original);
		else expect(fs.existsSync(target.shim)).toBe(false);
		const summary = [];
		run.finish(0, (line) => summary.push(line));
		expect(summary.at(-1)).toContain("Bun required");
		expect(summary.at(-1)).toContain("haoshoku --axstack");
	});

	it.each([
		["arch", null, true, null, true],
		["arch", "/path/t3", true, null, false],
		["arch", null, false, null, false],
		["debian-server", null, true, null, false],
		["arch", null, true, "file", false],
		["arch", null, true, "dangling", false],
	])("T3 alias: OS=%s PATH=%s nightly=%s existing=%s", async (os, t3Path, nightlyExists, existing, created) => {
		const home = makeHome();
		const target = releasePaths(home);
		const alias = path.join(target.binDir, "t3");
		if (existing) {
			fs.mkdirSync(target.binDir, { recursive: true });
			if (existing === "file") fs.writeFileSync(alias, "user t3");
			else fs.symlinkSync("/missing/user-t3", alias);
		}
		const result = await configureAxstack({
			...target,
			home,
			detectOS: () => os,
			nightlyExists,
			which: () => t3Path,
			extractor: makeExtractor([]),
			runner: async () => {
				// The alias must be ready before the harness installer runs.
				if (created) expect(fs.readlinkSync(alias)).toBe("/usr/bin/t3-nightly");
				return { exitCode: 0, stderr: "", stdout: "installed" };
			},
		});
		expect(result.ok).toBe(true);
		if (created) expect(fs.readlinkSync(alias)).toBe("/usr/bin/t3-nightly");
		else if (existing === "file")
			expect(fs.readFileSync(alias, "utf8")).toBe("user t3");
		else if (existing === "dangling")
			expect(fs.readlinkSync(alias)).toBe("/missing/user-t3");
		else expect(fs.existsSync(alias)).toBe(false);
	});

	it.each([
		null,
		{},
		{ ...fixture().metadata, version: "../unsafe" },
		{
			...fixture().metadata,
			dist: {
				...fixture().metadata.dist,
				tarball: "http://example.com/archive",
			},
		},
		{
			...fixture().metadata,
			dist: { ...fixture().metadata.dist, integrity: "sha256-abcd" },
		},
		{
			...fixture().metadata,
			dist: { ...fixture().metadata.dist, integrity: "sha512-invalid" },
		},
	])("rejects malformed registry metadata %j without touching an existing shim", async (metadata) => {
		const home = makeHome();
		const target = releasePaths(home, "0.7.0");
		fs.mkdirSync(target.binDir, { recursive: true });
		fs.writeFileSync(target.shim, `exec bun "${target.cli}" "$@"\n`);
		const before = fs.readFileSync(target.shim);
		const requests = [];
		const result = await configureAxstack({
			...target,
			home,
			fetcher: async (url) => {
				requests.push(url);
				return Response.json(metadata);
			},
			extractor: async () => {
				throw new Error("must not extract");
			},
			runner: async () => {
				throw new Error("must not run");
			},
		});
		expect(result.ok).toBe(false);
		expect(result.harnesses.claude.reason).toContain("metadata");
		expect(requests).toEqual([REGISTRY_URL]);
		expect(fs.readFileSync(target.shim)).toEqual(before);
		expect(fs.existsSync(target.dataDir)).toBe(false);
	});

	it.each([
		"unreachable",
		"http",
		"json",
		"tarball",
	])("keeps an installed shim when the registry or tarball fails: %s", async (failure) => {
		const home = makeHome();
		const target = releasePaths(home, "0.7.0");
		fs.mkdirSync(target.binDir, { recursive: true });
		fs.writeFileSync(target.shim, `exec bun "${target.cli}" "$@"\n`);
		const before = fs.readFileSync(target.shim);
		const result = await configureAxstack({
			...target,
			home,
			fetcher: async (url) => {
				if (failure === "unreachable") throw new Error("registry unreachable");
				if (failure === "http") return new Response("", { status: 503 });
				if (failure === "json") return new Response("invalid json");
				return url === REGISTRY_URL
					? Response.json(fixture().metadata)
					: new Response("", { status: 404 });
			},
		});
		expect(result.ok).toBe(false);
		expect(fs.readFileSync(target.shim)).toEqual(before);
		expect(fs.existsSync(target.dataDir)).toBe(false);
	});

	it("rejects an integrity mismatch before writing the release or shim", async () => {
		const home = makeHome();
		const target = releasePaths(home, "0.7.0");
		const shimPath = target.shim;
		fs.mkdirSync(target.binDir, { recursive: true });
		fs.writeFileSync(
			shimPath,
			`#!/bin/sh\nexec bun ${JSON.stringify(target.cli)} "$@"\n`,
			{ mode: 0o755 },
		);
		const shimBefore = fs.readFileSync(shimPath);
		const result = await configureAxstack({
			...target,
			fetcher: registryFetcher({
				...fixture(),
				archive: Buffer.from("wrong archive"),
			}),
			extractor: async () => {
				throw new Error("must not extract");
			},
			home,
		});

		expect(result.ok).toBe(false);
		expect(result.release.version).toBe(LATEST_VERSION);
		expect(result.release.action).toBe("kept");
		expect(result.harnesses.claude.reason).toContain("integrity");
		expect(fs.existsSync(target.dataDir)).toBe(false);
		expect(fs.readFileSync(shimPath)).toEqual(shimBefore);
	});

	it("reports a download failure without writing the release or shim", async () => {
		const home = makeHome();
		const target = paths(home);
		const result = await configureAxstack({
			...target,
			fetcher: async () => {
				throw new Error("network unavailable");
			},
			home,
		});

		expect(result.ok).toBe(false);
		expect(result.harnesses.codex.reason).toBe("network unavailable");
		expect(fs.existsSync(target.dataDir)).toBe(false);
		expect(fs.existsSync(path.join(target.binDir, "axstack"))).toBe(false);
	});

	it("installs the verified release and invokes both harnesses with exact arguments", async () => {
		const home = makeHome();
		const target = releasePaths(home);
		const downloaded = fixture();
		const requests = [];
		const extracted = [];
		const invocations = [];
		const result = await configureAxstack({
			...target,
			bunPath: "/test/bin/bun",
			extractor: makeExtractor(extracted),
			fetcher: registryFetcher(downloaded, requests),
			home,
			runner: async (executable, args) => {
				invocations.push([executable, ...args]);
				return { exitCode: 0, stderr: "", stdout: "installed" };
			},
		});

		expect(result.ok).toBe(true);
		expect(result.release).toEqual({
			action: "installed",
			version: LATEST_VERSION,
		});
		expect(requests).toEqual([REGISTRY_URL, downloaded.metadata.dist.tarball]);
		expect(extracted).toHaveLength(1);
		expect(fs.existsSync(target.cli)).toBe(true);
		expect(fs.statSync(target.shim).mode & 0o777).toBe(0o755);
		expect(fs.readFileSync(target.shim, "utf8")).toBe(
			`#!/bin/sh\nexec '/test/bin/bun' '${target.cli}' "$@"\n`,
		);
		const common = [
			"/test/bin/bun",
			target.cli,
			"install",
			"--preset",
			"mixed",
			"--bundle",
			target.release,
			"--harness",
		];
		expect(invocations).toEqual([
			[...common, "claude", "--yes"],
			[...common, "codex", "--yes"],
		]);
	});

	it("removes stale staging directories and makes the release traversable", async () => {
		const home = makeHome();
		const target = releasePaths(home);
		const releasesDir = path.dirname(path.dirname(target.release));
		const stale = path.join(releasesDir, `.${LATEST_VERSION}-stale`);
		fs.mkdirSync(stale, { recursive: true });
		fs.writeFileSync(path.join(stale, "partial"), "interrupted");
		const downloaded = fixture();
		const result = await configureAxstack({
			...target,
			extractor: makeExtractor([]),
			fetcher: registryFetcher(downloaded),
			home,
			runner: async () => ({ exitCode: 0, stderr: "", stdout: "installed" }),
		});

		expect(result.ok).toBe(true);
		expect(fs.existsSync(stale)).toBe(false);
		expect(fs.statSync(path.dirname(target.release)).mode & 0o777).toBe(0o755);
	});

	it("keeps a newer shim target without downloading or extracting", async () => {
		const home = makeHome();
		const target = releasePaths(home, "0.25.0");
		fs.mkdirSync(target.binDir, { recursive: true });
		fs.writeFileSync(
			target.shim,
			`#!/bin/sh\nexec bun ${JSON.stringify(target.cli)} "$@"\n`,
		);
		const before = fs.readFileSync(target.shim);
		const requests = [];
		let ran = false;
		const result = await configureAxstack({
			...target,
			fetcher: registryFetcher(fixture(), requests),
			home,
			runner: async () => {
				ran = true;
			},
		});

		expect(result.release).toEqual({ action: "kept-newer", version: "0.25.0" });
		expect(requests).toEqual([REGISTRY_URL]);
		expect(ran).toBe(false);
		expect(fs.readFileSync(target.shim)).toEqual(before);
	});

	it("keeps a newer suffixed shim target without downloading", async () => {
		const home = makeHome();
		const target = releasePaths(home, "0.24.8-abc123");
		fs.mkdirSync(path.dirname(target.cli), { recursive: true });
		fs.mkdirSync(target.binDir, { recursive: true });
		fs.writeFileSync(
			path.join(target.release, "package.json"),
			JSON.stringify({ version: "0.24.8-abc123" }),
		);
		fs.writeFileSync(
			target.shim,
			`#!/bin/sh\nexec bun ${JSON.stringify(target.cli)} "$@"\n`,
		);
		const before = fs.readFileSync(target.shim);
		const requests = [];
		const result = await configureAxstack({
			...target,
			fetcher: registryFetcher(fixture(), requests),
			home,
		});

		expect(result.release).toEqual({
			action: "kept-newer",
			version: "0.24.8-abc123",
		});
		expect(requests).toEqual([REGISTRY_URL]);
		expect(fs.readFileSync(target.shim)).toEqual(before);
	});

	it("keeps a same-base suffixed build and reruns both harness installs", async () => {
		const home = makeHome();
		const target = releasePaths(home, `${LATEST_VERSION}-abc123`);
		fs.mkdirSync(path.dirname(target.cli), { recursive: true });
		fs.mkdirSync(target.binDir, { recursive: true });
		fs.writeFileSync(target.cli, "user-managed cli");
		fs.writeFileSync(
			path.join(target.release, "package.json"),
			JSON.stringify({ version: `${LATEST_VERSION}-abc123` }),
		);
		fs.writeFileSync(
			target.shim,
			`#!/bin/sh\nexec bun ${JSON.stringify(target.cli)} "$@"\n`,
		);
		const before = fs.readFileSync(target.shim);
		const invocations = [];
		const result = await configureAxstack({
			...target,
			fetcher: registryFetcher(),
			home,
			runner: async (_executable, args) => {
				invocations.push(args);
				return { exitCode: 0, stderr: "", stdout: "installed" };
			},
		});

		expect(result.release).toEqual({
			action: "kept-user-managed",
			version: `${LATEST_VERSION}-abc123`,
		});
		expect(invocations).toHaveLength(2);
		expect(invocations[0]).toContain(target.cli);
		expect(invocations[0]).toContain(target.release);
		expect(fs.readFileSync(target.shim)).toEqual(before);
	});

	it("keeps an unparsable existing shim and reports a failure", async () => {
		const home = makeHome();
		const target = releasePaths(home, "development");
		fs.mkdirSync(path.dirname(target.cli), { recursive: true });
		fs.mkdirSync(target.binDir, { recursive: true });
		fs.writeFileSync(
			path.join(target.release, "package.json"),
			JSON.stringify({ version: "development" }),
		);
		fs.writeFileSync(
			target.shim,
			`#!/bin/sh\nexec bun ${JSON.stringify(target.cli)} "$@"\n`,
		);
		const before = fs.readFileSync(target.shim);
		const requests = [];
		const result = await configureAxstack({
			...target,
			fetcher: registryFetcher(fixture(), requests),
			home,
		});

		expect(result.ok).toBe(false);
		expect(result.release.action).toBe("kept");
		expect(result.harnesses.claude.reason).toContain("unparsable");
		expect(requests).toEqual([]);
		expect(fs.readFileSync(target.shim)).toEqual(before);
	});

	it("reuses the same release bytes without extracting and reruns both harnesses", async () => {
		const home = makeHome();
		const target = releasePaths(home);
		fs.mkdirSync(path.dirname(target.cli), { recursive: true });
		fs.mkdirSync(target.binDir, { recursive: true });
		fs.writeFileSync(target.cli, "existing cli bytes");
		fs.writeFileSync(
			target.shim,
			`#!/bin/sh\nexec "/test/bin/bun" ${JSON.stringify(target.cli)} "$@"\n`,
			{ mode: 0o755 },
		);
		const before = fs.readFileSync(target.cli);
		let extractions = 0;
		const invocations = [];
		const result = await configureAxstack({
			...target,
			bunPath: "/test/bin/bun",
			extractor: async () => {
				extractions += 1;
			},
			fetcher: registryFetcher(),
			home,
			runner: async (_executable, args) => {
				invocations.push(args);
				return { exitCode: 0, stdout: "unchanged", stderr: "" };
			},
		});

		expect(result.release.action).toBe("kept");
		expect(extractions).toBe(0);
		expect(invocations).toHaveLength(2);
		expect(fs.readFileSync(target.cli)).toEqual(before);
	});

	it.each([
		{ failed: ["claude"] },
		{ failed: ["codex"] },
		{ failed: ["claude", "codex"] },
		{ failed: [] },
	])("summarizes only failed Axstack harnesses (%j) and attempts both", async ({
		failed,
	}) => {
		const home = makeHome();
		const target = releasePaths(home);
		fs.mkdirSync(path.dirname(target.cli), { recursive: true });
		fs.writeFileSync(target.cli, "existing");
		const run = startRunLog({ env: { HOME: home, XDG_STATE_HOME: home } });
		const harnesses = [];
		const result = await configureAxstack({
			...target,
			home,
			runner: async (_executable, args) => {
				const harness = args[args.indexOf("--harness") + 1];
				harnesses.push(harness);
				return failed.includes(harness)
					? {
							exitCode: 1,
							stderr: `${harness} instruction conflict`,
							stdout: "",
						}
					: { exitCode: 0, stderr: "", stdout: "installed" };
			},
		});
		expect(harnesses).toEqual(["claude", "codex"]);
		expect(result.ok).toBe(failed.length === 0);
		const summary = [];
		run.finish(0, (line) => summary.push(line));
		const nextSteps = summary.slice(1).join("\n");
		if (failed.length === 0) expect(nextSteps).toBe("");
		else {
			expect(nextSteps).toContain("Next steps:");
			expect(nextSteps.match(/haoshoku --axstack/g)).toHaveLength(1);
			for (const harness of ["claude", "codex"]) {
				expect(result.harnesses[harness].ok).toBe(!failed.includes(harness));
				if (failed.includes(harness))
					expect(nextSteps).toContain(`${harness} instruction conflict`);
				else expect(nextSteps).not.toContain(`${harness} instruction conflict`);
			}
		}
	});
});

describe("checkAxstack", () => {
	it.each([
		false,
		true,
	])("roles presence %s is report-only and does not gate ok", async (present) => {
		const home = makeHome();
		const target = releasePaths(home);
		fs.mkdirSync(target.binDir, { recursive: true });
		fs.writeFileSync(target.shim, `exec bun "${target.cli}" "$@"\n`);
		for (const harness of [".claude", ".agents"]) {
			if (present) {
				const rolesPath = path.join(home, harness, "skills/axstack/roles.json");
				fs.mkdirSync(path.dirname(rolesPath), { recursive: true });
				fs.writeFileSync(rolesPath, "roles fixture");
			}
		}
		const report = await checkAxstack({
			...target,
			home,
			runner: async () => ({ exitCode: 0, stderr: "", stdout: "ok" }),
		});
		expect(report.ok).toBe(true);
		for (const harness of ["claude", "codex"]) {
			expect(report.roles[harness].present).toBe(present);
			expect(fs.existsSync(report.roles[harness].path)).toBe(present);
			if (present)
				expect(fs.readFileSync(report.roles[harness].path, "utf8")).toBe(
					"roles fixture",
				);
		}
	});

	it("checks harnesses against the bundle targeted by the shim", async () => {
		const home = makeHome();
		const target = paths(home);
		const release = path.join(
			home,
			"custom-axstack",
			"releases",
			LATEST_VERSION,
			"package",
		);
		const cli = path.join(release, "bin", "axstack.js");
		const shim = path.join(target.binDir, "axstack");
		fs.mkdirSync(target.binDir, { recursive: true });
		fs.writeFileSync(shim, `exec bun ${JSON.stringify(cli)} "$@"\n`);
		const calls = [];
		await checkAxstack({
			...target,
			home,
			runner: async (_executable, args) => {
				calls.push(args);
				return { exitCode: 0, stderr: "", stdout: "ok" };
			},
		});

		expect(calls).toHaveLength(3);
		expect(calls[1]).toContain(release);
		expect(calls[2]).toContain(release);
	});

	it("skips every command when the shim is missing", async () => {
		const home = makeHome();
		let ran = false;
		const report = await checkAxstack({
			...paths(home),
			home,
			runner: async () => {
				ran = true;
			},
		});

		expect(ran).toBe(false);
		expect(report.version.reason).toBe("shim missing");
		expect(report.harnesses.claude.reason).toBe("shim missing");
	});

	it("skips every command when the shim is unparsable", async () => {
		const home = makeHome();
		const target = paths(home);
		const shim = path.join(target.binDir, "axstack");
		fs.mkdirSync(target.binDir, { recursive: true });
		fs.writeFileSync(shim, "#!/bin/sh\nexit 7\n");
		let ran = false;
		const report = await checkAxstack({
			...target,
			home,
			runner: async () => {
				ran = true;
			},
		});

		expect(ran).toBe(false);
		expect(report.version.reason).toBe("shim unparsable");
		expect(report.harnesses.codex.reason).toBe("shim unparsable");
	});

	it("reports shim, version, harness, and roles readback independently", async () => {
		const home = makeHome();
		const target = releasePaths(home);
		fs.mkdirSync(target.binDir, { recursive: true });
		fs.mkdirSync(path.join(home, ".claude/skills/axstack"), {
			recursive: true,
		});
		fs.writeFileSync(target.shim, `exec bun ${target.cli} "$@"\n`);
		fs.writeFileSync(
			path.join(home, ".claude/skills/axstack/roles.json"),
			"{}",
		);
		const calls = [];
		const report = await checkAxstack({
			...target,
			home,
			runner: async (_executable, args) => {
				calls.push(args);
				if (args[0] === "--version") {
					return {
						exitCode: 0,
						stderr: "",
						stdout: `axstack ${LATEST_VERSION}\n`,
					};
				}
				const harness = args.at(-1);
				return {
					exitCode: harness === "claude" ? 0 : 1,
					stderr: harness === "codex" ? "instruction missing" : "",
					stdout: harness === "claude" ? "skills ok; instruction owned" : "",
				};
			},
		});

		expect(report.shim).toEqual({
			path: target.shim,
			present: true,
			version: LATEST_VERSION,
		});
		expect(report.version).toEqual({
			ok: true,
			reason: `axstack ${LATEST_VERSION}`,
		});
		expect(report.harnesses.claude.reason).toContain("instruction owned");
		expect(report.harnesses.codex).toEqual({
			ok: false,
			reason: "instruction missing",
		});
		expect(report.roles).toEqual({
			claude: {
				path: path.join(home, ".claude/skills/axstack/roles.json"),
				present: true,
			},
			codex: {
				path: path.join(home, ".agents/skills/axstack/roles.json"),
				present: false,
			},
		});
		expect(report.lines).toHaveLength(6);
		expect(report.lines[4]).toContain(report.roles.claude.path);
		expect(report.lines[5]).toContain(report.roles.codex.path);
		expect(calls).toHaveLength(3);
	});
});
