import { afterEach, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { preflightT3Desktop } from "../src/helpers/t3_desktop_preflight.js";

const homes = [];
afterEach(() => {
	for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true });
});

const slices = [
	"app-t3code.slice",
	"app-t3code-agents.slice",
	"app-t3code-agents-2302bd46fe12.slice",
];
const show = (unit) =>
	`systemctl --user show '${unit}' --property=Environment,ExecStart,EnvironmentFiles`;

function fixture() {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "t3-desktop-slices-"));
	homes.push(home);
	const baseDir = path.join(home, ".t3");
	const settings = path.join(baseDir, "userdata/desktop-settings.json");
	const probes = [],
		reads = [],
		failures = [];
	const state = { units: [...slices], processes: "", processEnvironment: "" };
	const writeSettings = () => {
		fs.mkdirSync(path.dirname(settings), { recursive: true });
		fs.writeFileSync(
			settings,
			'{"localEnvironmentEnabled":false,"windowWidth":1400}',
		);
	};
	const options = {
		home,
		env: {},
		stableVersion: "0.1.3",
		cliVersion: "0.1.3",
		fail: (message) => failures.push(message),
		fsImpl: {
			...fs,
			statSync(file) {
				if (file.startsWith("/usr/") || file.startsWith("/opt/"))
					throw Object.assign(new Error("absent fixture desktop"), {
						code: "ENOENT",
					});
				return fs.statSync(file);
			},
			readdirSync(directory) {
				return directory === "/usr/share/applications"
					? []
					: fs.readdirSync(directory);
			},
			readFileSync(file, encoding) {
				reads.push(file);
				return file === "/proc/42/environ"
					? state.processEnvironment
					: fs.readFileSync(file, encoding);
			},
		},
		captureCommandImpl: async (command) => {
			probes.push(command);
			let stdout = "";
			if (command.includes("show t3code.service "))
				stdout = "LoadState=not-found\nEnvironment=\n";
			else if (command.includes("list-units "))
				stdout = state.units
					.map((unit) => `${unit} loaded active active ${unit}`)
					.join("\n");
			else if (command.includes("list-unit-files "))
				stdout = state.units.map((unit) => `${unit} transient -`).join("\n");
			else if (command === "ps -eo pid=,comm=,args=") stdout = state.processes;
			else if (command === "command -v t3code t3code-nightly")
				return { stdout: "", exitCode: 1 };
			else if (!state.units.some((unit) => command === show(unit)))
				throw new Error(`Unexpected fixture probe: ${command}`);
			// Recorded grouping slices return exit 0 with empty selected properties.
			return { stdout, exitCode: 0 };
		},
	};
	return {
		baseDir,
		settings,
		probes,
		reads,
		failures,
		state,
		options,
		writeSettings,
	};
}

it.each([
	true,
	false,
])("permits the Dell grouping slices with existing desktop settings=%s", async (existing) => {
	const f = fixture();
	if (existing) f.writeSettings();
	const before = existing ? fs.readFileSync(f.settings, "utf8") : null;
	expect(
		await preflightT3Desktop(f.options),
		JSON.stringify(f.failures),
	).toEqual({
		baseDir: f.baseDir,
		serviceNeedsUpdate: false,
	});
	expect(f.failures).toEqual([]);
	expect(fs.existsSync(f.settings)).toBe(existing);
	if (existing) expect(fs.readFileSync(f.settings, "utf8")).toBe(before);
	expect(f.probes).toContain("ps -eo pid=,comm=,args=");
});

it("still refuses an unverifiable desktop service beside grouping slices", async () => {
	const f = fixture();
	f.writeSettings();
	f.state.units.push("t3code-desktop.service");
	expect(await preflightT3Desktop(f.options)).toBeNull();
	expect(f.probes).toContain(show("t3code-desktop.service"));
	expect(f.failures).toHaveLength(1);
});

it("still checks a desktop scope and conflicting process directory beside grouping slices", async () => {
	const f = fixture();
	f.writeSettings();
	const scope = "app-com.t3tools.T3Code-3550208.scope";
	f.state.units.push(scope);
	f.state.processes = "42 t3code /usr/lib/t3code/t3code\n";
	f.state.processEnvironment = `T3CODE_HOME=${f.baseDir}/other\0`;
	expect(await preflightT3Desktop(f.options)).toBeNull();
	expect(f.probes).toContain(show(scope));
	expect(f.reads).toContain("/proc/42/environ");
	expect(f.failures).toHaveLength(1);
});
