import { createHash } from "node:crypto";
import fs from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { log } from "../common/utils.js";

export const AXSTACK_VERSION = "0.8.0";
export const AXSTACK_ASSET_URL =
	"https://github.com/axatbhardwaj/axstack/releases/download/v0.8.0/axstack-0.8.0.tgz";
export const AXSTACK_SHA256 =
	"f08737a9e95d67afb66d2e594040291e501e921639b4911920e8c013ad020500";

function commandReason(result) {
	return (
		result.stderr?.trim() ||
		result.stdout?.trim() ||
		`Axstack exited with status ${result.exitCode}`
	);
}

async function defaultRunner(executable, args, options = {}) {
	const child = Bun.spawnSync([executable, ...args], {
		env: options.env ?? process.env,
		stderr: "pipe",
		stdout: "pipe",
	});
	return {
		exitCode: child.exitCode,
		stderr: new TextDecoder().decode(child.stderr),
		stdout: new TextDecoder().decode(child.stdout),
	};
}

async function defaultExtractor(archivePath, destination) {
	const child = Bun.spawnSync(["tar", "-xzf", archivePath, "-C", destination], {
		stderr: "pipe",
		stdout: "pipe",
	});
	if (child.exitCode !== 0) {
		throw new Error(
			new TextDecoder().decode(child.stderr).trim() || "tar failed",
		);
	}
}

function releaseVersionFromShim(shimPath) {
	try {
		const content = fs.readFileSync(shimPath, "utf8");
		const pathVersion = content.match(
			/\/releases\/([^/]+)\/package\/bin\/axstack\.js/,
		)?.[1];
		if (pathVersion) return pathVersion;
		const cliPath = content.match(
			/["']?(\/[^"'\n]*\/package\/bin\/axstack\.js)["']?/,
		)?.[1];
		if (!cliPath) return null;
		const packageJson = path.join(
			path.dirname(path.dirname(cliPath)),
			"package.json",
		);
		return JSON.parse(fs.readFileSync(packageJson, "utf8")).version ?? null;
	} catch {
		return null;
	}
}

function compareVersions(left, right) {
	const a = left.split(".").map(Number);
	const b = right.split(".").map(Number);
	for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
		const difference = (a[i] ?? 0) - (b[i] ?? 0);
		if (difference !== 0) return Math.sign(difference);
	}
	return 0;
}

