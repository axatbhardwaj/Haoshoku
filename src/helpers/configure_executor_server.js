import fs from "node:fs";
import path from "node:path";
import { verifyExecutorReady } from "./executor_readiness.js";
import { log } from "../common/utils.js";
import {
	createExecutorDeployment,
	readExecutorDeployment,
	preflightExecutorRuntime,
	EXECUTOR_DIGEST,
	EXECUTOR_IMAGE,
} from "./executor_deployment.js";

export function parseExecutorOrigin(value) {
	// Check the unnormalised spelling: URL parsing erases dot paths and empty ?/#.
	if (
		typeof value !== "string" ||
		!/^https:\/\/[A-Za-z0-9.[\]:-]+\/?$/.test(value)
	)
		return null;
	try {
		const url = new URL(value);
		if (
			!url.hostname ||
			url.username ||
			url.password ||
			url.pathname !== "/" ||
			url.search ||
			url.hash
		)
			return null;
		return url.origin;
	} catch {
		return null;
	}
}

async function runProcess(argv) {
	const child = Bun.spawn(argv, { stdout: "pipe", stderr: "ignore" });
	const timer = setTimeout(() => child.kill(), 120_000);
	try {
		const stdout = await new Response(child.stdout).text();
		return { exitCode: await child.exited, stdout };
	} finally {
		clearTimeout(timer);
	}
}

export async function configureExecutorServer(
	value,
	{
		deploymentDir = "/srv/executor",
		uid = process.getuid(),
		fsImpl = fs,
		runImpl = runProcess,
		fetchImpl = fetch,
		sleepImpl = Bun.sleep,
		logger = log,
		readinessAttempts = 5,
		probeTimeoutMs = 5_000,
	} = {},
) {
	let step = "prerequisites";
	const fail = () => {
		logger.error(
			`Executor setup incomplete at ${step}. Preserve existing files; inspect Docker/Compose and external DNS/TLS/nginx, then retry haoshoku --server-executor <https-origin>. Root access, Docker Compose v2 and ss are required. No automatic cleanup or migration.`,
		);
		return false;
	};
	const command = async (argv) => {
		const r = await runImpl(argv);
		if (r.exitCode !== 0) throw new Error("command failed");
		return r.stdout.trim();
	};
	try {
		const origin = parseExecutorOrigin(value);
		if (!origin || uid !== 0) return fail();
		const daemon = JSON.parse(
			await command(["docker", "info", "--format", "{{json .ServerVersion}}"]),
		);
		if (typeof daemon !== "string" || !daemon) return fail();
		const composeVersion = await command([
			"docker",
			"compose",
			"version",
			"--short",
		]);
		if (!/^v?2\./.test(composeVersion)) return fail();
		step = "preservation preflight";
		let digest = readExecutorDeployment(deploymentDir, origin, fsImpl);
		await preflightExecutorRuntime(deploymentDir, digest, command);
		if (!digest) {
			step = "image pull and runtime contract";
			await command(["docker", "pull", EXECUTOR_IMAGE]);
			const digests = JSON.parse(
				await command([
					"docker",
					"image",
					"inspect",
					EXECUTOR_IMAGE,
					"--format",
					"{{json .RepoDigests}}",
				]),
			);
			digest =
				Array.isArray(digests) && digests.find((d) => EXECUTOR_DIGEST.test(d));
			const user = await command([
				"docker",
				"image",
				"inspect",
				digest || EXECUTOR_IMAGE,
				"--format",
				"{{.Config.User}}",
			]);
			const volumes = JSON.parse(
				await command([
					"docker",
					"image",
					"inspect",
					digest || EXECUTOR_IMAGE,
					"--format",
					"{{json .Config.Volumes}}",
				]),
			);
			if (
				!digest ||
				user !== "65532:65532" ||
				!volumes ||
				!("/data" in volumes)
			)
				return fail();
			step = "new configuration";
			createExecutorDeployment(deploymentDir, origin, digest, fsImpl);
			step = "container startup";
			await command([
				"docker",
				"compose",
				"-p",
				"haoshoku-executor",
				"-f",
				path.join(deploymentDir, "docker-compose.yml"),
				"up",
				"-d",
				"--pull",
				"never",
			]);
			await preflightExecutorRuntime(deploymentDir, digest, command);
		}
		step = "application and public-origin verification";
		if (
			!(await verifyExecutorReady(origin, {
				fetchImpl,
				sleepImpl,
				readinessAttempts,
				probeTimeoutMs,
			}))
		)
			return fail();
		logger.success(
			"Executor container ready; owner onboarding, authenticated MCP and integration health remain unverified. Complete owner onboarding in the browser yourself.",
		);
		return true;
	} catch {
		return fail();
	}
}
