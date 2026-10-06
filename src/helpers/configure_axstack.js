import { createHash } from "node:crypto";
import fs from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { detectOS } from "../common/cli_utils.js";
import { log } from "../common/utils.js";

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;

async function latestRelease(fetcher) {
	const response = await fetcher("https://registry.npmjs.org/axstack/latest");
	if (!response?.ok)
		throw new Error(`registry failed (${response?.status ?? "no response"})`);
	const metadata = await response.json();
	const { version, dist } = metadata ?? {};
	const integrity = dist?.integrity;
	if (
		typeof version !== "string" ||
		!VERSION_PATTERN.test(version) ||
		typeof dist?.tarball !== "string" ||
		typeof integrity !== "string" ||
		!/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity) ||
		Buffer.from(integrity.slice(7), "base64").toString("base64") !==
			integrity.slice(7)
	)
		throw new Error("malformed Axstack registry metadata");
	try {
		if (new URL(dist.tarball).protocol !== "https:") throw new Error();
	} catch {
		throw new Error("malformed Axstack registry metadata: tarball URL");
	}
	return { version, tarball: dist.tarball, integrity };
}

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

function releaseFromShim(shimPath) {
	if (!fs.existsSync(shimPath)) {
		return { cliPath: null, status: "missing", version: null };
	}
	try {
		const content = fs.readFileSync(shimPath, "utf8");
		const cliPath = content.match(
			/["']?(\/[^"'\n]*\/package\/bin\/axstack\.js)["']?/,
		)?.[1];
		if (!cliPath) {
			return { cliPath: null, status: "unparsable", version: null };
		}
		const pathVersion = cliPath.match(
			/\/releases\/([^/]+)\/package\/bin\/axstack\.js$/,
		)?.[1];
		if (VERSION_PATTERN.test(pathVersion ?? "")) {
			return { cliPath, status: "resolved", version: pathVersion };
		}
		const packageJson = path.join(
			path.dirname(path.dirname(cliPath)),
			"package.json",
		);
		const version = JSON.parse(fs.readFileSync(packageJson, "utf8")).version;
		if (!VERSION_PATTERN.test(version ?? "")) {
			return { cliPath, status: "unparsable", version: version ?? null };
		}
		return { cliPath, status: "resolved", version };
	} catch {
		return { cliPath: null, status: "unparsable", version: null };
	}
}

