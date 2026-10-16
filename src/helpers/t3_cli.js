import path from "node:path";
import {
	meetsT3Floor,
	parseT3Version,
	shellQuote,
	T3_VERSION_FLOOR,
} from "./t3_tailscale.js";

// Shared stable CLI preparation; callers retain their platform runtime and service policy.
export async function prepareT3Cli({
	home,
	fsImpl,
	probe,
	runCommandImpl,
	latestStableImpl,
	fail,
}) {
	let t3 = "t3";
	let latest;
	let cliVersion;
	try {
		latest = await latestStableImpl();
		if (!meetsT3Floor(latest)) throw new Error("invalid stable version");
		const output = await probe("t3 --version");
		const resolved = await probe("command -v t3");
		const version = parseT3Version(output);
		cliVersion = version;
		if (
			(output !== null || resolved) &&
			(!resolved || !version || Bun.semver.order(version, latest) > 0)
		)
			throw new Error("CLI version unknown or newer than stable");
		const { localCli, occupied, managed } = inspectNpmT3(
			path.join(home, ".local"),
			fsImpl,
			latest,
		);
		if (
			(resolved && (resolved !== localCli || !managed)) ||
			(occupied && !managed)
		)
			throw new Error(
				"CLI origin is unmanaged; preserve it and select the supported ~/.local npm install explicitly",
			);
		if (!meetsT3Floor(output)) {
			const install = `npm --global --prefix ${shellQuote(path.join(home, ".local"))} install t3@latest`;
			if (!(await runCommandImpl(install)))
				return fail(`T3 stable installation failed. Retry with: ${install}`);
			t3 = shellQuote(localCli);
			const installed = parseT3Version(await probe(`${t3} --version`));
			cliVersion = installed;
			if (!meetsT3Floor(installed) || Bun.semver.order(installed, latest) > 0)
				return fail(
					`T3 stable must be >= ${T3_VERSION_FLOOR} and no newer than verified stable ${latest}. Inspect ${t3} --version before retrying.`,
				);
		}
	} catch (error) {
		return fail(
			`T3 stable migration held: ${error.message}. Inspect the CLI version and origin before retrying; no automatic downgrade.`,
		);
	}

	return { t3, latest, cliVersion };
}

