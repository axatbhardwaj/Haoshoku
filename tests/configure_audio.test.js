import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as audio from "../src/helpers/configure_audio.js";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const CONFIGS_AUDIO_DIR = path.join(PROJECT_ROOT, "configs", "audio");

let tmpHome;
let tmpProjectRoot;

beforeEach(() => {
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-audio-home-"));
	tmpProjectRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "haoshoku-audio-root-"),
	);
	// Seed the same directory skeleton that configure_audio expects
	fs.mkdirSync(
		path.join(tmpProjectRoot, "configs", "audio", "pipewire", "pipewire.conf.d"),
		{ recursive: true },
	);
	fs.mkdirSync(
		path.join(
			tmpProjectRoot,
			"configs",
			"audio",
			"pipewire",
			"pipewire-pulse.conf.d",
		),
		{ recursive: true },
	);
	fs.mkdirSync(
		path.join(tmpProjectRoot, "configs", "audio", "wireplumber", "pc"),
		{ recursive: true },
	);
	fs.mkdirSync(
		path.join(tmpProjectRoot, "configs", "audio", "wireplumber", "laptop"),
		{ recursive: true },
	);
});

afterEach(() => {
	fs.rmSync(tmpHome, { recursive: true, force: true });
	fs.rmSync(tmpProjectRoot, { recursive: true, force: true });
});

/** Seed fixture drop-in files in the temp projectRoot. */
function seedRepoFixtures({ pc = true, laptop = false } = {}) {
	fs.writeFileSync(
		path.join(
			tmpProjectRoot,
			"configs",
			"audio",
			"pipewire",
			"pipewire.conf.d",
			"10-allowed-rates.conf",
		),
		"# pipewire allowed rates\ncontext.properties = { default.clock.allowed-rates = [ 44100 48000 ] }\n",
	);
	fs.writeFileSync(
		path.join(
			tmpProjectRoot,
			"configs",
			"audio",
			"pipewire",
			"pipewire-pulse.conf.d",
			"50-spotify-44100.conf",
		),
		"# spotify pulse pin\n[pulse]\nnode.rate = 1/44100\n",
	);
	if (pc) {
		fs.writeFileSync(
			path.join(
				tmpProjectRoot,
				"configs",
				"audio",
				"wireplumber",
				"pc",
				"51-logitech-prox-44100.conf",
			),
			"# pc wireplumber rule\nrule.matches = [{ node.name = alsa_output.usb-Logitech_PRO_X_000000000000-00.analog-stereo }]\n",
		);
	}
	if (laptop) {
		fs.writeFileSync(
			path.join(
				tmpProjectRoot,
				"configs",
				"audio",
				"wireplumber",
				"laptop",
				"51-laptop-audio.conf",
			),
			"# laptop wireplumber rule\nrule.matches = [{ node.name = alsa_output.pci-0000_00_1f.3.analog-stereo }]\n",
		);
	}
}

function writeDeviceType(deviceType) {
	fs.writeFileSync(
		path.join(tmpHome, ".haoshoku.json"),
		JSON.stringify({ deviceType }),
	);
}

/** Seed live ~/.config/pipewire and wireplumber drop-ins for backup tests. */
function seedLiveAudio({ deviceType = "pc" } = {}) {
	const pipewireConfD = path.join(
		tmpHome,
		".config",
		"pipewire",
		"pipewire.conf.d",
	);
	const pipewirePulseConfD = path.join(
		tmpHome,
		".config",
		"pipewire",
		"pipewire-pulse.conf.d",
	);
	const wireplumberConfD = path.join(
		tmpHome,
		".config",
		"wireplumber",
		"wireplumber.conf.d",
	);
	fs.mkdirSync(pipewireConfD, { recursive: true });
	fs.mkdirSync(pipewirePulseConfD, { recursive: true });
	fs.mkdirSync(wireplumberConfD, { recursive: true });

	fs.writeFileSync(
		path.join(pipewireConfD, "10-allowed-rates.conf"),
		"# live pipewire conf.d\n",
	);
	fs.writeFileSync(
		path.join(pipewirePulseConfD, "50-spotify-44100.conf"),
		"# live pulse conf.d\n",
	);
	const wpFilename =
		deviceType === "laptop" ? "51-laptop-audio.conf" : "51-logitech-prox-44100.conf";
	fs.writeFileSync(
		path.join(wireplumberConfD, wpFilename),
		`# live wireplumber rule for ${deviceType}\n`,
	);
}

