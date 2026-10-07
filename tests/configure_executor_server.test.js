import { expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureExecutorServer } from "../src/helpers/configure_executor_server.js";

const image = "ghcr.io/usefulsoftwareco/executor-selfhost:latest";
const digest = `ghcr.io/usefulsoftwareco/executor-selfhost@sha256:${"a".repeat(64)}`;
const origin = "https://gateway.example:8444";
function fixture({ failCommand } = {}) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "executor-home-"));
	const dir = path.join(home, "executor");
	const events = [];
	const messages = [];
	let started = false;
	const options = {
		deploymentDir: dir,
		uid: 0,
		fsImpl: {
			...fs,
			chownSync: (p, uid, gid) => events.push(["chown", p, uid, gid]),
		},
		runImpl: async (argv) => {
			events.push(argv);
			if (failCommand?.(argv))
				return {
					exitCode: 1,
					stdout: "secret endpoint must not be logged",
					stderr: "secret",
				};
			let stdout = "";
			if (argv[1] === "ps" && started)
				stdout =
					'{"Names":"executor-selfhost","Ports":"127.0.0.1:4788->4788/tcp"}';
			if (argv[1] === "inspect" && started)
				stdout = JSON.stringify(container({ dir }));
			if (argv[1] === "info") stdout = '"28.0.0"';
			if (argv[1] === "compose" && argv[2] === "version") stdout = "2.35.0";
			if (argv[1] === "image") {
				if (argv.at(-1).includes("RepoDigests"))
					stdout = JSON.stringify([digest]);
				else if (argv.at(-1).includes("User")) stdout = "65532:65532";
				else stdout = '{"/data":{}}';
			}
			if (argv.includes("up")) {
				started = true;
				for (const name of ["data.db", "secret.key", "auth-secret.key"])
					fs.writeFileSync(path.join(dir, "data", name), `fixture-${name}`);
			}
			return { exitCode: 0, stdout, stderr: "" };
		},
		fetchImpl: async (url) => {
			events.push(["GET", url]);
			const body = url.endsWith("/api/health")
				? { status: "ok" }
				: {
						issuer: `${origin}/api/auth`,
						authorization_endpoint: `${origin}/api/auth/mcp/authorize`,
						token_endpoint: `${origin}/api/auth/mcp/token`,
						registration_endpoint: `${origin}/api/auth/mcp/register`,
					};
			return new Response(JSON.stringify(body), {
				headers: { "content-type": "application/json" },
			});
		},
		sleepImpl: async () => {},
		logger: {
			error: (m) => messages.push(m),
			success: (m) => messages.push(m),
			info: (m) => messages.push(m),
		},
	};
	return { home, dir, events, messages, options };
}
it("fresh provisioning pulls and pins the image, prepares only new data, then verifies", async () => {
	const f = fixture();
	expect(await configureExecutorServer(origin, f.options)).toBe(true);
	const compose = fs.readFileSync(
		path.join(f.dir, "docker-compose.yml"),
		"utf8",
	);
	expect(compose).toContain(`image: ${digest}`);
	expect(compose).toContain('"127.0.0.1:4788:4788"');
	expect(compose).toContain(`EXECUTOR_WEB_BASE_URL: "${origin}"`);
	expect(compose).toContain("./data:/data");
	expect(
		JSON.parse(fs.readFileSync(path.join(f.dir, "haoshoku-executor.json")))
			.digest,
	).toBe(digest);
	expect(fs.statSync(path.join(f.dir, "data")).mode & 0o777).toBe(0o700);
	expect(f.events.filter((e) => e[0] === "chown")).toEqual([
		["chown", path.join(f.dir, "data"), 65532, 65532],
	]);
	const pull = f.events.findIndex((e) => e[1] === "pull");
	const start = f.events.findIndex((e) => e.includes("up"));
	expect(f.events[pull]).toEqual(["docker", "pull", image]);
	expect(pull).toBeGreaterThan(f.events.findIndex((e) => e[0] === "ss"));
	expect(start).toBeGreaterThan(pull);
	expect(f.events[start]).toEqual([
		"docker",
		"compose",
		"-p",
		"haoshoku-executor",
		"-f",
		path.join(f.dir, "docker-compose.yml"),
		"up",
		"-d",
		"--pull",
		"never",
	]);
	expect(f.events.filter((e) => e[0] === "GET").map((e) => e[1])).toEqual([
		"http://127.0.0.1:4788/api/health",
		"http://127.0.0.1:4788/.well-known/oauth-authorization-server",
		`${origin}/api/health`,
		`${origin}/.well-known/oauth-authorization-server`,
	]);
	expect(f.messages.join("\n")).toContain("owner onboarding");
	expect(f.messages.join("\n")).not.toContain(origin);
});
it.each([
	"docker",
	"compose",
	"ss",
	"nonroot",
	"origin",
])("refuses missing prerequisite %s without writes or pull", async (missing) => {
	const f = fixture({
		failCommand: (a) =>
			missing === a[0] || (missing === "compose" && a[1] === "compose"),
	});
	if (missing === "nonroot") f.options.uid = 1000;
	expect(
		await configureExecutorServer(
			missing === "origin" ? "http://bad.example" : origin,
			f.options,
		),
	).toBe(false);
	expect(fs.existsSync(f.dir)).toBe(false);
	expect(f.events.some((e) => e[1] === "pull" || e.includes("up"))).toBe(false);
	expect(f.messages.join("\n")).toContain("incomplete");
	expect(f.messages.join("\n")).not.toContain("secret");
});

