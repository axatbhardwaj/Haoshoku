const MANIFEST = [
	{
		id: "crmne.hyprmoncfg",
		url: "https://github.com/crmne/omarchy-hyprmoncfg.git",
		manualAuth:
			"Needs the hyprmoncfg AUR package and daemon (installed separately; not handled by this installer)",
	},
	{
		id: "white.nights",
		url: "https://github.com/nightdevil00/white.nights.git",
		manualAuth: null,
	},
	{
		id: "io.github.ciryon.pullbar",
		url: "https://github.com/ciryon/omarchy-pullbar.git",
		manualAuth: "GitHub CLI auth (`gh auth login`)",
	},
	{
		id: "io.github.treramey.raindrop-bookmarks",
		url: "https://github.com/treramey/omarchy-raindrop-bookmarks.git",
		manualAuth: "Raindrop API token",
	},
	{
		id: "omaconnect",
		url: "https://github.com/jitendradara12/omaconnect.git",
		manualAuth: "KDE Connect pairing",
	},
	{
		id: "io.github.thetrueferret.decent-workspaces",
		url: "https://github.com/TheTrueFerret/omarchy-decent-workspaces.git",
		manualAuth: null,
		disableOnInstall: ["omarchy.workspaces"],
	},
	{
		id: "dizziee.system-stats",
		url: "https://github.com/JJDizz1L/dizziee.system-stats.git",
		manualAuth: null,
	},
	{
		id: "aislandener.galaxy-buds",
		url: "https://github.com/aislandener/galaxy-buds-control.git",
		manualAuth: "Galaxy Buds Bluetooth pairing",
	},
	{
		id: "io.github.nag3sy.feishin",
		url: "https://github.com/nag3sy/feishin-omarchy-plugin.git",
		manualAuth: null,
	},
];

const DECENT_WORKSPACES = MANIFEST.find(
	(plugin) => plugin.id === "io.github.thetrueferret.decent-workspaces",
);

const MISSING_WHEN_FIRST_8_PRESENT = ["io.github.nag3sy.feishin"];

const MANUAL_AUTH_IDS = [
	"crmne.hyprmoncfg",
	"io.github.ciryon.pullbar",
	"io.github.treramey.raindrop-bookmarks",
	"omaconnect",
	"aislandener.galaxy-buds",
];

function installedJson(
	enabledIds,
	{ disabled = [], includeFirstParty = true } = {},
) {
	const ids = [...enabledIds, ...disabled];
	if (includeFirstParty && !ids.some((id) => id.startsWith("omarchy."))) {
		ids.unshift("omarchy.shell");
	}
	return JSON.stringify(
		ids.map((id) => ({
			id,
			enabled: !disabled.includes(id),
			firstParty: id.startsWith("omarchy."),
			kinds: ["bar"],
		})),
	);
}

function makeRunner({ installedJsonBody, failAddFor = [] } = {}) {
	const calls = [];
	const runner = async (argv) => {
		calls.push(argv);
		if (argv.join(" ") === "omarchy version") {
			return { exitCode: 0, stdout: "Omarchy 4.0.0\n", stderr: "" };
		}
		if (argv.join(" ") === "omarchy plugin list --json") {
			return { exitCode: 0, stdout: installedJsonBody, stderr: "" };
		}
		if (argv[1] === "plugin" && argv[2] === "add") {
			const entry = MANIFEST.find((plugin) => plugin.url === argv[3]);
			if (entry && failAddFor.includes(entry.id)) {
				return { exitCode: 1, stdout: "", stderr: "clone failed" };
			}
			return { exitCode: 0, stdout: "", stderr: "" };
		}
		return { exitCode: 0, stdout: "", stderr: "" };
	};
	return { calls, runner };
}

function makeLog() {
	const lines = { info: [], success: [], warning: [] };
	return {
		lines,
		logImpl: {
			info: (message) => lines.info.push(message),
			success: (message) => lines.success.push(message),
			warning: (message) => lines.warning.push(message),
			error: (message) => lines.warning.push(message),
			dim: (message) => lines.info.push(message),
		},
	};
}

function commandType(calls, subcommand) {
	return calls.filter(
		(argv) => argv[0] === "omarchy" && argv[2] === subcommand,
	);
}

export {
	MANIFEST,
	DECENT_WORKSPACES,
	MISSING_WHEN_FIRST_8_PRESENT,
	MANUAL_AUTH_IDS,
	installedJson,
	makeRunner,
	makeLog,
	commandType,
};
