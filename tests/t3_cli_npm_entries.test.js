import { afterEach, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareArchT3Cli, prepareT3Cli } from "../src/helpers/t3_cli.js";

const homes = [];
afterEach(() => {
	for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true });
});

function fixture(bin = { t3: "bin/t3.mjs" }) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "t3-npm-entries-"));
	homes.push(home);
	const prefix = path.join(home, ".local");
	const cli = path.join(prefix, "bin/t3");
	const packageDir = path.join(prefix, "lib/node_modules/t3");
	const events = [];
	const write = (file, data) => {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, data);
	};
	const seed = (destination, entry, version, metadataBin = { t3: entry }) => {
		const pkg = path.join(destination, "lib/node_modules/t3");
		write(
			path.join(pkg, entry),
			`#!${process.execPath}\nconsole.log("t3 v${version}");\n`,
		);
		fs.chmodSync(path.join(pkg, entry), 0o755);
		write(
			path.join(pkg, "package.json"),
			JSON.stringify({ name: "t3", version, bin: metadataBin }),
		);
		fs.mkdirSync(path.join(destination, "bin"), { recursive: true });
		fs.symlinkSync(
			`../lib/node_modules/t3/${entry}`,
			path.join(destination, "bin/t3"),
		);
	};
	const capture = async (command) => {
		events.push(command);
		if (command === "command -v t3")
			return {
				stdout: fs.existsSync(cli) ? cli : "",
				exitCode: fs.existsSync(cli) ? 0 : 127,
			};
		if (command === "node --version")
			return { stdout: "v24.10.0", exitCode: 0 };
		if (command === "command -v node")
			return { stdout: "/usr/bin/node", exitCode: 0 };
		if (command === "npm --version") return { stdout: "10.9.3", exitCode: 0 };
		const executable =
			command === "t3 --version"
				? cli
				: /^'([^']+)' --version$/.exec(command)?.[1];
		if (!executable || !fs.existsSync(executable))
			return { stdout: "", exitCode: 127 };
		const result = Bun.spawnSync([executable, "--version"]);
		return { stdout: result.stdout.toString(), exitCode: result.exitCode };
	};
	const probe = async (command) => {
		const result = await capture(command);
		return result.exitCode === 0 ? result.stdout.trim() : null;
	};
	const options = {
		home,
		env: {},
		fsImpl: {
			...fs,
			existsSync: (file) =>
				file.startsWith("/usr/") ? false : fs.existsSync(file),
		},
		latestStableImpl: async () => "0.1.3",
		captureCommandImpl: capture,
		probe,
		fail: (message) => {
			throw new Error(message);
		},
		runCommandImpl: async (command) => {
			events.push(command);
			const destination = /--prefix '([^']+)'/.exec(command)?.[1];
			if (!destination) throw new Error(`Unexpected mutation: ${command}`);
			seed(destination, typeof bin === "string" ? bin : bin.t3, "0.1.3", bin);
			return true;
		},
	};
	return { home, prefix, cli, packageDir, events, write, seed, options };
}

const entries = ["bin/t3.js", "./bin/t3.js", "bin/t3.mjs", "./bin/t3.mjs"];
it.each(
	entries.flatMap((entry) => [entry, { t3: entry }]),
)("installs and reuses the declared npm entry %j", async (bin) => {
	const f = fixture(bin);
	const entry = path.normalize(typeof bin === "string" ? bin : bin.t3);
	const result = await prepareArchT3Cli(f.options);
	expect(result.cliVersion).toBe("0.1.3");
	expect(fs.realpathSync(f.cli)).toBe(path.join(f.packageDir, entry));
	expect(f.events).toContain(`'${path.join(f.packageDir, entry)}' --version`);
	expect(await f.options.probe(`'${f.cli}' --version`)).toBe("t3 v0.1.3");
	f.events.length = 0;
	expect((await prepareArchT3Cli(f.options)).cliVersion).toBe("0.1.3");
	expect(f.events.some((command) => command.startsWith("npm --global"))).toBe(
		false,
	);
});

it.each([
	"bin/t3.js",
	"bin/t3.mjs",
])("reuses %s through shared Debian CLI preparation", async (entry) => {
	const f = fixture();
	f.seed(f.prefix, entry, "0.1.3");
	expect((await prepareT3Cli(f.options)).cliVersion).toBe("0.1.3");
	expect(f.events.some((command) => command.startsWith("npm --global"))).toBe(
		false,
	);
});

it.each([
	["missing bin", undefined],
	["malformed bin", { t3: 7 }],
	["other command", { other: "bin/t3.mjs" }],
	["other file", { t3: "bin/other.mjs" }],
	["traversal", { t3: "bin/../bin/t3.mjs" }],
	["absolute path", { t3: "/bin/t3.mjs" }],
	["mismatched target", { t3: "bin/t3.js" }],
])("preserves an occupied npm alias with %s", async (_kind, bin) => {
	const f = fixture();
	f.seed(f.prefix, "bin/t3.mjs", "0.1.3");
	const metadata = JSON.stringify({ name: "t3", version: "0.1.3", bin });
	f.write(path.join(f.packageDir, "package.json"), metadata);
	const link = fs.readlinkSync(f.cli);
	await expect(prepareArchT3Cli(f.options)).rejects.toThrow();
	expect(fs.readlinkSync(f.cli)).toBe(link);
	expect(fs.readFileSync(path.join(f.packageDir, "package.json"), "utf8")).toBe(
		metadata,
	);
	expect(f.events.some((command) => command.startsWith("npm --global"))).toBe(
		false,
	);
});

it("rejects an official-looking entry that resolves outside the package", async () => {
	const f = fixture();
	f.seed(f.prefix, "bin/t3.mjs", "0.1.3");
	const entry = path.join(f.packageDir, "bin/t3.mjs");
	const external = path.join(f.home, "external.mjs");
	fs.renameSync(entry, external);
	fs.symlinkSync(external, entry);
	await expect(prepareArchT3Cli(f.options)).rejects.toThrow(
		"origin is unmanaged",
	);
	expect(fs.realpathSync(f.cli)).toBe(external);
	expect(f.events.some((command) => command.startsWith("npm --global"))).toBe(
		false,
	);
});

it("restores the previous package and alias if the mjs final-path probe fails", async () => {
	const f = fixture();
	f.seed(f.prefix, "bin/t3.js", "0.0.45");
	const old = fs.readFileSync(path.join(f.packageDir, "package.json"), "utf8");
	const run = f.options.runCommandImpl;
	f.options.runCommandImpl = async (command) => {
		await run(command);
		const stagePrefix = /--prefix '([^']+)'/.exec(command)[1];
		f.write(
			path.join(stagePrefix, "lib/node_modules/t3/bin/t3.mjs"),
			`#!${process.execPath}\nconsole.log(import.meta.path.includes(".t3-install-") ? "t3 v0.1.3" : "unknown");\n`,
		);
		return true;
	};
	await expect(prepareArchT3Cli(f.options)).rejects.toThrow("final path");
	expect(fs.readlinkSync(f.cli)).toBe("../lib/node_modules/t3/bin/t3.js");
	expect(fs.readFileSync(path.join(f.packageDir, "package.json"), "utf8")).toBe(
		old,
	);
	expect(await f.options.probe(`'${f.cli}' --version`)).toBe("t3 v0.0.45");
	expect(
		fs.readdirSync(f.prefix).some((name) => name.startsWith(".t3-install-")),
	).toBe(false);
});