function snapshot(dir) {
	return Object.fromEntries(
		[".", ...fs.readdirSync(dir, { recursive: true })].sort().map((name) => {
			const p = path.join(dir, name);
			const st = fs.lstatSync(p);
			return [
				name,
				[
					st.mode,
					st.uid,
					st.gid,
					st.mtimeMs,
					st.isSymbolicLink()
						? fs.readlinkSync(p)
						: st.isFile()
							? fs.readFileSync(p).toString("hex")
							: "directory",
				],
			];
		}),
	);
}
function container(f) {
	return {
		image: digest,
		user: "65532:65532",
		running: true,
		ports: { "4788/tcp": [{ HostIp: "127.0.0.1", HostPort: "4788" }] },
		mounts: [
			{
				Type: "bind",
				Source: path.join(f.dir, "data"),
				Destination: "/data",
				RW: true,
			},
		],
		labels: {
			"com.docker.compose.project": "haoshoku-executor",
			"com.docker.compose.service": "executor",
		},
	};
}
function existingRuntime(f, override = {}, runtime = {}) {
	const original = f.options.runImpl;
	f.options.runImpl = async (a) => {
		if (a[1] === "ps" && fs.existsSync(f.dir)) {
			f.events.push(a);
			return {
				exitCode: 0,
				stdout:
					runtime.listing ??
					'{"Names":"executor-selfhost","Ports":"127.0.0.1:4788->4788/tcp"}',
			};
		}
		if (a[1] === "inspect") {
			f.events.push(a);
			return {
				exitCode: 0,
				stdout: JSON.stringify({ ...container(f), ...override }),
			};
		}
		if (a[0] === "ss" && fs.existsSync(f.dir)) {
			f.events.push(a);
			return {
				exitCode: 0,
				stdout: runtime.listener ?? "LISTEN 0 4096 127.0.0.1:4788 0.0.0.0:*",
			};
		}
		return original(a);
	};
	const lstat = f.options.fsImpl.lstatSync;
	f.options.fsImpl.lstatSync = (p) => {
		const st = lstat(p);
		return p === path.join(f.dir, "data")
			? Object.assign(st, { uid: 65532, gid: 65532 })
			: st;
	};
}
function observePreservation(f) {
	const before = snapshot(f.dir);
	f.events.length = 0;
	f.messages.length = 0;
	for (const [method, event] of [
		["readFileSync", "read"],
		["writeFileSync", "write"],
		["mkdirSync", "mkdir"],
	]) {
		const original = f.options.fsImpl[method];
		f.options.fsImpl[method] = (p, ...args) => {
			f.events.push([event, p]);
			return original(p, ...args);
		};
	}
	return before;
}
function expectPreserved(f, before) {
	expect(snapshot(f.dir)).toEqual(before);
	expect(
		f.events.filter(
			(e) =>
				["chown", "write", "mkdir"].includes(e[0]) ||
				(e[0] === "docker" &&
					!["info", "ps", "inspect"].includes(e[1]) &&
					!(e[1] === "compose" && e[2] === "version")),
		),
	).toEqual([]);
	expect(
		f.events.filter((e) => e[0] === "read" && e[1].includes("/data/")),
	).toEqual([]);
	expect(f.events.filter((e) => e[0] === "GET")).toEqual([]);
	expect(f.messages.join("\n")).not.toContain("container ready");
}
it("identical managed rerun verifies without mutation, pull, startup or reading secrets", async () => {
	const f = fixture();
	expect(await configureExecutorServer(origin, f.options)).toBe(true);
	existingRuntime(f);
	f.events.length = 0;
	const before = snapshot(f.dir);
	const read = f.options.fsImpl.readFileSync;
	f.options.fsImpl.readFileSync = (p, ...rest) => {
		expect(p).not.toContain("/data/");
		return read(p, ...rest);
	};
	expect(await configureExecutorServer(origin, f.options)).toBe(true);
	expect(snapshot(f.dir)).toEqual(before);
	expect(
		f.events.some(
			(e) =>
				e[1] === "pull" ||
				e.includes("up") ||
				e[0] === "chown" ||
				e[1] === "image",
		),
	).toBe(false);
	expect(f.events.filter((e) => e[0] === "GET")).toHaveLength(4);
});
it.each([
	"unmanaged",
	"empty",
	"partial",
	"compose",
	"marker",
	"unknown",
	"data-symlink",
	"compose-symlink",
	"root-symlink",
	"ancestor-symlink",
	"data-uid",
	"data-gid",
	"unknown-data",
])("preserves conflicting %s state before pulling or starting", async (kind) => {
	const f = fixture();
	if (["empty", "unmanaged"].includes(kind)) {
		fs.mkdirSync(f.dir);
		if (kind === "unmanaged")
			fs.writeFileSync(
				path.join(f.dir, "docker-compose.yml"),
				"existing-secret-compose",
			);
	} else {
		expect(await configureExecutorServer(origin, f.options)).toBe(true);
		existingRuntime(f);
		expect(await configureExecutorServer(origin, f.options)).toBe(true);
		if (kind === "root-symlink") {
			fs.renameSync(f.dir, path.join(f.home, "preserved"));
			fs.symlinkSync(path.join(f.home, "preserved"), f.dir);
		}
		if (kind === "ancestor-symlink") {
			fs.symlinkSync(f.home, path.join(f.home, "alias"));
			f.dir = path.join(f.home, "alias", "executor");
			f.options.deploymentDir = f.dir;
			existingRuntime(f);
		}
		if (kind === "partial")
			fs.renameSync(
				path.join(f.dir, "data"),
				path.join(f.home, "preserved-data"),
			);
		if (kind === "compose")
			fs.appendFileSync(
				path.join(f.dir, "docker-compose.yml"),
				"\n# preserve me",
			);
		if (kind === "marker")
			fs.writeFileSync(path.join(f.dir, "haoshoku-executor.json"), "{bad");
		if (kind === "unknown")
			fs.writeFileSync(path.join(f.dir, ".env"), "private-secret");
		if (kind === "unknown-data")
			fs.writeFileSync(
				path.join(f.dir, "data", "unexpected"),
				"private-secret",
			);
		if (kind === "data-uid" || kind === "data-gid") {
			const lstat = f.options.fsImpl.lstatSync;
			f.options.fsImpl.lstatSync = (p) => {
				const st = lstat(p);
				if (p === path.join(f.dir, "data")) st[kind.slice(5)] = 1000;
				return st;
			};
		}
		for (const name of kind === "data-symlink"
			? ["data.db"]
			: kind === "compose-symlink"
				? ["docker-compose.yml"]
				: []) {
			const p =
				kind === "data-symlink"
					? path.join(f.dir, "data", name)
					: path.join(f.dir, name);
			fs.renameSync(p, path.join(f.home, "preserved-file"));
			fs.symlinkSync(path.join(f.home, "preserved-file"), p);
		}
	}
	const before = observePreservation(f);
	expect(await configureExecutorServer(origin, f.options)).toBe(false);
	expectPreserved(f, before);
	expect(f.messages.at(-1)).toContain("preflight");
	expect(f.messages.at(-1)).not.toContain("private-secret");
});
it.each([
	"port",
	"other-container",
	"named-container",
])("refuses conflicting %s with absent deployment directory", async (kind) => {
	const f = fixture();
	const original = f.options.runImpl;
	f.options.runImpl = async (a) => {
		if (
			(kind === "port" && a[0] === "ss") ||
			(kind !== "port" && a[1] === "ps")
		) {
			f.events.push(a);
			return {
				exitCode: 0,
				stdout:
					kind === "port"
						? "LISTEN 0 4096 0.0.0.0:4788 0.0.0.0:*"
						: JSON.stringify({
								Names:
									kind === "named-container" ? "executor-selfhost" : "other",
								Ports: kind === "other-container" ? "0.0.0.0:4788->80/tcp" : "",
							}),
			};
		}
		return original(a);
	};
	expect(await configureExecutorServer(origin, f.options)).toBe(false);
	expect(fs.existsSync(f.dir)).toBe(false);
	expect(f.events.some((e) => e[1] === "pull" || e.includes("up"))).toBe(false);
});
const identityDefects = [
	[
		"image",
		(c) => {
			c.image = image;
		},
	],
	[
		"running",
		(c) => {
			c.running = false;
		},
	],
	[
		"user",
		(c) => {
			c.user = "0:0";
		},
	],
	[
		"ports-parent",
		(c) => {
			c.ports = null;
		},
	],
	[
		"port-key-count",
		(c) => {
			c.ports["9999/tcp"] = [];
		},
	],
	[
		"bindings-parent",
		(c) => {
			c.ports["4788/tcp"] = null;
		},
	],
	[
		"binding-count",
		(c) => {
			c.ports["4788/tcp"].push({ ...c.ports["4788/tcp"][0] });
		},
	],
	[
		"binding-host-ip",
		(c) => {
			c.ports["4788/tcp"][0].HostIp = "0.0.0.0";
		},
	],
	[
		"binding-host-port",
		(c) => {
			c.ports["4788/tcp"][0].HostPort = "4789";
		},
	],
	[
		"mounts-parent",
		(c) => {
			c.mounts = null;
		},
	],
	[
		"mounts-empty",
		(c) => {
			c.mounts = [];
		},
	],
	[
		"mount-count",
		(c) => {
			c.mounts.push({ ...c.mounts[0] });
		},
	],
	[
		"mount-type",
		(c) => {
			c.mounts[0].Type = "volume";
		},
	],
	[
		"mount-source",
		(c) => {
			c.mounts[0].Source += "-other";
		},
	],
	[
		"mount-destination",
		(c) => {
			c.mounts[0].Destination = "/other";
		},
	],
	[
		"mount-rw",
		(c) => {
			c.mounts[0].RW = false;
		},
	],
	[
		"labels-parent",
		(c) => {
			c.labels = null;
		},
	],
	[
		"compose-project",
		(c) => {
			c.labels["com.docker.compose.project"] = "other";
		},
	],
	[
		"compose-service",
		(c) => {
			c.labels["com.docker.compose.service"] = "other";
		},
	],
	[
		"named-container",
		(_, r) => {
			r.listing = '{"Names":"other","Ports":""}';
		},
	],
	[
		"listener-address",
		(_, r) => {
			r.listener = "LISTEN 0 4096 0.0.0.0:4788 0.0.0.0:*";
		},
	],
];
for (const phase of ["managed rerun", "fresh post-start"]) {
	for (const [field, change] of identityDefects) {
		it(`refuses ${phase} identity ${field} without further effects`, async () => {
			const f = fixture();
			if (phase === "managed rerun") {
				expect(await configureExecutorServer(origin, f.options)).toBe(true);
				existingRuntime(f);
				expect(await configureExecutorServer(origin, f.options)).toBe(true);
			}
			const identity = container(f);
			const runtime = {};
			change(identity, runtime);
			existingRuntime(f, identity, runtime);
			let before;
			if (phase === "managed rerun") before = observePreservation(f);
			else {
				const run = f.options.runImpl;
				f.options.runImpl = async (a) => {
					const result = await run(a);
					if (a.includes("up")) before = observePreservation(f);
					return result;
				};
			}
			expect(await configureExecutorServer(origin, f.options)).toBe(false);
			expect(before).toBeDefined();
			expectPreserved(f, before);
			expect(f.messages.at(-1)).toContain(
				phase === "managed rerun" ? "preflight" : "container startup",
			);
		});
	}
}

