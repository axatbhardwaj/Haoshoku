import { detectOS } from "../cli_utils.js";
import * as clients from "../../helpers/configure_executor_clients.js";
import * as server from "../../helpers/configure_executor_server.js";

// Validate raw Executor arguments before Commander or run-log creation.
export default function preflightExecutorArgs(argv = process.argv.slice(2)) {
	const clientArgs = argv;
	const clientMode = clientArgs.some(
		(arg) => arg.split("=")[0] === "--executor-clients",
	);
	let clientEndpoint;
	if (clientMode && !clientArgs.some((arg) => ["--help", "-h"].includes(arg))) {
		try {
			const inline = clientArgs[0]?.startsWith("--executor-clients=");
			if (
				!(inline && clientArgs.length === 1) &&
				!(clientArgs[0] === "--executor-clients" && clientArgs.length === 2)
			)
				throw new Error(clients.EXECUTOR_CLIENT_USAGE);
			clientEndpoint = clients.validateExecutorClientInput(
				inline
					? clientArgs[0].slice("--executor-clients=".length)
					: clientArgs[1],
			);
		} catch (error) {
			console.error(error.message);
			process.exit(2);
		}
	}

	const executorArgs = argv;
	const executorIndex = executorArgs.findIndex(
		(arg) => arg.split("=")[0] === "--server-executor",
	);
	let executorOrigin;
	if (executorIndex !== -1 && !executorArgs.includes("--help")) {
		const flag = executorArgs[executorIndex];
		const value = flag.includes("=")
			? flag.slice(flag.indexOf("=") + 1)
			: executorArgs[executorIndex + 1];
		executorOrigin = server.parseExecutorOrigin(value);
		const extra = executorArgs.some(
			(arg, index) =>
				index !== executorIndex &&
				index !== executorIndex + (flag.includes("=") ? 0 : 1) &&
				!arg.startsWith("-") &&
				executorArgs[index - 1] !== "--os",
		);
		if (
			!executorOrigin ||
			extra ||
			executorArgs.filter((arg) => arg.split("=")[0] === "--server-executor")
				.length !== 1
		) {
			console.error(
				"Usage: haoshoku --server-executor <https-origin>. Supply HTTPS, a host and optional port only; no credentials, paths, query or fragment.",
			);
			process.exit(2);
		}
		const osOption = executorArgs.find((arg) => arg.startsWith("--os="));
		const explicitOS = osOption
			? osOption.slice(5)
			: executorArgs.includes("--os")
				? executorArgs[executorArgs.indexOf("--os") + 1]
				: undefined;
		if (
			detectOS() !== "debian-server" ||
			(explicitOS !== undefined && explicitOS !== "debian-server")
		) {
			console.error(
				"--server-executor requires a Debian-family host; configure external DNS/TLS/nginx first.",
			);
			process.exit(2);
		}
	}

	return { clientMode, clientEndpoint, executorIndex, executorOrigin };
}
