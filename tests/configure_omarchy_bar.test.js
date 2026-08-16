import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	backupOmarchyBar,
	configureOmarchyBar,
} from "../src/helpers/configure_omarchy_bar.js";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const SHIPPED_BAR = path.join(PROJECT_ROOT, "configs", "omarchy", "bar.json");
const SHIPPED_MANIFEST = path.join(PROJECT_ROOT, "common", "omarchy-plugins.json");
const tempRoots = [];

function makeFixture({ bar, manifest, shell } = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-omarchy-bar-"));
	tempRoots.push(root);
	const repoBarPath = path.join(root, "repo", "configs", "omarchy", "bar.json");
	const manifestPath = path.join(root, "repo", "common", "omarchy-plugins.json");
	const liveShellPath = path.join(root, "home", ".config", "omarchy", "shell.json");
	const pluginsDir = path.join(root, "home", ".config", "omarchy", "plugins");
	fs.mkdirSync(path.dirname(repoBarPath), { recursive: true });
	fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
	fs.mkdirSync(path.dirname(liveShellPath), { recursive: true });
	fs.mkdirSync(pluginsDir, { recursive: true });
	fs.writeFileSync(repoBarPath, bar ?? fs.readFileSync(SHIPPED_BAR));
	fs.writeFileSync(manifestPath, manifest ?? fs.readFileSync(SHIPPED_MANIFEST));
	if (shell !== undefined) {
		fs.writeFileSync(liveShellPath, typeof shell === "string" ? shell : `${JSON.stringify(shell, null, "\t")}\n`);
	}
	try {
		for (const { id } of JSON.parse(fs.readFileSync(manifestPath, "utf8"))) {
			fs.mkdirSync(path.join(pluginsDir, id), { recursive: true });
		}
	} catch {
		// Malformed-manifest tests need fixture creation to reach the production parser.
	}
	const warnings = [];
	return {
		repoBarPath,
		manifestPath,
		liveShellPath,
		pluginsDir,
		warnings,
		opts: {
			repoBarPath,
			manifestPath,
			liveShellPath,
			pluginsDir,
			versionResult: { exitCode: 0, stdout: "Omarchy 4.0.0" },
			logImpl: {
				dim() {},
				info() {},
				success() {},
				warning(message) { warnings.push(message); },
			},
		},
	};
}

