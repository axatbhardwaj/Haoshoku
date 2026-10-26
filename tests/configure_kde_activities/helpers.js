import fs from "node:fs";
import path from "node:path";

const MODULE_PATH = "../../src/helpers/configure_kde_activities.js";
const SCRIPT_PATH = path.join(
	import.meta.dir,
	"..",
	"..",
	"configs",
	"kwin",
	"scripts",
	"haoshoku-activities-placement",
	"contents",
	"code",
	"main.js",
);
const FIXTURES_PATH = path.join(import.meta.dir, "../fixtures");

const IDS = {
	flux: "11111111-1111-4111-8111-111111111111",
	defi: "22222222-2222-4222-8222-222222222222",
	palmUSD: "33333333-3333-4333-8333-333333333333",
};
const ADD_FAILURE_ID = "66666666-6666-4666-8666-666666666666";

const CLASSES = {
	notion: "brave-dcokohelbbehjlcjjfmhfbpdgfjcoopf-Default",
	spotify: "Spotify",
	braveFlux: "brave-flux",
	steam: "steam",
	vesktop: "vesktop",
	whatsapp: "brave-hnpfjngllnobngcgfapefoaidbinmjnm-Default",
	telegram: "org.telegram.desktop",
	signal: "signal",
	braveDefi: "brave-defi",
	teams: "teams-for-linux",
};

const SCREEN_GEOMETRIES = {
	"HDMI-A-1": { x: 3640, y: 491, width: 1920, height: 1080 },
	"DP-1": { x: 1080, y: 244, width: 2560, height: 1440 },
	"DP-2": { x: 0, y: 0, width: 1080, height: 1920 },
};

async function activitiesModule() {
	return import(MODULE_PATH);
}

function section(content, name) {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const heading = content.match(
		new RegExp(`^\\[${escaped}\\](?:\\r?\\n|$)`, "m"),
	);
	if (!heading) return;
	const bodyStart = heading.index + heading[0].length;
	const nextSection = content.slice(bodyStart).search(/^\[/m);
	const end = nextSection === -1 ? content.length : bodyStart + nextSection;
	return content.slice(heading.index, end);
}

function activityDb(entries, options = {}) {
	const names = new Map(entries);
	const calls = [];
	let nextId = 4;

	return {
		calls,
		names,
		runCapture: async (args) => {
			calls.push(args);
			const method = args[3];
			if (options.listFailure && method.endsWith(".ListActivities")) {
				return { exitCode: 1, stdout: "", stderr: "unavailable" };
			}
			if (method.endsWith(".ListActivities")) {
				return {
					exitCode: 0,
					stdout: `${[...names.keys()].join("\n")}\n`,
					stderr: "",
				};
			}
			if (method.endsWith(".ActivityName")) {
				const name = names.get(args[4]);
				return {
					exitCode: options.nameFailure === args[4] ? 1 : 0,
					stdout: options.emptyName === args[4] ? "\n" : `${name ?? ""}\n`,
					stderr: "",
				};
			}
			if (method.endsWith(".AddActivity")) {
				if (options.addFailure === args[4]) {
					names.set(ADD_FAILURE_ID, args[4]);
					return {
						exitCode: 1,
						stdout: `${ADD_FAILURE_ID}\n`,
						stderr: "add failed",
					};
				}
				if (options.malformedAdd === args[4]) {
					return { exitCode: 0, stdout: "not-a-uuid\n", stderr: "" };
				}
				const id = `${nextId}${String(nextId).repeat(7)}-${String(nextId).repeat(4)}-4${String(nextId).repeat(3)}-8${String(nextId).repeat(3)}-${String(nextId).repeat(12)}`;
				nextId += 1;
				names.set(id, args[4]);
				return { exitCode: 0, stdout: `${id}\n`, stderr: "" };
			}
			throw new Error(`Unexpected capture command: ${args.join(" ")}`);
		},
	};
}

function guarded(object) {
	return new Proxy(object, {
		get(target, property, receiver) {
			if (property === "activities") {
				throw new Error("activities must not be read");
			}
			return Reflect.get(target, property, receiver);
		},
		set(target, property, value, receiver) {
			if (property === "output") throw new Error("output is read-only");
			return Reflect.set(target, property, value, receiver);
		},
	});
}

function loadPlacementHarness(
	screenNames = ["HDMI-A-1", "DP-1", "DP-2"],
	clientArea,
) {
	const callbacks = [];
	const workspaceState = {
		screens: screenNames.map((name) =>
			guarded({ name, geometry: SCREEN_GEOMETRIES[name] }),
		),
		currentDesktop: "desktop-1",
		windowAdded: {
			connect(callback) {
				callbacks.push(callback);
			},
		},
	};
	if (clientArea) workspaceState.clientArea = clientArea;
	const workspace = guarded(workspaceState);
	const source = fs.readFileSync(SCRIPT_PATH, "utf8");
	new Function("workspace", "print", source)(workspace, () => {});
	return { callbacks, workspace };
}

export {
	SCREEN_GEOMETRIES,
	IDS,
	CLASSES,
	SCRIPT_PATH,
	FIXTURES_PATH,
	activitiesModule,
	section,
	activityDb,
	guarded,
	loadPlacementHarness,
};