function compareVersions(left, right) {
	const numericParts = (version) =>
		version
			.split("-", 1)[0]
			.split(".")
			.map((part) => Number.parseInt(part, 10));
	const a = numericParts(left);
	const b = numericParts(right);
	for (let i = 0; i < 3; i += 1) {
		const difference = a[i] - b[i];
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

function failedResult(reason, action = "kept", version = null) {
	return {
		harnesses: {
			claude: { ok: false, reason },
			codex: { ok: false, reason },
		},
		ok: false,
		release: { action, version },
	};
}

export async function configureAxstack(options = {}) {
	const home = options.home ?? homedir();
	const dataDir = options.dataDir ?? path.join(home, ".local/share/axstack");
	const binDir = options.binDir ?? path.join(home, ".local/bin");
	const fetcher = options.fetcher ?? fetch;
	const extractor = options.extractor ?? defaultExtractor;
	const runner = options.runner ?? defaultRunner;
	const bunPath = options.bunPath ?? Bun.which("bun") ?? process.execPath;
	const shimPath = path.join(binDir, "axstack");
	const installed = releaseFromShim(shimPath);
	const installedVersion = installed.version;

	if (installed.status === "unparsable") {
		const reason = "existing Axstack shim or version is unparsable";
		log.warning(`Axstack: ${reason}; keeping it unchanged.`);
		return failedResult(reason, "kept", installedVersion ?? "unresolved");
	}

	let latest;
	try {
		latest = await latestRelease(fetcher);
	} catch (error) {
		const reason = error?.message ?? String(error);
		log.error(`Axstack setup failed: ${reason}`);
		return failedResult(reason, "kept", installedVersion);
	}
	const { version: latestVersion } = latest;

	if (
		installedVersion &&
		compareVersions(installedVersion, latestVersion) > 0
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

	try {
		if (
			(options.detectOS ?? detectOS)() === "arch" &&
			!(options.which ?? Bun.which)("t3") &&
			(options.nightlyExists ?? fs.existsSync("/usr/bin/t3-nightly"))
		) {
			fs.mkdirSync(binDir, { recursive: true });
			try {
				fs.symlinkSync("/usr/bin/t3-nightly", path.join(binDir, "t3"));
			} catch (error) {
				if (error.code !== "EEXIST") throw error;
			}
		}
	} catch (error) {
		return failedResult(
			`T3 alias failed: ${error?.message ?? error}`,
			"kept",
			latestVersion,
		);
	}

	const releaseRoot = path.join(dataDir, "releases", latestVersion);
	let releaseAction = "kept";
	let cliPath = path.join(releaseRoot, "package", "bin", "axstack.js");
	let releasePackage = path.join(releaseRoot, "package");
	const keepInstalled =
		installedVersion && compareVersions(installedVersion, latestVersion) === 0;
	if (keepInstalled) {
		releaseAction = installedVersion.includes("-")
			? "kept-user-managed"
			: "kept";
		cliPath = installed.cliPath;
		releasePackage = path.dirname(path.dirname(cliPath));
		log.info(`Axstack: kept ${installedVersion}.`);
	} else if (!fs.existsSync(releasePackage)) {
		const downloadDir = fs.mkdtempSync(
			path.join(options.tempDir ?? tmpdir(), "haoshoku-axstack-"),
		);
		try {
			const response = await fetcher(latest.tarball);
			if (!response?.ok) {
				throw new Error(
					`download failed (${response?.status ?? "no response"})`,
				);
			}
			const archive = Buffer.from(await response.arrayBuffer());
			const actual = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
			if (actual !== latest.integrity) {
				throw new Error(
					`integrity mismatch: expected ${latest.integrity}, got ${actual}`,
				);
			}

			const archivePath = path.join(downloadDir, "axstack.tgz");
			fs.writeFileSync(archivePath, archive);
			const releasesDir = path.dirname(releaseRoot);
			const stagingPrefix = `.${latestVersion}-`;
			fs.mkdirSync(releasesDir, { recursive: true });
			for (const entry of fs.readdirSync(releasesDir, {
				withFileTypes: true,
			})) {
				if (entry.isDirectory() && entry.name.startsWith(stagingPrefix)) {
					fs.rmSync(path.join(releasesDir, entry.name), {
						force: true,
						recursive: true,
					});
				}
			}
			const staging = fs.mkdtempSync(path.join(releasesDir, stagingPrefix));
			try {
				await extractor(archivePath, staging);
				if (
					!fs.existsSync(path.join(staging, "package", "bin", "axstack.js"))
				) {
					throw new Error("archive is missing package/bin/axstack.js");
				}
				fs.renameSync(staging, releaseRoot);
				fs.chmodSync(releaseRoot, 0o755);
				releaseAction = "installed";
			} finally {
				fs.rmSync(staging, { force: true, recursive: true });
			}
		} catch (error) {
			const reason = error?.message ?? String(error);
			log.error(`Axstack setup failed: ${reason}`);
			return failedResult(reason, "kept", latestVersion);
		} finally {
			fs.rmSync(downloadDir, { force: true, recursive: true });
		}
	}

	if (!keepInstalled) {
		try {
			atomicWriteShim(
				shimPath,
				`#!/bin/sh\nexec ${shellQuote(bunPath)} ${shellQuote(cliPath)} "$@"\n`,
			);
		} catch (error) {
			const reason = `shim installation failed: ${error?.message ?? error}`;
			log.error(`Axstack setup failed: ${reason}`);
			return failedResult(reason, releaseAction, latestVersion);
		}
	}
	const harnesses = {};
	for (const harness of ["claude", "codex"]) {
		const args = [
			cliPath,
			"install",
			"--preset",
			"mixed",
			"--bundle",
			releasePackage,
			"--harness",
			harness,
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
		`Axstack ${latestVersion} ${releaseAction}; Claude ${harnesses.claude.ok ? "ok" : "failed"}; Codex ${harnesses.codex.ok ? "ok" : "failed"}.`,
	);
	return {
		harnesses,
		ok,
		release: {
			action: releaseAction,
			version: keepInstalled ? installedVersion : latestVersion,
		},
	};
}

export async function checkAxstack(options = {}) {
	const home = options.home ?? homedir();
	const binDir = options.binDir ?? path.join(home, ".local/bin");
	const runner = options.runner ?? defaultRunner;
	const shimPath = path.join(binDir, "axstack");
	const resolvedRelease = releaseFromShim(shimPath);
	const resolvedVersion = resolvedRelease.version;
	const releasePackage = resolvedRelease.cliPath
		? path.dirname(path.dirname(resolvedRelease.cliPath))
		: null;
	const shim = {
		path: shimPath,
		present: resolvedRelease.status !== "missing",
		version: resolvedVersion,
	};
	const run = async (args) => {
		if (resolvedRelease.status !== "resolved") {
			return { ok: false, reason: `shim ${resolvedRelease.status}` };
		}
		let result;
		try {
			result = await runner(shimPath, args, {
				env: { ...process.env, HOME: home },
			});
		} catch (error) {
			return { ok: false, reason: error?.message ?? String(error) };
		}
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
			releasePackage,
			"--harness",
			harness,
		]);
	}
	const roles = {};
	for (const [harness, directory] of [
		["claude", ".claude"],
		["codex", ".agents"],
	]) {
		const rolesPath = path.join(
			home,
			directory,
			"skills",
			"axstack",
			"roles.json",
		);
		roles[harness] = { path: rolesPath, present: fs.existsSync(rolesPath) };
	}
	const lines = [
		`shim: ${shim.present ? "present" : "missing"}; version: ${shim.version ?? "unresolved"}`,
		`axstack --version: ${version.ok ? version.reason : `failed — ${version.reason}`}`,
		`claude check: ${harnesses.claude.ok ? "ok" : "failed"} — ${harnesses.claude.reason}`,
		`codex check: ${harnesses.codex.ok ? "ok" : "failed"} — ${harnesses.codex.reason}`,
		...Object.entries(roles).map(
			([harness, role]) =>
				`${harness} roles readback: ${role.present ? "present" : "missing"} — ${role.path}`,
		),
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
		roles,
		shim,
		version,
	};
}
