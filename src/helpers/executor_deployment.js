import fs from "node:fs";
import path from "node:path";

export const EXECUTOR_IMAGE =
	"ghcr.io/usefulsoftwareco/executor-selfhost:latest";
export const EXECUTOR_DIGEST =
	/^ghcr\.io\/usefulsoftwareco\/executor-selfhost@sha256:[a-f0-9]{64}$/;

export function executorCompose(origin, digest) {
	return `# Managed by Haoshoku; conflicting deployments are never adopted.\nservices:\n  executor:\n    image: ${digest}\n    container_name: executor-selfhost\n    restart: unless-stopped\n    ports:\n      - "127.0.0.1:4788:4788"\n    environment:\n      EXECUTOR_WEB_BASE_URL: ${JSON.stringify(origin)}\n    volumes:\n      - ./data:/data\n`;
}

export function createExecutorDeployment(dir, origin, digest, fsImpl = fs) {
	fsImpl.mkdirSync(dir, { mode: 0o755 });
	const data = path.join(dir, "data");
	fsImpl.mkdirSync(data, { mode: 0o700 });
	const prepared = fsImpl.lstatSync(data);
	if (
		!prepared.isDirectory() ||
		prepared.isSymbolicLink() ||
		fsImpl.readdirSync(data).length !== 0
	)
		throw new Error("data appeared during preparation");
	fsImpl.chownSync(data, 65532, 65532);
	fsImpl.writeFileSync(
		path.join(dir, "docker-compose.yml"),
		executorCompose(origin, digest),
		{ flag: "wx", mode: 0o600 },
	);
	fsImpl.writeFileSync(
		path.join(dir, "haoshoku-executor.json"),
		`${JSON.stringify({ version: 1, digest })}\n`,
		{ flag: "wx", mode: 0o600 },
	);
}

function stat(file, fsImpl) {
	try {
		return fsImpl.lstatSync(file);
	} catch (e) {
		if (e.code === "ENOENT") return null;
		throw e;
	}
}

export function readExecutorDeployment(dir, origin, fsImpl = fs) {
	if (!path.isAbsolute(dir) || path.resolve(dir) !== dir)
		throw new Error("unsafe path");
	for (let p = dir; ; p = path.dirname(p)) {
		const st = stat(p, fsImpl);
		if (st && (!st.isDirectory() || st.isSymbolicLink()))
			throw new Error("unsafe path");
		if (p === path.dirname(p)) break;
	}
	if (!stat(dir, fsImpl)) return null;
	const expected = ["data", "docker-compose.yml", "haoshoku-executor.json"];
	const entries = fsImpl.readdirSync(dir).sort();
	if (JSON.stringify(entries) !== JSON.stringify(expected))
		throw new Error("unmanaged or partial directory");
	for (const name of expected.slice(1)) {
		const st = stat(path.join(dir, name), fsImpl);
		if (!st?.isFile() || st.isSymbolicLink())
			throw new Error("unsafe config file");
	}
	const state = JSON.parse(
		fsImpl.readFileSync(path.join(dir, "haoshoku-executor.json"), "utf8"),
	);
	if (state.version !== 1 || !EXECUTOR_DIGEST.test(state.digest))
		throw new Error("invalid managed record");
	if (
		fsImpl.readFileSync(path.join(dir, "docker-compose.yml"), "utf8") !==
		executorCompose(origin, state.digest)
	)
		throw new Error("conflicting compose");
	const data = path.join(dir, "data");
	const st = stat(data, fsImpl);
	if (
		!st?.isDirectory() ||
		st.isSymbolicLink() ||
		st.uid !== 65532 ||
		st.gid !== 65532 ||
		(st.mode & 0o777) !== 0o700
	)
		throw new Error("incompatible data directory");
	const allowed = new Set([
		"data.db",
		"data.db-wal",
		"data.db-shm",
		"secret.key",
		"auth-secret.key",
	]);
	const files = fsImpl.readdirSync(data);
	if (
		!["data.db", "secret.key", "auth-secret.key"].every((name) =>
			files.includes(name),
		)
	)
		throw new Error("partial data");
	for (const name of files) {
		const entry = stat(path.join(data, name), fsImpl);
		if (!allowed.has(name) || !entry?.isFile() || entry.isSymbolicLink())
			throw new Error("unknown data path");
	}
	return state.digest;
}

export async function preflightExecutorRuntime(dir, digest, command) {
	const listing = await command([
		"docker",
		"ps",
		"-a",
		"--format",
		"{{json .}}",
	]);
	const containers = listing
		? listing.split("\n").map((line) => JSON.parse(line))
		: [];
	let named = false;
	for (const c of containers) {
		if (typeof c.Names !== "string" || typeof c.Ports !== "string")
			throw new Error("malformed container listing");
		if (c.Names === "executor-selfhost") named = true;
		else if (/:4788->/.test(c.Ports))
			throw new Error("conflicting container port");
	}
	const listeners = await command(["ss", "-H", "-ltn", "sport = :4788"]);
	if (!digest && (named || listeners))
		throw new Error("conflicting container or port");
	if (!digest) return;
	if (
		!named ||
		(listeners &&
			listeners
				.split("\n")
				.some((line) => line.trim().split(/\s+/)[3] !== "127.0.0.1:4788"))
	)
		throw new Error("missing container or conflicting listener");
	// Select only runtime identity; never request Env or a full container inspect.
	const format =
		'{"image":{{json .Config.Image}},"user":{{json .Config.User}},"running":{{json .State.Running}},"ports":{{json .HostConfig.PortBindings}},"mounts":{{json .Mounts}},"labels":{{json .Config.Labels}}}';
	const c = JSON.parse(
		await command([
			"docker",
			"inspect",
			"executor-selfhost",
			"--format",
			format,
		]),
	);
	const bindings = c.ports?.["4788/tcp"];
	if (
		c.image !== digest ||
		c.user !== "65532:65532" ||
		c.running !== true ||
		Object.keys(c.ports || {}).length !== 1 ||
		bindings?.length !== 1 ||
		bindings[0].HostIp !== "127.0.0.1" ||
		bindings[0].HostPort !== "4788" ||
		c.mounts?.length !== 1 ||
		c.mounts[0].Type !== "bind" ||
		c.mounts[0].Source !== path.join(dir, "data") ||
		c.mounts[0].Destination !== "/data" ||
		c.mounts[0].RW !== true ||
		c.labels?.["com.docker.compose.project"] !== "haoshoku-executor" ||
		c.labels?.["com.docker.compose.service"] !== "executor"
	)
		throw new Error("incompatible container");
}