// ---------------------------------------------------------------------------
// Module shape
// ---------------------------------------------------------------------------

describe("configure_audio module shape", () => {
	it("exports syncAudioConfig, backupAudioConfig, configureAudio", () => {
		expect(typeof audio.syncAudioConfig).toBe("function");
		expect(typeof audio.backupAudioConfig).toBe("function");
		expect(typeof audio.configureAudio).toBe("function");
	});
});

// ---------------------------------------------------------------------------
// syncAudioConfig — repo → live
// ---------------------------------------------------------------------------

describe("syncAudioConfig — deploys portable PipeWire drop-ins", () => {
	it("deploys pipewire.conf.d files regardless of deviceType", async () => {
		seedRepoFixtures({ pc: true });
		writeDeviceType("pc");
		await audio.syncAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });

		const destFile = path.join(
			tmpHome,
			".config",
			"pipewire",
			"pipewire.conf.d",
			"10-allowed-rates.conf",
		);
		expect(fs.existsSync(destFile)).toBe(true);
		expect(fs.readFileSync(destFile, "utf8")).toMatch(/pipewire allowed rates/);
	});

	it("deploys pipewire-pulse.conf.d files regardless of deviceType", async () => {
		seedRepoFixtures({ pc: true });
		writeDeviceType("laptop");
		await audio.syncAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });

		const destFile = path.join(
			tmpHome,
			".config",
			"pipewire",
			"pipewire-pulse.conf.d",
			"50-spotify-44100.conf",
		);
		expect(fs.existsSync(destFile)).toBe(true);
		expect(fs.readFileSync(destFile, "utf8")).toMatch(/spotify pulse pin/);
	});

	it("creates ~/.config/pipewire/ sub-directories if missing", async () => {
		seedRepoFixtures({ pc: true });
		expect(
			fs.existsSync(path.join(tmpHome, ".config", "pipewire")),
		).toBe(false);
		await audio.syncAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });
		expect(
			fs.existsSync(
				path.join(tmpHome, ".config", "pipewire", "pipewire.conf.d"),
			),
		).toBe(true);
		expect(
			fs.existsSync(
				path.join(tmpHome, ".config", "pipewire", "pipewire-pulse.conf.d"),
			),
		).toBe(true);
	});
});

