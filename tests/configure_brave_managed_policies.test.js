import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureBraveManagedPolicies } from "../src/helpers/configure_brave_managed_policies.js";

const temporaryDirectories = [];
const TEST_UID = 1234;
const TEST_GID = 5678;
const ANTI_HIJACK_POLICY = `${JSON.stringify(
	{ DefaultBrowserSettingEnabled: false },
	null,
	"\t",
)}\n`;
const FALLBACK_COLOR_POLICY =
	'{"BrowserThemeColor": "#1c2027", "BrowserColorScheme": "device"}\n';

function makePolicyEnvironment() {
	const root = fs.mkdtempSync(
		path.join(os.tmpdir(), "haoshoku-brave-policies-"),
	);
	temporaryDirectories.push(root);

	const policyDirectory = path.join(
		root,
		"etc",
		"brave",
		"policies",
		"managed",
	);
	const chromiumPolicyDirectory = path.join(
		root,
		"etc",
		"chromium",
		"policies",
		"managed",
	);
	const themeFile = path.join(
		root,
		"home",
		".config",
		"omarchy",
		"current",
		"theme",
		"chromium.theme",
	);
	const temporaryDirectory = path.join(root, "tmp");
	fs.mkdirSync(temporaryDirectory, { mode: 0o700 });

	const metadata = new Map();
	const commands = [];
	const readTargets = [];
	const writeCalls = [];

	function assertTemporaryTarget(target) {
		if (!path.resolve(target).startsWith(`${root}${path.sep}`)) {
			throw new Error(`filesystem escape from test temp directory: ${target}`);
		}
	}

	function setMetadata(target, { uid, gid, mode }) {
		assertTemporaryTarget(target);
		metadata.set(path.resolve(target), { uid, gid });
		if (mode !== undefined) fs.chmodSync(target, mode);
	}

	function deleteMetadataTree(target) {
		const resolvedTarget = path.resolve(target);
		for (const entry of metadata.keys()) {
			if (
				entry === resolvedTarget ||
				entry.startsWith(`${resolvedTarget}${path.sep}`)
			) {
				metadata.delete(entry);
			}
		}
	}

	function createDirectory(target, { uid = 0, gid = 0, mode = 0o755 } = {}) {
		assertTemporaryTarget(target);
		markCreatedComponents(target, uid, gid);
		fs.chmodSync(target, mode);
		setMetadata(target, { uid, gid });
	}

	function writeFile(target, content, { uid = 0, gid = 0, mode = 0o644 } = {}) {
		assertTemporaryTarget(target);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, content, { mode });
		fs.chmodSync(target, mode);
		setMetadata(target, { uid, gid });
	}

	function markCreatedComponents(target, uid, gid) {
		let current = root;
		for (const component of path.relative(root, target).split(path.sep)) {
			current = path.join(current, component);
			if (!fs.existsSync(current)) {
				fs.mkdirSync(current, { mode: 0o755 });
				setMetadata(current, { uid, gid, mode: 0o755 });
			}
		}
	}

	function applyPrivilegedCommand(command) {
		commands.push(command);
		for (const operation of command.split(" && ")) {
			let match = operation.match(/^sudo(?: -n)? bash -c .* _ '([^']+)'$/);
			if (match) {
				const target = match[1];
				assertTemporaryTarget(target);
				try {
					const stat = fs.lstatSync(target);
					if (stat.isSymbolicLink() || !stat.isDirectory()) {
						fs.rmSync(target, { recursive: true, force: true });
						metadata.delete(path.resolve(target));
					}
				} catch {}
				markCreatedComponents(target, 0, 0);
				fs.chmodSync(target, 0o755);
				setMetadata(target, { uid: 0, gid: 0 });
				continue;
			}

			match = operation.match(
				/^sudo install -d(?: -o ([^ ]+) -g ([^ ]+))? -m 0755 '([^']+)'$/,
			);
			if (match) {
				const [, owner, group, target] = match;
				assertTemporaryTarget(target);
				const uid = owner === undefined || owner === "root" ? 0 : Number(owner);
				const gid = group === undefined || group === "root" ? 0 : Number(group);
				markCreatedComponents(target, uid, gid);
				fs.chmodSync(target, 0o755);
				if (owner !== undefined) setMetadata(target, { uid, gid });
				continue;
			}

			match = operation.match(
				/^sudo(?: -n)? chown ([^: ]+):([^ ]+) -- '([^']+)'$/,
			);
			if (match) {
				const [, owner, group, target] = match;
				const unquote = (value) =>
					value.startsWith("'") && value.endsWith("'")
						? value.slice(1, -1)
						: value;
				setMetadata(target, {
					uid: unquote(owner) === "root" ? 0 : Number(unquote(owner)),
					gid: unquote(group) === "root" ? 0 : Number(unquote(group)),
				});
				continue;
			}

			match = operation.match(/^sudo chmod 0755 '([^']+)'$/);
			if (match) {
				assertTemporaryTarget(match[1]);
				fs.chmodSync(match[1], 0o755);
				continue;
			}

			match = operation.match(/^sudo rm -rf -- '([^']+)'$/);
			if (match) {
				const target = match[1];
				assertTemporaryTarget(target);
				fs.rmSync(target, { recursive: true, force: true });
				metadata.delete(path.resolve(target));
				continue;
			}

			match = operation.match(
				/^sudo install -o root -g root -m 0644 '([^']+)' '([^']+)'$/,
			);
			if (match) {
				const [, source, destination] = match;
				assertTemporaryTarget(source);
				assertTemporaryTarget(destination);
				fs.copyFileSync(source, destination);
				setMetadata(destination, { uid: 0, gid: 0, mode: 0o644 });
				continue;
			}

			throw new Error(`unexpected privileged test operation: ${operation}`);
		}
		return true;
	}

	const fsImpl = {
		existsSync(target) {
			assertTemporaryTarget(target);
			return fs.existsSync(target);
		},
		statSync(target) {
			assertTemporaryTarget(target);
			const stat = fs.statSync(target);
			const override = metadata.get(path.resolve(target));
			return override ? Object.assign(stat, override) : stat;
		},
		lstatSync(target) {
			assertTemporaryTarget(target);
			const stat = fs.lstatSync(target);
			const override = metadata.get(path.resolve(target));
			return override ? Object.assign(stat, override) : stat;
		},
		readFileSync(target, encoding) {
			assertTemporaryTarget(target);
			readTargets.push(path.resolve(target));
			return fs.readFileSync(target, encoding);
		},
		writeFileSync(target, content, options) {
			assertTemporaryTarget(target);
			const existed = fs.existsSync(target);
			writeCalls.push({
				target: path.resolve(target),
				content,
				options,
			});
			const result = fs.writeFileSync(target, content, options);
			if (!existed) {
				setMetadata(target, {
					uid: TEST_UID,
					gid: TEST_GID,
					mode: options?.mode,
				});
			}
			return result;
		},
		mkdirSync(target, options) {
			assertTemporaryTarget(target);
			return fs.mkdirSync(target, options);
		},
		mkdtempSync(prefix) {
			assertTemporaryTarget(prefix);
			return fs.mkdtempSync(prefix);
		},
		rmSync(target, options) {
			assertTemporaryTarget(target);
			const result = fs.rmSync(target, options);
			deleteMetadataTree(target);
			return result;
		},
	};

	return {
		root,
		policyDirectory,
		chromiumPolicyDirectory,
		themeFile,
		temporaryDirectory,
		commands,
		readTargets,
		writeCalls,
		fsImpl,
		setMetadata,
		createDirectory,
		writeFile,
		runCommandImpl: async (command) => applyPrivilegedCommand(command),
	};
}