it.each([
	"wrong-health",
	"wrong-origin",
	"wrong-endpoint",
	"empty-json",
	"proxy-html",
	"generic-401",
	"malformed",
	"unreachable",
	"timeout",
	"redirect",
	"wrong-response-url",
	"slow-body",
])("reports incomplete verification for %s without leaking response details", async (kind) => {
	const f = fixture();
	let probes = 0;
	const original = f.options.fetchImpl;
	f.options.probeTimeoutMs = 10;
	f.options.readinessAttempts = 2;
	f.options.fetchImpl = async (url, options) => {
		probes++;
		if (kind === "timeout") return new Promise(() => {});
		if (kind === "unreachable") throw new Error("secret unreachable endpoint");
		if (kind === "redirect")
			return new Response("secret", {
				status: 302,
				headers: { location: "https://wrong.example" },
			});
		if (kind === "generic-401") return new Response("secret", { status: 401 });
		if (kind === "slow-body")
			return new Response(new ReadableStream({ start() {} }), {
				headers: { "content-type": "application/json" },
			});
		if (kind === "malformed" || kind === "proxy-html")
			return new Response(
				kind === "malformed" ? "{bad-secret" : "<html>proxy-secret</html>",
				{
					headers: {
						"content-type":
							kind === "proxy-html" ? "text/html" : "application/json",
					},
				},
			);
		if (kind === "empty-json") return Response.json({});
		if (kind === "wrong-health" && url.endsWith("/api/health"))
			return Response.json({ status: "degraded" });
		const r = await original(url, options);
		if (kind === "wrong-response-url")
			Object.defineProperty(r, "url", {
				value: "https://wrong.example/api/health",
			});
		if (url.endsWith("oauth-authorization-server")) {
			const b = await r.json();
			if (kind === "wrong-origin") b.issuer = "https://wrong.example/api/auth";
			if (kind === "wrong-endpoint")
				b.authorization_endpoint = `${origin}/unexpected`;
			return Response.json(b);
		}
		return r;
	};
	expect(
		await Promise.race([
			configureExecutorServer(origin, f.options),
			Bun.sleep(150).then(() => "UNBOUNDED"),
		]),
	).toBe(false);
	expect(f.messages.at(-1)).toContain(
		"application and public-origin verification",
	);
	expect(f.messages.join("\n")).not.toContain("container ready");
	expect(f.messages.join("\n")).not.toContain("secret");
	expect(probes).toBeLessThanOrEqual(8);
});
for (const [location, base] of [
	["local", "http://127.0.0.1:4788"],
	["public", origin],
]) {
	for (const [document, route] of [
		["health", "/api/health"],
		["metadata", "/.well-known/oauth-authorization-server"],
	]) {
		for (const [bytes, accepted] of [
			[16_384, true],
			[16_385, false],
		]) {
			it(`readiness ${accepted ? "accepts" : "refuses"} ${bytes}-byte ${location} ${document}`, async () => {
				const f = fixture();
				const original = f.options.fetchImpl;
				const target = `${base}${route}`;
				f.options.readinessAttempts = 1;
				f.options.probeTimeoutMs = 1_000;
				f.options.fetchImpl = async (url, options) => {
					const response = await original(url, options);
					if (url !== target) return response;
					const body = { ...(await response.json()), padding: "response-secret" };
					const remaining = bytes - Buffer.byteLength(JSON.stringify(body));
					body.padding +=
						"é".repeat(Math.floor(remaining / 2)) + "x".repeat(remaining % 2);
					const encoded = new TextEncoder().encode(JSON.stringify(body));
					expect(encoded.byteLength).toBe(bytes);
					return new Response(
						new ReadableStream({
							start(controller) {
								controller.enqueue(encoded.slice(0, 8_192));
								controller.enqueue(encoded.slice(8_192));
								controller.close();
							},
						}),
						{ headers: { "content-type": "application/json" } },
					);
				};
				expect(await configureExecutorServer(origin, f.options)).toBe(accepted);
				expect(f.messages.join("\n")).not.toContain("response-secret");
				const probes = f.events.filter((e) => e[0] === "GET");
				expect(probes.some((e) => e[1] === target)).toBe(true);
				if (accepted) expect(probes).toHaveLength(4);
				else {
					expect(probes.at(-1)[1]).toBe(target);
					expect(f.messages.at(-1)).toContain(
						"application and public-origin verification",
					);
					expect(f.messages.join("\n")).not.toContain("container ready");
				}
			});
		}
	}
	for (const endpoint of ["token_endpoint", "registration_endpoint"]) {
		it(`refuses wrong ${location} ${endpoint} with all other discovery fields valid`, async () => {
			const f = fixture();
			const original = f.options.fetchImpl;
			f.options.readinessAttempts = 1;
			f.options.fetchImpl = async (url, options) => {
				const response = await original(url, options);
				if (url !== `${base}/.well-known/oauth-authorization-server`)
					return response;
				const body = await response.json();
				body[endpoint] = `${origin}/unexpected`;
				return Response.json(body);
			};
			expect(await configureExecutorServer(origin, f.options)).toBe(false);
			expect(f.messages.at(-1)).toContain(
				"application and public-origin verification",
			);
			expect(f.messages.join("\n")).not.toContain("container ready");
		});
	}
}
it("retries transient readiness and checks local plus public application contracts", async () => {
	const f = fixture();
	const original = f.options.fetchImpl;
	let first = true;
	let sleeps = 0;
	f.options.fetchImpl = async (url, options) => {
		expect(options.redirect).toBe("error");
		expect(options.signal).toBeInstanceOf(AbortSignal);
		if (first) {
			first = false;
			return new Response("not ready", { status: 503 });
		}
		return original(url, options);
	};
	f.options.sleepImpl = async () => {
		sleeps++;
	};
	expect(await configureExecutorServer(origin, f.options)).toBe(true);
	expect(sleeps).toBe(1);
});
it.each([
	"pull",
	"digest",
	"user",
	"volume",
	"startup",
])("preserves truthful unfinished step on failed %s command", async (kind) => {
	const f = fixture({
		failCommand: (a) =>
			kind === "pull"
				? a[1] === "pull"
				: kind === "startup" && a.includes("up"),
	});
	const original = f.options.runImpl;
	f.options.runImpl = async (a) => {
		const r = await original(a);
		if (kind === "digest" && a.at(-1).includes("RepoDigests")) r.stdout = "[]";
		if (kind === "user" && a.at(-1).includes("User")) r.stdout = "0:0";
		if (kind === "volume" && a.at(-1).includes("Volumes")) r.stdout = "{}";
		return r;
	};
	expect(await configureExecutorServer(origin, f.options)).toBe(false);
	expect(f.messages.at(-1)).toContain(
		kind === "startup"
			? "container startup"
			: "image pull and runtime contract",
	);
	expect(f.messages.join("\n")).not.toContain("secret");
	if (kind !== "startup") expect(fs.existsSync(f.dir)).toBe(false);
	else {
		const before = snapshot(f.dir);
		f.events.length = 0;
		expect(await configureExecutorServer(origin, f.options)).toBe(false);
		expect(snapshot(f.dir)).toEqual(before);
		expect(f.events.some((e) => e[1] === "pull" || e.includes("up"))).toBe(
			false,
		);
	}
});

