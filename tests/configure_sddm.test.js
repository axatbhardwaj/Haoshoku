import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
	configureSddm,
	sddmSudoersInstallScript,
	sddmSudoersLine,
} from "../src/helpers/configure_sddm.js";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const POSTHOOK_CMD =
	"sudo /usr/share/sddm/themes/caelestia/scripts/sync.sh --posthook";

const readCliJson = () =>
	JSON.parse(
		fs.readFileSync(
			path.join(PROJECT_ROOT, "configs", "caelestia", "cli.json"),
			"utf8",
		),
	);

describe("tracked configs/caelestia/cli.json (caelestia-sddm posthooks)", () => {
	it("has wallpaper.postHook for caelestia-sddm sync", () => {
		expect(readCliJson().wallpaper?.postHook).toBe(POSTHOOK_CMD);
	});

	it("has theme.postHook for caelestia-sddm sync", () => {
		expect(readCliJson().theme?.postHook).toBe(POSTHOOK_CMD);
	});
});

describe("sddmSudoersLine", () => {
	it("returns the expected rule for a valid username", () => {
		expect(sddmSudoersLine("xzat")).toBe(
			"xzat ALL=(root) NOPASSWD: /usr/share/sddm/themes/caelestia/scripts/sync.sh --posthook",
		);
	});

	it("genuinely substitutes the username", () => {
		expect(sddmSudoersLine("alice")).toMatch(/^alice ALL=/);
		expect(sddmSudoersLine("bob123")).toMatch(/^bob123 ALL=/);
	});

	it("scopes the rule to the --posthook argument (least privilege)", () => {
		expect(sddmSudoersLine("xzat")).toMatch(/sync\.sh --posthook$/);
	});

	it("throws for an empty username", () => {
		expect(() => sddmSudoersLine("")).toThrow(/Invalid username/);
	});

	it("throws for a username containing a space", () => {
		expect(() => sddmSudoersLine("a b")).toThrow(/Invalid username/);
	});

	it("throws for a username containing a semicolon", () => {
		expect(() => sddmSudoersLine("a;b")).toThrow(/Invalid username/);
	});

	it("throws for non-string input", () => {
		expect(() => sddmSudoersLine(undefined)).toThrow(/Invalid username/);
		expect(() => sddmSudoersLine(null)).toThrow(/Invalid username/);
		expect(() => sddmSudoersLine(123)).toThrow(/Invalid username/);
	});
});

describe("sddmSudoersInstallScript", () => {
	const line = sddmSudoersLine("xzat");
	const sudoersPath = "/etc/sudoers.d/caelestia-sddm-sync";
	const script = sddmSudoersInstallScript({ line, sudoersPath });

	it("uses mktemp to stage the candidate", () => {
		expect(script).toMatch(/mktemp/);
	});

	it("chmods the candidate to 0440 before validation", () => {
		expect(script).toMatch(/chmod\s+0440\s+"\$tmp"/);
	});

	it("validates the candidate BEFORE installing it (visudo -c -f <tmpfile>)", () => {
		const validateIdx = script.indexOf('visudo -c -f "$tmp"');
		const installIdx = script.indexOf("install -o root");
		expect(validateIdx).toBeGreaterThan(-1);
		expect(installIdx).toBeGreaterThan(-1);
		expect(validateIdx).toBeLessThan(installIdx);
	});

	it("installs to the given sudoersPath with mode 0440 owned by root", () => {
		expect(script).toContain(
			`install -o root -g root -m 0440 "$tmp" '${sudoersPath}'`,
		);
	});

	it("re-validates the full sudoers set after install (visudo -c)", () => {
		const installIdx = script.indexOf("install -o root");
		const fullValidateIdx = script.indexOf("visudo -c", installIdx);
		expect(fullValidateIdx).toBeGreaterThan(installIdx);
	});

	it("removes the drop-in on post-install validation failure (same-shell cleanup)", () => {
		expect(script).toMatch(/if\s+!\s+visudo -c/);
		expect(script).toContain(`rm -f '${sudoersPath}'`);
		expect(script).toMatch(/exit 1/);
	});

	it("embeds the literal sudoers line", () => {
		expect(script).toContain(line);
	});

	it("substitutes the sudoersPath (script changes when path changes)", () => {
		const alt = sddmSudoersInstallScript({
			line,
			sudoersPath: "/etc/sudoers.d/foo",
		});
		expect(alt).toContain("'/etc/sudoers.d/foo'");
		expect(alt).not.toContain("caelestia-sddm-sync");
	});
});

function makeFakeRunner({ exitCode = 0 } = {}) {
	const calls = [];
	const runner = async (argv) => {
		calls.push(argv);
		return { exitCode };
	};
	return { runner, calls };
}