afterEach(() => {
	for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("configureOmarchyBar", () => {
	it("merges the owned bar while preserving unrelated top-level values", async () => {
		const live = {
			version: 1,
			idle: { screensaver: 901, lock: 902 },
			plugins: [{ id: "future.plugin", enabled: false }],
			disabledPlugins: ["omarchy.stock-widget"],
			junk: { nested: ["keep", 42, null] },
			bar: { position: "bottom", layout: {} },
		};
		const fixture = makeFixture({ shell: live });

		await configureOmarchyBar(fixture.opts);

		const deployed = JSON.parse(fs.readFileSync(fixture.liveShellPath, "utf8"));
		expect(deployed.idle).toEqual(live.idle);
		expect(deployed.plugins).toEqual(live.plugins);
		expect(deployed.disabledPlugins).toEqual(["omarchy.stock-widget"]);
		expect(deployed.junk).toEqual(live.junk);
		expect(deployed.bar).toEqual(JSON.parse(fs.readFileSync(fixture.repoBarPath, "utf8")));
	});

	it("refuses deployment when Omarchy is older than version 4", async () => {
		const original = '{"version":1,"junk":"untouched"}\n';
		const fixture = makeFixture({ shell: original });

		const result = await configureOmarchyBar({
			...fixture.opts,
			versionResult: { exitCode: 0, stdout: "Omarchy 3.8.5" },
		});

		expect(result.status).toBe("refused");
		expect(fs.readFileSync(fixture.liveShellPath, "utf8")).toBe(original);
	});

	it("refuses an unknown live schema without changing a byte", async () => {
		const original = '{ "version": 2, "foreign": true }\n';
		const fixture = makeFixture({ shell: original });

		const result = await configureOmarchyBar(fixture.opts);

		expect(result.status).toBe("refused");
		expect(fs.readFileSync(fixture.liveShellPath, "utf8")).toBe(original);
	});

	it("moves malformed live JSON aside and deploys from the default base", async () => {
		const malformed = "{ definitely not json\n";
		const fixture = makeFixture({ shell: malformed });

		await configureOmarchyBar({ ...fixture.opts, now: () => 12345 });

		expect(fs.readFileSync(`${fixture.liveShellPath}.malformed.12345`, "utf8")).toBe(
			malformed,
		);
		const deployed = JSON.parse(fs.readFileSync(fixture.liveShellPath, "utf8"));
		expect(deployed.version).toBe(1);
		expect(deployed.idle).toEqual({ screensaver: 150, lock: 300 });
		expect(deployed.plugins).toEqual([]);
		expect(deployed.bar.layout).toBeDefined();
	});

	it("treats parsed null live JSON as malformed and recovers from safe defaults", async () => {
		const fixture = makeFixture({ shell: "null\n" });

		const result = await configureOmarchyBar({ ...fixture.opts, now: () => 12346 });

		expect(result.status).toBe("configured");
		expect(fs.readFileSync(`${fixture.liveShellPath}.malformed.12346`, "utf8")).toBe(
			"null\n",
		);
		const deployed = JSON.parse(fs.readFileSync(fixture.liveShellPath, "utf8"));
		expect(deployed.idle).toEqual({ screensaver: 150, lock: 300 });
		expect(deployed.plugins).toEqual([]);
	});

	it("refuses malformed repo bar JSON without throwing or touching the live file", async () => {
		const fixture = makeFixture({
			bar: "{ not json\n",
			shell: '{"version":1,"keep":"untouched"}\n',
		});
		const original = fs.readFileSync(fixture.liveShellPath, "utf8");

		const result = await configureOmarchyBar(fixture.opts);

		expect(result.status).toBe("refused");
		expect(fs.readFileSync(fixture.liveShellPath, "utf8")).toBe(original);
	});

	it("refuses structurally invalid repo bar layouts without throwing", async () => {
		for (const bar of [
			{},
			{ layout: { left: "not-an-array" } },
			{ layout: { left: [{}] } },
		]) {
			const fixture = makeFixture({ bar: `${JSON.stringify(bar)}\n`, shell: { version: 1 } });

			const result = await configureOmarchyBar(fixture.opts);

			expect(result.status).toBe("refused");
		}
	});

	it("refuses malformed manifest JSON without throwing or touching the live file", async () => {
		const fixture = makeFixture({
			manifest: "[ not json\n",
			shell: '{"version":1,"keep":"untouched"}\n',
		});
		const original = fs.readFileSync(fixture.liveShellPath, "utf8");

		const result = await configureOmarchyBar(fixture.opts);

		expect(result.status).toBe("refused");
		expect(fs.readFileSync(fixture.liveShellPath, "utf8")).toBe(original);
	});

	it("refuses a third-party layout id missing from the manifest", async () => {
		const fixture = makeFixture({
			bar: `${JSON.stringify({ layout: { left: [{ id: "unknown.plugin" }] } }, null, "\t")}\n`,
			shell: { version: 1, junk: "untouched" },
		});
		const original = fs.readFileSync(fixture.liveShellPath, "utf8");

		const result = await configureOmarchyBar(fixture.opts);

		expect(result.status).toBe("refused");
		expect(fs.readFileSync(fixture.liveShellPath, "utf8")).toBe(original);
	});

	it("warns for a manifest plugin missing on disk and still deploys", async () => {
		const fixture = makeFixture({ shell: { version: 1 } });
		fs.rmSync(path.join(fixture.pluginsDir, "robzolkos.agent-usage"), { recursive: true });

		const result = await configureOmarchyBar(fixture.opts);

		expect(result.status).toBe("configured");
		expect(fixture.warnings.join("\n")).toContain("haoshoku --omarchy-plugins");
		expect(JSON.parse(fs.readFileSync(fixture.liveShellPath, "utf8")).bar).toBeDefined();
	});

	it("uses safeCopyFile's unchanged path on an idempotent re-run", async () => {
		const fixture = makeFixture({ shell: { version: 1 } });

		const first = await configureOmarchyBar(fixture.opts);
		const before = fs.readFileSync(fixture.liveShellPath);
		const second = await configureOmarchyBar(fixture.opts);

		expect(first.changed).toBe(true);
		expect(second.changed).toBe(false);
		expect(fs.readFileSync(fixture.liveShellPath)).toEqual(before);
	});

	it("atomically replaces shell.json without copying over it and preserves mode 0600", async () => {
		const fixture = makeFixture({ shell: { version: 1, keep: "private" } });
		fs.chmodSync(fixture.liveShellPath, 0o600);
		const copies = [];
		const renames = [];
		const fsImpl = {
			...fs,
			copyFileSync(source, destination, ...args) {
				copies.push({ source, destination });
				return fs.copyFileSync(source, destination, ...args);
			},
			renameSync(source, destination) {
				renames.push({ source, destination });
				return fs.renameSync(source, destination);
			},
		};

		const result = await configureOmarchyBar({ ...fixture.opts, fsImpl, now: () => 77 });

		expect(result.changed).toBe(true);
		expect(renames.some(({ destination }) => destination === fixture.liveShellPath)).toBe(
			true,
		);
		expect(copies.some(({ destination }) => destination === fixture.liveShellPath)).toBe(
			false,
		);
		expect(fs.statSync(fixture.liveShellPath).mode & 0o777).toBe(0o600);
	});

	it("refuses a concurrent live write immediately before replacement", async () => {
		const fixture = makeFixture({ shell: { version: 1, plugins: [] } });
		const concurrent = '{"version":1,"plugins":[{"id":"just-enabled"}]}\n';
		let injected = false;
		const fsImpl = {
			...fs,
			writeFileSync(file, ...args) {
				const result = fs.writeFileSync(file, ...args);
				if (!injected && String(file).includes(".haoshoku-tmp-")) {
					injected = true;
					fs.writeFileSync(fixture.liveShellPath, concurrent);
				}
				return result;
			},
		};

		const result = await configureOmarchyBar({ ...fixture.opts, fsImpl });

		expect(result).toEqual(expect.objectContaining({ status: "refused", changed: false }));
		expect(fs.readFileSync(fixture.liveShellPath, "utf8")).toBe(concurrent);
		expect(fixture.warnings.join("\n")).toContain("Re-run");
	});

	it("preserves the first-capture, legacy, and timestamped backup ladder", async () => {
		const original = '{"version":1,"keep":"original"}\n';
		const fixture = makeFixture({ shell: original });

		await configureOmarchyBar({ ...fixture.opts, now: () => 88 });

		for (const suffix of [".haoshoku-first-capture", ".bak", ".bak.88"]) {
			expect(fs.readFileSync(`${fixture.liveShellPath}${suffix}`, "utf8")).toBe(original);
		}
	});

	it("removes its temporary file when the replacement write throws", async () => {
		const fixture = makeFixture({ shell: { version: 1 } });

		await expect(
			configureOmarchyBar({
				...fixture.opts,
				now: () => 99,
				safeCopyFileImpl() {
					throw new Error("replacement exploded");
				},
			}),
		).rejects.toThrow("replacement exploded");
		expect(
			fs
				.readdirSync(path.dirname(fixture.liveShellPath))
				.filter((name) => name.includes(".haoshoku-tmp-")),
		).toEqual([]);
	});

	it("captures a hand-edited live bar back into the repo", async () => {
		const fixture = makeFixture({ shell: { version: 1 } });
		await configureOmarchyBar(fixture.opts);
		const editedBar = {
			centerAnchor: "omarchy.clock",
			layout: { left: [{ id: "omarchy.clock", format: "HH:mm" }] },
		};
		const live = JSON.parse(fs.readFileSync(fixture.liveShellPath, "utf8"));
		fs.writeFileSync(fixture.liveShellPath, `${JSON.stringify({ ...live, bar: editedBar }, null, "\t")}\n`);

		const result = await backupOmarchyBar(fixture.opts);

		expect(result.status).toBe("backed-up");
		expect(JSON.parse(fs.readFileSync(fixture.repoBarPath, "utf8"))).toEqual(editedBar);
	});

	it("skips backup when the live shell file is missing", async () => {
		const fixture = makeFixture();

		const result = await backupOmarchyBar(fixture.opts);

		expect(result.status).toBe("skipped");
	});

	it("skips backup when the live shell file is unparseable", async () => {
		const fixture = makeFixture({ shell: "{ broken\n" });
		const before = fs.readFileSync(fixture.repoBarPath);

		const result = await backupOmarchyBar(fixture.opts);

		expect(result.status).toBe("skipped");
		expect(fs.readFileSync(fixture.repoBarPath)).toEqual(before);
	});

	it("skips backup when the live shell has no bar object", async () => {
		for (const bar of [undefined, null, []]) {
			const shell = bar === undefined ? { version: 1 } : { version: 1, bar };
			const fixture = makeFixture({ shell });
			const before = fs.readFileSync(fixture.repoBarPath);

			const result = await backupOmarchyBar(fixture.opts);

			expect(result.status).toBe("skipped");
			expect(fs.readFileSync(fixture.repoBarPath)).toEqual(before);
		}
	});

	it("warns when a captured bar contains ids missing from the plugin manifest", async () => {
		const fixture = makeFixture({
			shell: {
				version: 1,
				bar: { layout: { left: [{ id: "unknown.widget" }] } },
			},
		});

		const result = await backupOmarchyBar(fixture.opts);

		expect(result.status).toBe("backed-up");
		expect(fixture.warnings.join("\n")).toContain("unknown.widget");
		expect(fixture.warnings.join("\n")).toContain("common/omarchy-plugins.json");
	});

	it("leaves the repository bar byte-identical after deploy then backup", async () => {
		const fixture = makeFixture({ shell: { version: 1 } });
		const before = fs.readFileSync(fixture.repoBarPath);

		await configureOmarchyBar(fixture.opts);
		await backupOmarchyBar(fixture.opts);

		expect(fs.readFileSync(fixture.repoBarPath)).toEqual(before);
	});
});

it("keeps every shipped third-party bar id in the plugin manifest", () => {
	const bar = JSON.parse(fs.readFileSync(SHIPPED_BAR, "utf8"));
	const manifestIds = new Set(JSON.parse(fs.readFileSync(SHIPPED_MANIFEST, "utf8")).map(({ id }) => id));
	const thirdPartyIds = Object.values(bar.layout)
		.flat()
		.map(({ id }) => id)
		.filter((id) => !id.startsWith("omarchy."));

	expect(thirdPartyIds.every((id) => manifestIds.has(id))).toBe(true);
});

it("places every manifest bar widget in the shipped bar layout", () => {
	// The manifest has no kinds field. These are all eight ids except the
	// raindrop-bookmarks overlay, which does not belong in bar.layout.
	const expectedBarWidgetIds = new Set([
		"crmne.hyprmoncfg",
		"white.nights",
		"robzolkos.github",
		"omaconnect",
		"io.github.thetrueferret.decent-workspaces",
		"dizziee.system-stats",
		"robzolkos.agent-usage",
	]);
	const manifestIds = new Set(
		JSON.parse(fs.readFileSync(SHIPPED_MANIFEST, "utf8")).map(({ id }) => id),
	);
	const barIds = new Set(
		Object.values(JSON.parse(fs.readFileSync(SHIPPED_BAR, "utf8")).layout)
			.flat()
			.map(({ id }) => id),
	);

	expect(new Set([...manifestIds].filter((id) => id !== "io.github.treramey.raindrop-bookmarks"))).toEqual(
		expectedBarWidgetIds,
	);
	expect([...expectedBarWidgetIds].every((id) => barIds.has(id))).toBe(true);
});
