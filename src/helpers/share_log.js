import fs from "node:fs";
import path from "node:path";
import { listRunLogs, logDirectory } from "../common/run_log.js";
import { log, runCommandCapture } from "../common/utils.js";

export async function shareLog(
	requestedPath,
	{
		env = process.env,
		runProcess = runCommandCapture,
		logImpl = log,
		excludePath,
	} = {},
) {
	let file;
	try {
		const dir = logDirectory(env);
		file = requestedPath
			? path.resolve(requestedPath)
			: listRunLogs(dir)
					.map((name) => path.join(dir, name))
					.filter((candidate) => candidate !== excludePath)
					.at(-1);
		if (!file || !fs.statSync(file).isFile()) throw new Error("Missing log");
		fs.accessSync(file, fs.constants.R_OK);
	} catch {
		logImpl.error(
			"No readable run log. Run Haoshoku first or pass --share-log <path>.",
		);
		return false;
	}
	const run = async (argv) => {
		try {
			return await runProcess(argv, { stdin: "ignore", env });
		} catch (error) {
			return {
				exitCode: 127,
				stdout: "",
				stderr: error?.message ?? String(error),
			};
		}
	};
	const target = env.HAOSHOKU_LOG_TARGET || "io";
	const status = await run(["tailscale", "status", "--json"]);
	let peer;
	if (status.exitCode === 0) {
		try {
			const parsed = JSON.parse(status.stdout);
			const normalized = target.toLowerCase().replace(/\.$/, "");
			peer =
				parsed.BackendState === "Running" &&
				Object.values(parsed.Peer || {}).find((device) => {
					const dns = (device.DNSName || "").toLowerCase().replace(/\.$/, "");
					return (
						device.Online === true &&
						[
							(device.HostName || "").toLowerCase(),
							dns,
							dns.split(".")[0],
							...(device.TailscaleIPs || []),
						].includes(normalized)
					);
				});
		} catch {
			/* Unavailable or malformed status uses the next sharing option. */
		}
	}
	if (peer) {
		const result = await run(["tailscale", "file", "cp", file, `${target}:`]);
		if (result.exitCode !== 0) {
			logImpl.error(`Taildrop failed. Log retained at ${file}`);
			return false;
		}
		logImpl.success(
			`log sent to ${target} via Taildrop: ${path.basename(file)}`,
		);
		logImpl.info(
			`Tell your agent on ${target} to collect it with: tailscale file get ~/Downloads`,
		);
		return true;
	}
	const auth = await run(["gh", "auth", "status"]);
	if (auth.exitCode === 0) {
		// gh gist create is secret by default; --secret is not a supported flag.
		const result = await run(["gh", "gist", "create", file]);
		const url = result.stdout?.match(
			/https:\/\/gist\.github\.com\/[^\s]+/,
		)?.[0];
		if (result.exitCode !== 0 || !url) {
			logImpl.error(
				`Gist creation failed or its URL was unavailable. Log retained at ${file}`,
			);
			return false;
		}
		logImpl.success(`Secret gist: ${url}`);
		logImpl.info("Send this URL to your agent.");
		return true;
	}
	logImpl.info(`Send this log to your agent: ${file}`);
	logImpl.info(
		"Copy it to your main machine or attach it to your agent conversation.",
	);
	return true;
}