describe("syncAudioConfig — device-routed WirePlumber drop-ins", () => {
	it("deploys wireplumber/pc/ files when deviceType=pc", async () => {
		seedRepoFixtures({ pc: true });
		writeDeviceType("pc");
		await audio.syncAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });

		const destFile = path.join(
			tmpHome,
			".config",
			"wireplumber",
			"wireplumber.conf.d",
			"51-logitech-prox-44100.conf",
		);
		expect(fs.existsSync(destFile)).toBe(true);
		expect(fs.readFileSync(destFile, "utf8")).toMatch(/pc wireplumber rule/);
	});

	it("deploys wireplumber/laptop/ files when deviceType=laptop", async () => {
		seedRepoFixtures({ pc: true, laptop: true });
		writeDeviceType("laptop");
		await audio.syncAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });

		const destFile = path.join(
			tmpHome,
			".config",
			"wireplumber",
			"wireplumber.conf.d",
			"51-laptop-audio.conf",
		);
		expect(fs.existsSync(destFile)).toBe(true);
		expect(fs.readFileSync(destFile, "utf8")).toMatch(/laptop wireplumber rule/);
	});

	it("does not deploy pc wireplumber files when deviceType=laptop", async () => {
		seedRepoFixtures({ pc: true, laptop: true });
		writeDeviceType("laptop");
		await audio.syncAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });

		const pcFile = path.join(
			tmpHome,
			".config",
			"wireplumber",
			"wireplumber.conf.d",
			"51-logitech-prox-44100.conf",
		);
		expect(fs.existsSync(pcFile)).toBe(false);
	});

	it("skips wireplumber files when ~/.haoshoku.json is missing", async () => {
		seedRepoFixtures({ pc: true });
		// No writeDeviceType call — no ~/.haoshoku.json
		await audio.syncAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });

		expect(
			fs.existsSync(
				path.join(
					tmpHome,
					".config",
					"wireplumber",
					"wireplumber.conf.d",
					"51-logitech-prox-44100.conf",
				),
			),
		).toBe(false);
	});

	it("removes stale managed wireplumber files when deviceType changes", async () => {
		seedRepoFixtures({ pc: true, laptop: true });
		writeDeviceType("pc");
		await audio.syncAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });

		writeDeviceType("laptop");
		await audio.syncAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });

		const liveWireplumberDir = path.join(
			tmpHome,
			".config",
			"wireplumber",
			"wireplumber.conf.d",
		);
		expect(fs.readdirSync(liveWireplumberDir).sort()).toEqual([
			"51-laptop-audio.conf",
		]);
	});

	it("does not remove user-authored wireplumber files with managed-name collisions", async () => {
		seedRepoFixtures({ pc: true, laptop: true });
		const liveWireplumberDir = path.join(
			tmpHome,
			".config",
			"wireplumber",
			"wireplumber.conf.d",
		);
		fs.mkdirSync(liveWireplumberDir, { recursive: true });
		const userFile = path.join(
			liveWireplumberDir,
			"51-logitech-prox-44100.conf",
		);
		const userContent = "# user-authored rule with a colliding filename\n";
		fs.writeFileSync(userFile, userContent);

		writeDeviceType("laptop");
		await audio.syncAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });

		expect(fs.readFileSync(userFile, "utf8")).toBe(userContent);
		expect(
			fs.existsSync(path.join(liveWireplumberDir, "51-laptop-audio.conf")),
		).toBe(true);
	});

	it("stamps deployed wireplumber drop-ins as Haoshoku-managed", async () => {
		seedRepoFixtures({ pc: true });
		writeDeviceType("pc");
		await audio.syncAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });

		const destFile = path.join(
			tmpHome,
			".config",
			"wireplumber",
			"wireplumber.conf.d",
			"51-logitech-prox-44100.conf",
		);
		expect(fs.readFileSync(destFile, "utf8")).toStartWith(
			"# Managed by Haoshoku",
		);
	});

	it("removes stale managed wireplumber files when deviceType becomes unset", async () => {
		seedRepoFixtures({ pc: true });
		writeDeviceType("pc");
		await audio.syncAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });

		fs.rmSync(path.join(tmpHome, ".haoshoku.json"), { force: true });
		await audio.syncAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });

		expect(
			fs.existsSync(
				path.join(
					tmpHome,
					".config",
					"wireplumber",
					"wireplumber.conf.d",
					"51-logitech-prox-44100.conf",
				),
			),
		).toBe(false);
	});

	it("skips stale prune gracefully when repo wireplumber dir is missing", async () => {
		seedRepoFixtures({ pc: true });
		fs.rmSync(path.join(tmpProjectRoot, "configs", "audio", "wireplumber"), {
			recursive: true,
			force: true,
		});

		await expect(
			audio.syncAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot }),
		).resolves.toBeUndefined();
	});

	it("creates ~/.config/wireplumber/wireplumber.conf.d/ if missing", async () => {
		seedRepoFixtures({ pc: true });
		writeDeviceType("pc");
		expect(
			fs.existsSync(path.join(tmpHome, ".config", "wireplumber")),
		).toBe(false);
		await audio.syncAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });
		expect(
			fs.existsSync(
				path.join(tmpHome, ".config", "wireplumber", "wireplumber.conf.d"),
			),
		).toBe(true);
	});
});

