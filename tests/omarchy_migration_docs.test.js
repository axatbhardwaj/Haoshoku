import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");

describe("Omarchy migration documentation", () => {
	it("accurately documents all v4-gated helpers and hyprctl dispatch semantics", () => {
		const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
		expect(changelog.replace(/\s+/g, " ")).toContain(
			"Migration, workspaces, hyprmoncfg, and plugin helpers gate on the installed Omarchy major version.",
		);
		expect(changelog.replace(/\s+/g, " ")).toContain(
			"On Omarchy 4, `hyprctl dispatch` evaluates its argument as Lua, so `haoshoku-special-workspace` now emits `hl.dsp.*` Lua expressions instead of the legacy `dispatch <name> <args>` form, which is a parse error on v4; dispatch failures now propagate as script failures rather than being masked.",
		);
		expect(changelog.replace(/\s+/g, " ")).toContain(
			"The default Omarchy plugin set is now eight plugins: `tmn73.calendar`, `crmne.mpris`, `dorneles.lock-keys`, and `hass` were dropped, while `io.github.thetrueferret.decent-workspaces`, `dizziee.system-stats`, and `robzolkos.agent-usage` were added, the first and last displacing the stock `omarchy.workspaces` and `omarchy.agents` widgets.",
		);
	});

	it("documents the Omarchy plugin manifest in common/CLAUDE.md", () => {
		const commonDocs = fs.readFileSync(
			path.join(root, "common", "CLAUDE.md"),
			"utf8",
		);
		expect(commonDocs).toContain("`omarchy-plugins.json`");
		expect(commonDocs).toContain("Omarchy plugin");
	});
});
