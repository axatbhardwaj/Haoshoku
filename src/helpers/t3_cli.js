import path from "node:path";
import { meetsT3Floor, parseT3Version, shellQuote, T3_VERSION_FLOOR } from "./t3_tailscale.js";

// Shared stable CLI preparation; callers retain their platform runtime and service policy.
export async function prepareT3Cli({ home, fsImpl, probe, runCommandImpl, latestStableImpl, fail }) {
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
		const localCli = path.join(home, ".local/bin/t3");
		const packageDir = path.join(home, ".local/lib/node_modules/t3");
		let occupied = false;
		let managed = false;
		try {
			const stat = fsImpl.lstatSync(localCli);
			occupied = true;
			if (
				stat.isSymbolicLink() &&
				fsImpl.realpathSync(localCli) === path.join(packageDir, "bin/t3.js")
			) {
				const metadata = JSON.parse(
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