describe("syncAudioConfig — portable independence", () => {
	it("syncs pipewire drop-ins for pc deviceType", async () => {
		seedRepoFixtures({ pc: true });
		writeDeviceType("pc");
		await audio.syncAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });

		expect(
			fs.existsSync(
				path.join(
					tmpHome,
					".config",
					"pipewire",
					"pipewire.conf.d",
					"10-allowed-rates.conf",
				),
			),
		).toBe(true);
	});

	it("syncs pipewire drop-ins for laptop deviceType", async () => {
		seedRepoFixtures({ pc: true, laptop: true });
		writeDeviceType("laptop");
		await audio.syncAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });

		expect(
			fs.existsSync(
				path.join(
					tmpHome,
					".config",
					"pipewire",
					"pipewire.conf.d",
					"10-allowed-rates.conf",
				),
			),
		).toBe(true);
		expect(
			fs.existsSync(
				path.join(
					tmpHome,
					".config",
					"pipewire",
					"pipewire-pulse.conf.d",
					"50-spotify-44100.conf",
				),
			),
		).toBe(true);
	});
});

describe("syncAudioConfig — graceful skip on missing sources", () => {
	it("skips wireplumber deploy gracefully when device variant dir is empty", async () => {
		// Only pipewire fixtures; wireplumber/pc/ dir exists but is empty
		seedRepoFixtures({ pc: false }); // pipewire seeded, pc dir empty
		writeDeviceType("pc");

		await expect(
			audio.syncAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot }),
		).resolves.toBeUndefined();

		// wireplumber.conf.d dir shouldn't exist yet (nothing to put in it)
		// OR it may exist but be empty — either is acceptable (no crash)
	});

	it("is idempotent (running twice yields same destination state)", async () => {
		seedRepoFixtures({ pc: true });
		writeDeviceType("pc");
		await audio.syncAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });
		await audio.syncAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });

		expect(
			fs.readFileSync(
				path.join(
					tmpHome,
					".config",
					"pipewire",
					"pipewire.conf.d",
					"10-allowed-rates.conf",
				),
				"utf8",
			),
		).toMatch(/pipewire allowed rates/);
		expect(
			fs.readFileSync(
				path.join(
					tmpHome,
					".config",
					"wireplumber",
					"wireplumber.conf.d",
					"51-logitech-prox-44100.conf",
				),
				"utf8",
			),
		).toMatch(/pc wireplumber rule/);
	});
});

// ---------------------------------------------------------------------------
// backupAudioConfig — live → repo
// ---------------------------------------------------------------------------

