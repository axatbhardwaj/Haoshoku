import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	AXSTACK_VERSION,
	checkAxstack,
	configureAxstack,
} from "../src/helpers/configure_axstack.js";

const homes = [];

function makeHome() {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-axstack-"));
	homes.push(home);
	return home;
}

function fixture(bytes = "fixture axstack archive") {
	const archive = Buffer.from(bytes);
	return {
		archive,
		sha256: createHash("sha256").update(archive).digest("hex"),
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
			JSON.stringify({ version: AXSTACK_VERSION }),
		);
	};
}

function releasePaths(home, version = AXSTACK_VERSION) {
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
	it("rejects a checksum mismatch before writing the release or shim", async () => {
		const home = makeHome();
		const target = paths(home);
		const shimPath = path.join(target.binDir, "axstack");
		fs.mkdirSync(target.binDir, { recursive: true });
		fs.writeFileSync(shimPath, "#!/bin/sh\nexit 7\n", { mode: 0o755 });
		const shimBefore = fs.readFileSync(shimPath);
		const result = await configureAxstack({
			...target,
			fetcher: async () => new Response("wrong archive"),
			home,
		});

		expect(result.ok).toBe(false);
		expect(result.release.version).toBe(AXSTACK_VERSION);
		expect(result.release.action).toBe("kept");
		expect(result.harnesses.claude.reason).toContain("checksum");
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
		const extracted = [];
		const invocations = [];
		const result = await configureAxstack({
			...target,
			bunPath: "/test/bin/bun",
			extractor: makeExtractor(extracted),
			fetcher: async () => new Response(downloaded.archive),
			home,
			runner: async (executable, args) => {
				invocations.push([executable, ...args]);
				return { exitCode: 0, stderr: "", stdout: "installed" };
			},
			sha256: downloaded.sha256,
		});

		expect(result.ok).toBe(true);
		expect(result.release).toEqual({ action: "installed", version: "0.8.0" });
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

	it("keeps a newer shim target without downloading or extracting", async () => {
		const home = makeHome();
		const target = releasePaths(home, "0.9.0");
		fs.mkdirSync(target.binDir, { recursive: true });
		fs.writeFileSync(
			target.shim,
			`#!/bin/sh\nexec bun ${JSON.stringify(target.cli)} "$@"\n`,
		);
		const before = fs.readFileSync(target.shim);
		let downloaded = false;
		let ran = false;
		const result = await configureAxstack({
			...target,
			fetcher: async () => {
				downloaded = true;
			},
			home,
			runner: async () => {
				ran = true;
			},
		});

		expect(result.release).toEqual({ action: "kept-newer", version: "0.9.0" });
		expect(downloaded).toBe(false);
		expect(ran).toBe(false);
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
			fetcher: async () => {
				throw new Error("must not download");
			},
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

	it("reports one harness conflict and still attempts the other", async () => {
		const home = makeHome();
		const target = releasePaths(home);
		fs.mkdirSync(path.dirname(target.cli), { recursive: true });
		fs.writeFileSync(target.cli, "existing");
		const harnesses = [];
		const result = await configureAxstack({
			...target,
			home,
			runner: async (_executable, args) => {
				const harness = args[args.indexOf("--harness") + 1];
				harnesses.push(harness);
				return harness === "claude"
					? { exitCode: 1, stderr: "instruction conflict", stdout: "" }
					: { exitCode: 0, stderr: "", stdout: "installed" };
			},
		});

		expect(harnesses).toEqual(["claude", "codex"]);
		expect(result.ok).toBe(false);
		expect(result.harnesses.claude).toEqual({
			ok: false,
			reason: "instruction conflict",
		});
		expect(result.harnesses.codex.ok).toBe(true);
	});
});

describe("checkAxstack", () => {
	it("reports shim, version, harness, and profile readback independently", async () => {
		const home = makeHome();
		const target = releasePaths(home);
		fs.mkdirSync(target.binDir, { recursive: true });
		fs.mkdirSync(path.join(home, ".paseo"), { recursive: true });
		fs.writeFileSync(target.shim, `exec bun ${target.cli} "$@"\n`);
		fs.writeFileSync(path.join(home, ".paseo", "config.json"), "{}");
		const calls = [];
		const report = await checkAxstack({
			...target,
			home,
			runner: async (_executable, args) => {
				calls.push(args);
				if (args[0] === "--version") {
					return { exitCode: 0, stderr: "", stdout: "axstack 0.8.0\n" };
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
			version: "0.8.0",
		});
		expect(report.version).toEqual({ ok: true, reason: "axstack 0.8.0" });
		expect(report.harnesses.claude.reason).toContain("instruction owned");
		expect(report.harnesses.codex).toEqual({
			ok: false,
			reason: "instruction missing",
		});
		expect(report.profile.present).toBe(true);
		expect(report.lines).toHaveLength(5);
		expect(calls).toHaveLength(3);
	});
});