function shellQuote(value) {
	return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function atomicWriteShim(shimPath, content) {
	fs.mkdirSync(path.dirname(shimPath), { recursive: true });
	const temporary = path.join(
		path.dirname(shimPath),
		`.axstack-${process.pid}-${crypto.randomUUID()}`,
	);
	try {
		fs.writeFileSync(temporary, content, { mode: 0o755 });
		fs.chmodSync(temporary, 0o755);
		fs.renameSync(temporary, shimPath);
	} finally {
		fs.rmSync(temporary, { force: true });
	}
}

function failedResult(reason, action = "kept") {
	return {
		harnesses: {
			claude: { ok: false, reason },
			codex: { ok: false, reason },
		},
		ok: false,
		release: { action, version: AXSTACK_VERSION },
	};
}

export async function configureAxstack(options = {}) {
	const home = options.home ?? homedir();
	const dataDir = options.dataDir ?? path.join(home, ".local/share/axstack");
	const binDir = options.binDir ?? path.join(home, ".local/bin");
	const fetcher = options.fetcher ?? fetch;
	const extractor = options.extractor ?? defaultExtractor;
	const runner = options.runner ?? defaultRunner;
	const expectedSha256 = options.sha256 ?? AXSTACK_SHA256;
	const bunPath = options.bunPath ?? Bun.which("bun") ?? process.execPath;
	const shimPath = path.join(binDir, "axstack");
	const installedVersion = releaseVersionFromShim(shimPath);

	if (
		installedVersion &&
		compareVersions(installedVersion, AXSTACK_VERSION) > 0
	) {
		const reason = `kept newer ${installedVersion}`;
		log.info(`Axstack: ${reason}.`);
		return {
			harnesses: {
				claude: { ok: true, reason },
				codex: { ok: true, reason },
			},
			ok: true,
			release: { action: "kept-newer", version: installedVersion },
		};
	}

	const releaseRoot = path.join(dataDir, "releases", AXSTACK_VERSION);
	let releaseAction = "kept";
	if (!fs.existsSync(path.join(releaseRoot, "package"))) {
		const downloadDir = fs.mkdtempSync(
			path.join(options.tempDir ?? tmpdir(), "haoshoku-axstack-"),
		);
		try {
			const response = await fetcher(AXSTACK_ASSET_URL);
			if (!response?.ok) {
				throw new Error(
					`download failed (${response?.status ?? "no response"})`,
				);
			}
			const archive = Buffer.from(await response.arrayBuffer());
			const actual = createHash("sha256").update(archive).digest("hex");
			if (actual !== expectedSha256) {
				throw new Error(
					`checksum mismatch: expected ${expectedSha256}, got ${actual}`,
				);
			}

			const archivePath = path.join(downloadDir, "axstack.tgz");
			fs.writeFileSync(archivePath, archive);
			fs.mkdirSync(path.dirname(releaseRoot), { recursive: true });
			const staging = fs.mkdtempSync(
				path.join(path.dirname(releaseRoot), `.${AXSTACK_VERSION}-`),
			);
			try {
				await extractor(archivePath, staging);
				if (
					!fs.existsSync(path.join(staging, "package", "bin", "axstack.js"))
				) {
					throw new Error("archive is missing package/bin/axstack.js");
				}
				fs.renameSync(staging, releaseRoot);
				releaseAction = "installed";
			} finally {
				fs.rmSync(staging, { force: true, recursive: true });
			}
		} catch (error) {
			const reason = error?.message ?? String(error);
			log.error(`Axstack setup failed: ${reason}`);
			return failedResult(reason);
		} finally {
			fs.rmSync(downloadDir, { force: true, recursive: true });
		}
	}

	const cliPath = path.join(releaseRoot, "package", "bin", "axstack.js");
	try {
		atomicWriteShim(
			shimPath,
			`#!/bin/sh\nexec ${shellQuote(bunPath)} ${shellQuote(cliPath)} "$@"\n`,
		);
	} catch (error) {
		const reason = `shim installation failed: ${error?.message ?? error}`;
		log.error(`Axstack setup failed: ${reason}`);
		return failedResult(reason, releaseAction);
	}
	const harnesses = {};
	for (const harness of ["claude", "codex"]) {
		const args = [
			cliPath,
			"install",
			"--preset",
			"mixed",
			"--bundle",
			path.join(releaseRoot, "package"),
			"--harness",
			harness,
			"--no-claude-settings",
			"--yes",
		];
		let result;
		try {
			result = await runner(bunPath, args, {
				env: { ...process.env, HOME: home },
			});
		} catch (error) {
			result = {
				exitCode: 1,
				stderr: error?.message ?? String(error),
				stdout: "",
			};
		}
		harnesses[harness] = {
			ok: result.exitCode === 0,
			reason:
				result.exitCode === 0
					? result.stdout?.trim() || "installed"
					: commandReason(result),
		};
	}
	const ok = harnesses.claude.ok && harnesses.codex.ok;
	log[ok ? "success" : "warning"](
		`Axstack ${AXSTACK_VERSION} ${releaseAction}; Claude ${harnesses.claude.ok ? "ok" : "failed"}; Codex ${harnesses.codex.ok ? "ok" : "failed"}.`,
	);
	return {
		harnesses,
		ok,
		release: { action: releaseAction, version: AXSTACK_VERSION },
	};
}

export async function checkAxstack(options = {}) {
	const home = options.home ?? homedir();
	const dataDir = options.dataDir ?? path.join(home, ".local/share/axstack");
	const binDir = options.binDir ?? path.join(home, ".local/bin");
	const runner = options.runner ?? defaultRunner;
	const shimPath = path.join(binDir, "axstack");
	const resolvedVersion = releaseVersionFromShim(shimPath);
	const releasePackage = resolvedVersion
		? path.join(dataDir, "releases", resolvedVersion, "package")
		: null;
	const shim = {
		path: shimPath,
		present: fs.existsSync(shimPath),
		version: resolvedVersion,
	};
	const run = async (args) => {
		if (!shim.present) return { ok: false, reason: "shim missing" };
		const result = await runner(shimPath, args, {
			env: { ...process.env, HOME: home },
		});
		return {
			ok: result.exitCode === 0,
			reason:
				result.exitCode === 0
					? result.stdout?.trim() || "ok"
					: commandReason(result),
		};
	};
	const version = await run(["--version"]);
	const harnesses = {};
	for (const harness of ["claude", "codex"]) {
		harnesses[harness] = await run([
			"check",
			"--bundle",
			releasePackage ?? dataDir,
			"--harness",
			harness,
		]);
	}
	const profile = {
		path: path.join(home, ".paseo", "config.json"),
		present: fs.existsSync(path.join(home, ".paseo", "config.json")),
	};
	const lines = [
		`shim: ${shim.present ? "present" : "missing"}; version: ${shim.version ?? "unresolved"}`,
		`axstack --version: ${version.ok ? version.reason : `failed — ${version.reason}`}`,
		`claude check: ${harnesses.claude.ok ? "ok" : "failed"} — ${harnesses.claude.reason}`,
		`codex check: ${harnesses.codex.ok ? "ok" : "failed"} — ${harnesses.codex.reason}`,
		`profile readback: ${profile.present ? "present" : "missing"} — ${profile.path}`,
	];
	for (const line of lines) log.info(line);
	return {
		harnesses,
		lines,
		ok:
			shim.present &&
			Boolean(shim.version) &&
			version.ok &&
			harnesses.claude.ok &&
			harnesses.codex.ok,
		profile,
		shim,
		version,
	};
}