describe("backupAudioConfig — snapshots live drop-ins into repo tree", () => {
	it("backs up pipewire.conf.d files to repo pipewire/pipewire.conf.d/", async () => {
		seedLiveAudio({ deviceType: "pc" });
		writeDeviceType("pc");
		await audio.backupAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });

		const destFile = path.join(
			tmpProjectRoot,
			"configs",
			"audio",
			"pipewire",
			"pipewire.conf.d",
			"10-allowed-rates.conf",
		);
		expect(fs.existsSync(destFile)).toBe(true);
		expect(fs.readFileSync(destFile, "utf8")).toMatch(/live pipewire conf\.d/);
	});

	it("backs up pipewire-pulse.conf.d files to repo pipewire/pipewire-pulse.conf.d/", async () => {
		seedLiveAudio({ deviceType: "pc" });
		writeDeviceType("pc");
		await audio.backupAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });

		const destFile = path.join(
			tmpProjectRoot,
			"configs",
			"audio",
			"pipewire",
			"pipewire-pulse.conf.d",
			"50-spotify-44100.conf",
		);
		expect(fs.existsSync(destFile)).toBe(true);
		expect(fs.readFileSync(destFile, "utf8")).toMatch(/live pulse conf\.d/);
	});

	it("backs up wireplumber.conf.d/ to wireplumber/pc/ when deviceType=pc", async () => {
		seedLiveAudio({ deviceType: "pc" });
		writeDeviceType("pc");
		await audio.backupAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });

		const destFile = path.join(
			tmpProjectRoot,
			"configs",
			"audio",
			"wireplumber",
			"pc",
			"51-logitech-prox-44100.conf",
		);
		expect(fs.existsSync(destFile)).toBe(true);
		expect(fs.readFileSync(destFile, "utf8")).toMatch(/live wireplumber rule for pc/);
	});

	it("strips the live Haoshoku-managed marker when backing up wireplumber files", async () => {
		seedRepoFixtures({ pc: true });
		writeDeviceType("pc");
		await audio.syncAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });
		await audio.backupAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });

		const backedUp = fs.readFileSync(
			path.join(
				tmpProjectRoot,
				"configs",
				"audio",
				"wireplumber",
				"pc",
				"51-logitech-prox-44100.conf",
			),
			"utf8",
		);
		expect(backedUp).not.toStartWith("# Managed by Haoshoku");
		expect(backedUp).toMatch(/pc wireplumber rule/);
	});

	it("backs up wireplumber.conf.d/ to wireplumber/laptop/ when deviceType=laptop", async () => {
		seedLiveAudio({ deviceType: "laptop" });
		writeDeviceType("laptop");
		await audio.backupAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });

		const destFile = path.join(
			tmpProjectRoot,
			"configs",
			"audio",
			"wireplumber",
			"laptop",
			"51-laptop-audio.conf",
		);
		expect(fs.existsSync(destFile)).toBe(true);
		expect(fs.readFileSync(destFile, "utf8")).toMatch(
			/live wireplumber rule for laptop/,
		);
	});

	it("does not write pc wireplumber files when backing up a laptop", async () => {
		seedLiveAudio({ deviceType: "laptop" });
		writeDeviceType("laptop");
		await audio.backupAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });

		expect(
			fs.existsSync(
				path.join(
					tmpProjectRoot,
					"configs",
					"audio",
					"wireplumber",
					"pc",
					"51-laptop-audio.conf",
				),
			),
		).toBe(false);
	});

	it("skips when live pipewire.conf.d doesn't exist (warns, doesn't throw)", async () => {
		// No seedLiveAudio — nothing in ~/.config/
		writeDeviceType("pc");
		await expect(
			audio.backupAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot }),
		).resolves.toBeUndefined();
	});

	it("skips when live wireplumber.conf.d doesn't exist (warns, doesn't throw)", async () => {
		// Seed only the pipewire dirs, not wireplumber
		const pipewireConfD = path.join(
			tmpHome,
			".config",
			"pipewire",
			"pipewire.conf.d",
		);
		fs.mkdirSync(pipewireConfD, { recursive: true });
		fs.writeFileSync(
			path.join(pipewireConfD, "10-allowed-rates.conf"),
			"# live pipewire conf.d\n",
		);
		writeDeviceType("pc");
		await expect(
			audio.backupAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot }),
		).resolves.toBeUndefined();
	});

	it("creates repo wireplumber/<deviceType>/ dir if missing before backup", async () => {
		seedLiveAudio({ deviceType: "pc" });
		// Remove the pre-seeded wireplumber/pc dir
		fs.rmSync(
			path.join(tmpProjectRoot, "configs", "audio", "wireplumber", "pc"),
			{ recursive: true, force: true },
		);
		writeDeviceType("pc");
		await audio.backupAudioConfig({ home: tmpHome, projectRoot: tmpProjectRoot });
		expect(
			fs.existsSync(
				path.join(tmpProjectRoot, "configs", "audio", "wireplumber", "pc"),
			),
		).toBe(true);
	});

	it("does not back up wireplumber files without an explicit deviceType", async () => {
		seedLiveAudio({ deviceType: "pc" });
		await audio.backupAudioConfig({
			home: tmpHome,
			projectRoot: tmpProjectRoot,
		});

		expect(
			fs.existsSync(
				path.join(
					tmpProjectRoot,
					"configs",
					"audio",
					"wireplumber",
					"pc",
					"51-logitech-prox-44100.conf",
				),
			),
		).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// configureAudio — alias for syncAudioConfig
// ---------------------------------------------------------------------------

describe("configureAudio — alias for syncAudioConfig", () => {
	it("deploys pipewire drop-ins (same as syncAudioConfig)", async () => {
		seedRepoFixtures({ pc: true });
		writeDeviceType("pc");
		await audio.configureAudio({ home: tmpHome, projectRoot: tmpProjectRoot });

		expect(
			fs.existsSync(
				path.join(
					tmpHome,
					".config",
					"pipewire",
					"pipewire.conf.d",
					"10-allowed-rates.conf",
				),
			),
		).toBe(true);
	});

	it("deploys wireplumber drop-ins (same as syncAudioConfig)", async () => {
		seedRepoFixtures({ pc: true });
		writeDeviceType("pc");
		await audio.configureAudio({ home: tmpHome, projectRoot: tmpProjectRoot });

		expect(
			fs.existsSync(
				path.join(
					tmpHome,
					".config",
					"wireplumber",
					"wireplumber.conf.d",
					"51-logitech-prox-44100.conf",
				),
			),
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Seeded configs/audio/ (in-tree static files — real paths, no injection)
// ---------------------------------------------------------------------------

describe("seeded configs/audio/ (in-tree static configs)", () => {
	it("ships 10-allowed-rates.conf under pipewire/pipewire.conf.d/", () => {
		expect(
			fs.existsSync(
				path.join(
					CONFIGS_AUDIO_DIR,
					"pipewire",
					"pipewire.conf.d",
					"10-allowed-rates.conf",
				),
			),
		).toBe(true);
	});

	it("ships 50-spotify-44100.conf under pipewire/pipewire-pulse.conf.d/", () => {
		expect(
			fs.existsSync(
				path.join(
					CONFIGS_AUDIO_DIR,
					"pipewire",
					"pipewire-pulse.conf.d",
					"50-spotify-44100.conf",
				),
			),
		).toBe(true);
	});

	it("ships 51-logitech-prox-44100.conf under wireplumber/pc/", () => {
		expect(
			fs.existsSync(
				path.join(
					CONFIGS_AUDIO_DIR,
					"wireplumber",
					"pc",
					"51-logitech-prox-44100.conf",
				),
			),
		).toBe(true);
	});

	it("does not ship a laptop lossless WirePlumber rule", () => {
		const laptopDir = path.join(CONFIGS_AUDIO_DIR, "wireplumber", "laptop");
		const laptopRules = fs.existsSync(laptopDir)
			? fs.readdirSync(laptopDir).filter((file) => file.endsWith(".conf"))
			: [];
		expect(laptopRules).toEqual([]);
	});

	it("documents that unset, other, and laptop do not fall back to the PC lossless rule", () => {
		const docs = fs.readFileSync(path.join(CONFIGS_AUDIO_DIR, "CLAUDE.md"), "utf8");
		expect(docs).not.toMatch(/falls back to the PC variant/i);
		expect(docs).toMatch(/laptop[^.\n]*no WirePlumber rule/i);
		expect(docs).toMatch(/unset[^.\n]*skip/i);
		expect(docs).toMatch(/other[^.\n]*skip/i);
	});
});