function configureOptions(environment, overrides = {}) {
	return {
		policyDirectory: environment.policyDirectory,
		chromiumPolicyDirectory: environment.chromiumPolicyDirectory,
		themeFile: environment.themeFile,
		temporaryDirectory: environment.temporaryDirectory,
		uid: TEST_UID,
		gid: TEST_GID,
		fsImpl: environment.fsImpl,
		commandExistsImpl: async () => true,
		runCommandImpl: environment.runCommandImpl,
		...overrides,
	};
}

function writeCorrectPolicies(
	environment,
	colorPolicy = FALLBACK_COLOR_POLICY,
	{ uid = TEST_UID, gid = TEST_GID } = {},
) {
	environment.writeFile(
		path.join(environment.policyDirectory, "no-default-hijack.json"),
		ANTI_HIJACK_POLICY,
		{ uid, gid, mode: 0o644 },
	);
	environment.writeFile(
		path.join(environment.policyDirectory, "color.json"),
		colorPolicy,
		{ uid, gid, mode: 0o644 },
	);
}

function createCorrectBravePolicyTree(
	environment,
	{ leafGid = TEST_GID } = {},
) {
	environment.createDirectory(path.dirname(environment.policyDirectory));
	environment.createDirectory(environment.policyDirectory, {
		uid: TEST_UID,
		gid: leafGid,
	});
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

describe("configureBraveManagedPolicies", () => {
	it("emits the exact privileged Brave and Chromium repair commands", async () => {
		const environment = makePolicyEnvironment();
		environment.createDirectory(environment.chromiumPolicyDirectory, {
			uid: TEST_UID,
			gid: TEST_GID,
			mode: 0o777,
		});
		const repairScript =
			'set -e; if [ -L "$1" ]; then rm -f -- "$1"; elif [ -e "$1" ]; then if [ ! -d "$1" ]; then rm -f -- "$1"; fi; fi; install -d -o root -g root -m 0755 -- "$1"';
		const repair = (target) => `sudo bash -c '${repairScript}' _ '${target}'`;
		const braveDirectories = [
			path.join(environment.root, "etc", "brave"),
			path.join(environment.root, "etc", "brave", "policies"),
			environment.policyDirectory,
		];
		const chromiumDirectories = [
			path.join(environment.root, "etc", "chromium"),
			path.join(environment.root, "etc", "chromium", "policies"),
			environment.chromiumPolicyDirectory,
		];

		await configureBraveManagedPolicies(configureOptions(environment));

		expect(environment.commands).toEqual([
			[
				...braveDirectories.map(repair),
				`sudo chown '${TEST_UID}':'${TEST_GID}' -- '${environment.policyDirectory}'`,
			].join(" && "),
			chromiumDirectories.map(repair).join(" && "),
		]);
	});

	it("keeps full-setup policy repairs non-interactive", async () => {
		const environment = makePolicyEnvironment();
		await configureBraveManagedPolicies(
			configureOptions(environment, { nonInteractiveSudo: true }),
		);

		expect(environment.commands.length).toBeGreaterThan(0);
		expect(
			environment.commands.every((command) =>
				command
					.split(" && ")
					.every((operation) => operation.startsWith("sudo -n ")),
			),
		).toBe(true);
	});

	it("offers a standalone --brave-managed-policies CLI mode without sudo when Brave is absent", () => {
		const environment = makePolicyEnvironment();
		const binDirectory = path.join(environment.root, "bin");
		fs.mkdirSync(binDirectory);
		fs.symlinkSync(Bun.which("bun"), path.join(binDirectory, "bun"));

		const result = Bun.spawnSync(
			[
				path.resolve(import.meta.dir, "..", "haoshoku.js"),
				"--brave-managed-policies",
			],
			{
				env: { HOME: environment.root, PATH: binDirectory },
				stdout: "pipe",
				stderr: "pipe",
			},
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toContain(
			"Brave Origin not found. Skipping managed-policy configuration.",
		);
		expect(environment.commands).toEqual([]);
	});

	it("creates root-owned parents and only a user-owned leaf on a fresh tree", async () => {
		const environment = makePolicyEnvironment();
		const result = await configureBraveManagedPolicies(
			configureOptions(environment),
		);

		expect(result).toBe(true);
		for (const target of [
			path.join(environment.root, "etc", "brave"),
			path.join(environment.root, "etc", "brave", "policies"),
		]) {
			const stat = environment.fsImpl.statSync(target);
			expect({
				uid: stat.uid,
				gid: stat.gid,
				mode: stat.mode & 0o7777,
			}).toEqual({ uid: 0, gid: 0, mode: 0o755 });
		}
		const leafStat = environment.fsImpl.statSync(environment.policyDirectory);
		expect({
			uid: leafStat.uid,
			gid: leafStat.gid,
			mode: leafStat.mode & 0o7777,
		}).toEqual({ uid: TEST_UID, gid: TEST_GID, mode: 0o755 });
	});

	it("replaces legacy root-owned policy files with invoking-user-owned mode 0644 files", async () => {
		const environment = makePolicyEnvironment();
		createCorrectBravePolicyTree(environment);
		writeCorrectPolicies(environment, FALLBACK_COLOR_POLICY, {
			uid: 0,
			gid: 0,
		});

		await configureBraveManagedPolicies(configureOptions(environment));

		for (const filename of ["no-default-hijack.json", "color.json"]) {
			const stat = environment.fsImpl.statSync(
				path.join(environment.policyDirectory, filename),
			);
			expect({
				uid: stat.uid,
				gid: stat.gid,
				mode: stat.mode & 0o7777,
			}).toEqual({ uid: TEST_UID, gid: TEST_GID, mode: 0o644 });
		}
	});

	it("performs no privileged work on repeated runs when state is correct", async () => {
		const environment = makePolicyEnvironment();
		createCorrectBravePolicyTree(environment, { leafGid: 0 });
		writeCorrectPolicies(environment);

		const firstResult = await configureBraveManagedPolicies(
			configureOptions(environment),
		);
		const secondResult = await configureBraveManagedPolicies(
			configureOptions(environment),
		);

		expect(firstResult).toBe(true);
		expect(secondResult).toBe(true);
		expect(environment.commands).toEqual([]);
		expect(environment.writeCalls).toEqual([]);
	});

	it("repairs a root-owned Brave leaf without changing its root-owned parents", async () => {
		const environment = makePolicyEnvironment();
		environment.createDirectory(environment.policyDirectory);
		writeCorrectPolicies(environment);

		await configureBraveManagedPolicies(configureOptions(environment));

		for (const target of [
			path.join(environment.root, "etc", "brave"),
			path.join(environment.root, "etc", "brave", "policies"),
		]) {
			const stat = environment.fsImpl.statSync(target);
			expect({ uid: stat.uid, gid: stat.gid }).toEqual({ uid: 0, gid: 0 });
		}
		const leafStat = environment.fsImpl.statSync(environment.policyDirectory);
		expect({
			uid: leafStat.uid,
			gid: leafStat.gid,
			mode: leafStat.mode & 0o7777,
		}).toEqual({ uid: TEST_UID, gid: TEST_GID, mode: 0o755 });
	});

	for (const scenario of [
		{
			name: "Brave parent",
			target: (environment) =>
				path.join(environment.root, "etc", "brave", "policies"),
			expectedOwner: { uid: 0, gid: 0 },
		},
		{
			name: "Brave leaf",
			target: (environment) => environment.policyDirectory,
			expectedOwner: { uid: TEST_UID, gid: TEST_GID },
		},
	]) {
		it(`tightens a world-writable ${scenario.name} to mode 0755`, async () => {
			const environment = makePolicyEnvironment();
			createCorrectBravePolicyTree(environment);
			writeCorrectPolicies(environment);
			const target = scenario.target(environment);
			environment.setMetadata(target, {
				...scenario.expectedOwner,
				mode: 0o777,
			});

			await configureBraveManagedPolicies(configureOptions(environment));

			const stat = environment.fsImpl.statSync(target);
			expect({
				uid: stat.uid,
				gid: stat.gid,
				mode: stat.mode & 0o7777,
			}).toEqual({ ...scenario.expectedOwner, mode: 0o755 });
		});
	}

	it("replaces symlinked Brave tree components without touching their referents", async () => {
		const environment = makePolicyEnvironment();
		const braveDirectory = path.join(environment.root, "etc", "brave");
		const outsideDirectory = path.join(environment.root, "outside-brave");
		environment.createDirectory(path.join(environment.root, "etc"));
		environment.createDirectory(outsideDirectory, {
			uid: 1234,
			gid: 5678,
			mode: 0o700,
		});
		fs.symlinkSync(outsideDirectory, braveDirectory, "dir");

		await configureBraveManagedPolicies(configureOptions(environment));

		expect(fs.lstatSync(braveDirectory).isSymbolicLink()).toBe(false);
		expect(fs.lstatSync(braveDirectory).isDirectory()).toBe(true);
		expect(fs.statSync(outsideDirectory).mode & 0o7777).toBe(0o700);
		expect(fs.existsSync(path.join(outsideDirectory, "policies"))).toBe(false);
	});

	it("derives the Brave theme policy from a decimal R,G,B theme fixture", async () => {
		const environment = makePolicyEnvironment();
		createCorrectBravePolicyTree(environment);
		environment.writeFile(environment.themeFile, "12,34,56\n", {
			uid: 1234,
			gid: 5678,
			mode: 0o644,
		});
		environment.writeFile(
			path.join(environment.policyDirectory, "color.json"),
			"stale\n",
		);

		await configureBraveManagedPolicies(configureOptions(environment));

		expect(
			environment.fsImpl.readFileSync(
				path.join(environment.policyDirectory, "color.json"),
				"utf8",
			),
		).toBe(
			'{"BrowserThemeColor": "#0c2238", "BrowserColorScheme": "device"}\n',
		);
	});

	it("uses Omarchy's neutral grey when chromium.theme is absent", async () => {
		const environment = makePolicyEnvironment();
		createCorrectBravePolicyTree(environment);
		environment.writeFile(
			path.join(environment.policyDirectory, "color.json"),
			"stale\n",
		);

		await configureBraveManagedPolicies(configureOptions(environment));

		expect(
			environment.fsImpl.readFileSync(
				path.join(environment.policyDirectory, "color.json"),
				"utf8",
			),
		).toBe(FALLBACK_COLOR_POLICY);
	});

	it("installs anti-hijack and theme settings in separate policy files", async () => {
		const environment = makePolicyEnvironment();
		createCorrectBravePolicyTree(environment);
		environment.writeFile(
			path.join(environment.policyDirectory, "no-default-hijack.json"),
			"stale\n",
		);
		environment.writeFile(
			path.join(environment.policyDirectory, "color.json"),
			"stale\n",
		);

		await configureBraveManagedPolicies(configureOptions(environment));

		expect(
			environment.fsImpl.readFileSync(
				path.join(environment.policyDirectory, "no-default-hijack.json"),
				"utf8",
			),
		).toBe(ANTI_HIJACK_POLICY);
		expect(
			environment.fsImpl.readFileSync(
				path.join(environment.policyDirectory, "color.json"),
				"utf8",
			),
		).toBe(FALLBACK_COLOR_POLICY);
	});

	it("replaces a symlinked policy leaf without reading or writing its referent", async () => {
		const environment = makePolicyEnvironment();
		createCorrectBravePolicyTree(environment);
		environment.writeFile(
			path.join(environment.policyDirectory, "no-default-hijack.json"),
			ANTI_HIJACK_POLICY,
		);
		const outsideFile = path.join(environment.root, "outside-color.json");
		const colorFile = path.join(environment.policyDirectory, "color.json");
		environment.writeFile(outsideFile, "outside sentinel\n");
		fs.symlinkSync(outsideFile, colorFile);
		environment.setMetadata(colorFile, { uid: 0, gid: 0 });

		await configureBraveManagedPolicies(configureOptions(environment));

		expect(environment.readTargets).not.toContain(path.resolve(colorFile));
		expect(fs.lstatSync(colorFile).isSymbolicLink()).toBe(false);
		expect(fs.lstatSync(colorFile).isFile()).toBe(true);
		expect(fs.readFileSync(outsideFile, "utf8")).toBe("outside sentinel\n");
		expect(fs.readFileSync(colorFile, "utf8")).toBe(FALLBACK_COLOR_POLICY);
	});

	for (const scenario of [
		{ name: "user-owned", uid: TEST_UID, gid: TEST_GID, mode: 0o755 },
		{ name: "world-writable", uid: 0, gid: 0, mode: 0o777 },
	]) {
		it(`repairs a ${scenario.name} Chromium managed-policy directory`, async () => {
			const environment = makePolicyEnvironment();
			createCorrectBravePolicyTree(environment);
			writeCorrectPolicies(environment);
			environment.createDirectory(
				environment.chromiumPolicyDirectory,
				scenario,
			);

			await configureBraveManagedPolicies(configureOptions(environment));

			const stat = environment.fsImpl.statSync(
				environment.chromiumPolicyDirectory,
			);
			expect({
				uid: stat.uid,
				gid: stat.gid,
				mode: stat.mode & 0o7777,
			}).toEqual({ uid: 0, gid: 0, mode: 0o755 });
		});
	}

	it("replaces a symlinked Chromium managed directory without touching its referent", async () => {
		const environment = makePolicyEnvironment();
		createCorrectBravePolicyTree(environment);
		writeCorrectPolicies(environment);
		environment.createDirectory(
			path.dirname(environment.chromiumPolicyDirectory),
		);
		const outsideDirectory = path.join(environment.root, "outside-chromium");
		environment.createDirectory(outsideDirectory, {
			uid: 1234,
			gid: 5678,
			mode: 0o700,
		});
		fs.symlinkSync(
			outsideDirectory,
			environment.chromiumPolicyDirectory,
			"dir",
		);

		await configureBraveManagedPolicies(configureOptions(environment));

		expect(
			fs.lstatSync(environment.chromiumPolicyDirectory).isSymbolicLink(),
		).toBe(false);
		expect(
			fs.lstatSync(environment.chromiumPolicyDirectory).isDirectory(),
		).toBe(true);
		expect(fs.statSync(outsideDirectory).mode & 0o7777).toBe(0o700);
	});

	it("keeps Brave policy provisioning successful when Chromium repair fails", async () => {
		const environment = makePolicyEnvironment();
		createCorrectBravePolicyTree(environment);
		writeCorrectPolicies(environment);
		environment.createDirectory(environment.chromiumPolicyDirectory, {
			uid: 1234,
			gid: 5678,
			mode: 0o777,
		});

		const result = await configureBraveManagedPolicies(
			configureOptions(environment, {
				runCommandImpl: async (command) => {
					environment.commands.push(command);
					return false;
				},
			}),
		);

		expect(result).toBe(true);
	});

	it("skips without filesystem or privileged work when Brave Origin is absent", async () => {
		const environment = makePolicyEnvironment();
		const result = await configureBraveManagedPolicies(
			configureOptions(environment, {
				commandExistsImpl: async () => false,
			}),
		);

		expect(result).toBe(true);
		expect(environment.commands).toEqual([]);
		expect(fs.existsSync(environment.policyDirectory)).toBe(false);
	});
});