it("refuses data appearing during directory preparation before ownership or startup", async () => {
	const f = fixture();
	const mkdir = f.options.fsImpl.mkdirSync;
	f.options.fsImpl.mkdirSync = (p, options) => {
		mkdir(p, options);
		if (p === path.join(f.dir, "data"))
			fs.writeFileSync(path.join(p, "secret.key"), "preserve-new-secret");
	};
	expect(await configureExecutorServer(origin, f.options)).toBe(false);
	expect(fs.readFileSync(path.join(f.dir, "data", "secret.key"), "utf8")).toBe(
		"preserve-new-secret",
	);
	expect(f.events.some((e) => e[0] === "chown" || e.includes("up"))).toBe(
		false,
	);
});
it("refuses malformed Docker daemon identity before pull or configuration", async () => {
	const f = fixture();
	const run = f.options.runImpl;
	f.options.runImpl = async (a) =>
		a[1] === "info" ? { exitCode: 0, stdout: "" } : run(a);
	expect(await configureExecutorServer(origin, f.options)).toBe(false);
	expect(fs.existsSync(f.dir)).toBe(false);
	expect(f.events.some((e) => e[1] === "pull")).toBe(false);
});
it("does not claim a fresh container ready after successful up if the container stopped", async () => {
	const f = fixture();
	const original = f.options.runImpl;
	f.options.runImpl = async (a) => {
		if (a[1] === "ps" && fs.existsSync(f.dir))
			return {
				exitCode: 0,
				stdout: '{"Names":"executor-selfhost","Ports":""}',
			};
		if (a[1] === "inspect")
			return {
				exitCode: 0,
				stdout: JSON.stringify({ ...container(f), running: false }),
			};
		return original(a);
	};
	expect(await configureExecutorServer(origin, f.options)).toBe(false);
	expect(f.messages.at(-1)).toContain("container startup");
	expect(f.events.some((e) => e[0] === "GET")).toBe(false);
});