describe("configureSddm", () => {
	const sudoersPath = "/tmp/test-sudoers-caelestia-sddm";

	it("invokes the runner once with sudo sh -c <built-script>", async () => {
		const { runner, calls } = makeFakeRunner();
		await configureSddm({ username: "xzat", sudoersPath, runner });
		expect(calls.length).toBe(1);
		expect(calls[0][0]).toBe("sudo");
		expect(calls[0][1]).toBe("sh");
		expect(calls[0][2]).toBe("-c");
		expect(typeof calls[0][3]).toBe("string");
	});

	it("passes exactly the script produced by sddmSudoersInstallScript", async () => {
		const { runner, calls } = makeFakeRunner();
		await configureSddm({ username: "xzat", sudoersPath, runner });
		const expectedScript = sddmSudoersInstallScript({
			line: sddmSudoersLine("xzat"),
			sudoersPath,
		});
		expect(calls[0][3]).toBe(expectedScript);
	});

	it("refuses to invoke the runner when username resolves to root", async () => {
		const { runner, calls } = makeFakeRunner();
		await configureSddm({ username: "root", sudoersPath, runner });
		expect(calls.length).toBe(0);
	});

	it("refuses to invoke the runner when username is empty", async () => {
		const { runner, calls } = makeFakeRunner();
		await configureSddm({ username: "", sudoersPath, runner });
		expect(calls.length).toBe(0);
	});

	it("refuses to invoke the runner when username is invalid", async () => {
		const { runner, calls } = makeFakeRunner();
		await configureSddm({ username: "a b", sudoersPath, runner });
		expect(calls.length).toBe(0);
	});

	it("is idempotent — two runs produce identical runner invocations", async () => {
		const { runner: runner1, calls: calls1 } = makeFakeRunner();
		const { runner: runner2, calls: calls2 } = makeFakeRunner();
		await configureSddm({ username: "xzat", sudoersPath, runner: runner1 });
		await configureSddm({ username: "xzat", sudoersPath, runner: runner2 });
		expect(calls1).toEqual(calls2);
	});

	it("does not throw when the runner reports a non-zero exit (non-fatal)", async () => {
		const { runner } = makeFakeRunner({ exitCode: 1 });
		await expect(
			configureSddm({ username: "xzat", sudoersPath, runner }),
		).resolves.toBeUndefined();
	});

	it("resolves SUDO_USER from the environment when no username override is given", async () => {
		const prev = process.env.SUDO_USER;
		process.env.SUDO_USER = "alice";
		try {
			const { runner, calls } = makeFakeRunner();
			await configureSddm({ sudoersPath, runner });
			expect(calls.length).toBe(1);
			expect(calls[0][3]).toContain("alice ALL=(root) NOPASSWD:");
		} finally {
			if (prev === undefined) delete process.env.SUDO_USER;
			else process.env.SUDO_USER = prev;
		}
	});
});

const SDDM_PKG = "caelestia-sddm-minimalistv2-git";

describe("caelestia-sddm package wiring (gated by Caelestia install path)", () => {
	it("installCaelestia installs caelestia-sddm-minimalistv2-git via paru", () => {
		const src = fs.readFileSync(
			path.join(PROJECT_ROOT, "src", "helpers", "configure_hyprland.js"),
			"utf8",
		);
		// The package name must appear in the file
		expect(src).toContain(SDDM_PKG);
		// And it must be invoked through paru somewhere in the file
		expect(src).toMatch(
			new RegExp(`paru[^\\n]*\\b${SDDM_PKG.replace(/-/g, "\\-")}\\b`),
		);
	});

	it("caelestia-sddm-minimalistv2-git is NOT in common/paru_applist.txt (must stay gated)", () => {
		const list = fs.readFileSync(
			path.join(PROJECT_ROOT, "common", "paru_applist.txt"),
			"utf8",
		);
		const entries = list
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith("#"));
		expect(entries).not.toContain(SDDM_PKG);
	});
});

describe.skip("retired cachyos.js wiring (configureSddm)", () => {
	const readSrc = () =>
		fs.readFileSync(
			path.join(PROJECT_ROOT, "src", "os_scripts", "cachyos.js"),
			"utf8",
		);

	it("imports configureSddm from ../helpers/configure_sddm.js", () => {
		expect(readSrc()).toMatch(
			/import\s+\{[^}]*\bconfigureSddm\b[^}]*\}\s+from\s+["']\.\.\/helpers\/configure_sddm\.js["']/,
		);
	});

	it("calls configureSddm AFTER configureCaelestiaPrefs", () => {
		const text = readSrc();
		const prefsIdx = text.indexOf("await configureCaelestiaPrefs(");
		const sddmIdx = text.indexOf("await configureSddm(");
		expect(prefsIdx).toBeGreaterThan(-1);
		expect(sddmIdx).toBeGreaterThan(prefsIdx);
	});

	it("calls configureSddm exactly once", () => {
		const count = (readSrc().match(/configureSddm\s*\(/g) ?? []).length;
		expect(count).toBe(1);
	});
});