function inspectNpmT3(prefix, fsImpl, latest) {
	const localCli = path.join(prefix, "bin/t3");
	const packageDir = path.join(prefix, "lib/node_modules/t3");
	let occupied = false;
	let managed = false;
	let metadata;
	try {
		const stat = fsImpl.lstatSync(localCli);
		occupied = true;
		if (
			stat.isSymbolicLink() &&
			fsImpl.realpathSync(localCli) === path.join(packageDir, "bin/t3.js")
		) {
			metadata = JSON.parse(
				fsImpl.readFileSync(path.join(packageDir, "package.json"), "utf8"),
			);
			const packageVersion = parseT3Version(metadata.version);
			if (packageVersion && Bun.semver.order(packageVersion, latest) > 0)
				throw new Error("managed npm package is newer than stable");
			managed = metadata.name === "t3" && packageVersion !== null;
		}
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	return { localCli, packageDir, occupied, managed, metadata };
}

export function isT3NodeVersionSupported(version) {
	const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
	if (!match) return false;
	const major = Number(match[1]),
		minor = Number(match[2]);
	return major === 22
		? minor >= 16
		: major === 23
			? minor >= 11
			: major === 24
				? minor >= 10
				: major > 24;
}

export function archT3Environment(home, env = process.env) {
	return {
		...process.env,
		...env,
		PATH: `${home}/.local/bin:${home}/.bun/bin:${home}/.local/share/mise/shims:/usr/local/bin:/usr/bin:/bin`,
	};
}

export async function prepareArchT3Cli({
	home,
	env,
	fsImpl,
	captureCommandImpl,
	runCommandImpl,
	latestStableImpl,
	logger,
}) {
	const serviceEnv = archT3Environment(home, env);
	const probe = async (command, commandEnv = serviceEnv) => {
		try {
			const result = await captureCommandImpl(command, {
				env: commandEnv,
				expectFailure: true,
				shell: command.startsWith("command -v "),
			});
			return result.exitCode === 0 ? result.stdout.trim() : null;
		} catch {
			return null;
		}
	};
	const latest = await latestStableImpl();
	if (!meetsT3Floor(latest))
		throw new Error("stable release unknown or below 0.1.0");
	const resolved = await probe("command -v t3");
	const ambient = await probe("command -v t3", { ...process.env, ...env });
	if (ambient && ambient !== resolved)
		throw new Error(
			"CLI origin/PATH differs from the service; preserve the shadowing executable",
		);
	const prefix = path.join(home, ".local");
	const local = inspectNpmT3(prefix, fsImpl, latest);
	let link;
	try {
		link = fsImpl.readlinkSync(local.localCli);
	} catch {
		/* Files and absent aliases are classified by origin below. */
	}
	const ownedNightly = link === "/usr/bin/t3-nightly";
	const ownedPackaged = link === "/usr/bin/t3";
	const checkNightly = async (limit) => {
		let present = true;
		try {
			fsImpl.statSync("/usr/bin/t3-nightly");
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
			present = false;
		}
		if (present) {
			const old = parseT3Version(await probe("/usr/bin/t3-nightly --version"));
			if (!old || Bun.semver.order(old, limit) > 0)
				throw new Error(
					"nightly version unknown or newer than stable; migration held",
				);
		}
	};
	if (
		(!resolved || (ownedNightly && resolved === local.localCli)) &&
		fsImpl.existsSync("/usr/bin/t3")
	) {
		const packagedVersion = parseT3Version(
			await probe("/usr/bin/t3 --version"),
		);
		if (
			!meetsT3Floor(packagedVersion) ||
			Bun.semver.order(packagedVersion, latest) > 0
		)
			throw new Error(
				"packaged T3 stable >=0.1.0 and no newer than verified stable is required",
			);
		if ((await probe("pacman -Qqo '/usr/bin/t3'")) !== "t3code-bin")
			throw new Error("packaged CLI origin is not t3code-bin");
		if (local.occupied && !ownedNightly)
			throw new Error("CLI origin is unmanaged; preserve the occupied alias");
		if (ownedNightly) await checkNightly(packagedVersion);
		fsImpl.mkdirSync(path.dirname(local.localCli), { recursive: true });
		const temporary = path.join(
			path.dirname(local.localCli),
			`.t3-link-${crypto.randomUUID()}`,
		);
		try {
			fsImpl.symlinkSync("/usr/bin/t3", temporary);
			fsImpl.renameSync(temporary, local.localCli);
		} finally {
			if (fsImpl.existsSync(temporary)) fsImpl.unlinkSync(temporary);
		}
		return {
			t3: shellQuote(local.localCli),
			latest,
			cliVersion: packagedVersion,
			env: serviceEnv,
		};
	}
	const output = await probe("t3 --version");
	const packaged =
		resolved === "/usr/bin/t3" ||
		(resolved === local.localCli && ownedPackaged);
	if (
		resolved &&
		resolved !== "/usr/bin/t3" &&
		fsImpl.existsSync("/usr/bin/t3")
	) {
		const packagedOutput = await probe("/usr/bin/t3 --version");
		logger?.warning(
			`T3 on PATH is ${resolved} (${output ?? "unknown version"}), shadowing packaged /usr/bin/t3 (${packagedOutput ?? "unknown version"}). Inspect these installs.`,
		);
	}
	const version = parseT3Version(output);
	if (
		output !== null &&
		(!resolved || !version || Bun.semver.order(version, latest) > 0)
	)
		throw new Error("CLI version unknown or newer than verified stable");
	if (packaged && (await probe("pacman -Qqo '/usr/bin/t3'")) === "t3code-bin") {
		if (!meetsT3Floor(output))
			throw new Error("packaged T3 stable >=0.1.0 is required");
		return { t3: "t3", latest, cliVersion: version, env: serviceEnv };
	}
	if (
		(resolved && (resolved !== local.localCli || !local.occupied)) ||
		(local.occupied && !local.managed && !ownedNightly)
	)
		throw new Error(
			"CLI origin is unmanaged; preserve it and select the supported ~/.local npm install explicitly",
		);
	if (ownedNightly) await checkNightly(latest);

	const validMetadata = (entry, cliVersion) =>
		entry.managed &&
		entry.metadata.version === cliVersion &&
		["bin/t3.js", "./bin/t3.js"].includes(
			typeof entry.metadata.bin === "string"
				? entry.metadata.bin
				: entry.metadata.bin?.t3,
		);
	if (local.managed && !validMetadata(local, version))
		throw new Error("local npm CLI origin/version metadata is inconsistent");
	if (
		!isT3NodeVersionSupported(await probe("node --version")) ||
		!(await probe("command -v node")) ||
		!(await probe("npm --version"))
	)
		throw new Error(
			"Node/npm prerequisite unavailable on the T3 service PATH; install/update Arch nodejs and npm (Node ^22.16, ^23.11 or >=24.10), then retry; no apt bootstrap on Arch",
		);
	if (local.managed && meetsT3Floor(output)) {
		return {
			t3: shellQuote(local.localCli),
			latest,
			cliVersion: version,
			env: serviceEnv,
		};
	}
	// Stage beside the destination so npm never removes the usable old alias on failure.
	if (!local.managed && fsImpl.existsSync(local.packageDir))
		throw new Error("npm package origin is unknown; keeping existing data");
	fsImpl.mkdirSync(prefix, { recursive: true });
	const stage = fsImpl.mkdtempSync(path.join(prefix, ".t3-install-"));
	let movedOld = false,
		movedNew = false,
		safeCleanup = true;
	try {
		const stageHome = path.join(stage, "home");
		const prepared = await prepareT3Cli({
			home: stageHome,
			fsImpl,
			latestStableImpl: async () => latest,
			probe: (command) =>
				command === "t3 --version" || command === "command -v t3"
					? null
					: probe(command),
			runCommandImpl: (command) => runCommandImpl(command, { env: serviceEnv }),
			fail: (message) => {
				throw new Error(message);
			},
		});
		const staged = inspectNpmT3(path.join(stageHome, ".local"), fsImpl, latest);
		if (!validMetadata(staged, prepared.cliVersion))
			throw new Error("installed npm CLI origin/version metadata is invalid");
		fsImpl.mkdirSync(path.dirname(local.packageDir), { recursive: true });
		if (local.managed) {
			fsImpl.renameSync(local.packageDir, path.join(stage, "previous-t3"));
			movedOld = true;
		}
		fsImpl.renameSync(staged.packageDir, local.packageDir);
		movedNew = true;
		const finalVersion = parseT3Version(
			await probe(
				`${shellQuote(path.join(local.packageDir, "bin/t3.js"))} --version`,
			),
		);
		if (finalVersion !== prepared.cliVersion)
			throw new Error(
				"installed CLI did not retain its verified version at the final path",
			);
		fsImpl.mkdirSync(path.dirname(local.localCli), { recursive: true });
		const alias = path.join(stage, "t3-link");
		fsImpl.symlinkSync("../lib/node_modules/t3/bin/t3.js", alias);
		fsImpl.renameSync(alias, local.localCli);
		return {
			t3: shellQuote(local.localCli),
			latest,
			cliVersion: prepared.cliVersion,
			env: serviceEnv,
		};
	} catch (error) {
		try {
			if (movedNew)
				fsImpl.renameSync(local.packageDir, path.join(stage, "failed-t3"));
			if (movedOld)
				fsImpl.renameSync(path.join(stage, "previous-t3"), local.packageDir);
		} catch {
			safeCleanup = false;
			throw new Error(
				`CLI migration rollback needs inspection at ${stage}; old alias preserved`,
			);
		}
		throw error;
	} finally {
		if (safeCleanup) fsImpl.rmSync(stage, { recursive: true });
	}
}
