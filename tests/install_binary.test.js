import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const installer = path.resolve(import.meta.dir, "../install.sh");
let scratch;
let home;
let installHome;
let tools;
let tarball;

function executable(file, content) {
	fs.writeFileSync(file, content, { mode: 0o755 });
}

function fixture(version) {
	const bundle = path.join(scratch, "bundle");
	fs.mkdirSync(bundle, { recursive: true });
	executable(path.join(bundle, "haoshoku"), `#!/bin/bash\necho ${version}\n`);
	for (const dir of ["configs", "common", "deskback", "icons"]) {
		fs.mkdirSync(path.join(bundle, dir), { recursive: true });
		fs.writeFileSync(path.join(bundle, dir, "asset"), version);
	}
	expect(spawnSync("tar", ["-czf", tarball, "-C", bundle, "."]).status).toBe(0);
}

function install(overrides = {}) {
	return spawnSync("/bin/bash", [], {
		input: fs.readFileSync(installer),
		encoding: "utf8",
		env: {
			...process.env,
			HOME: home,
			HAOSHOKU_HOME: installHome,
			HAOSHOKU_TARBALL: `file://${tarball}`,
			PATH: `${tools}:/usr/bin:/bin`,
			...overrides,
		},
	});
}

beforeEach(() => {
	scratch = fs.mkdtempSync(path.join(tmpdir(), "haoshoku-install-"));
	home = path.join(scratch, "home");
	installHome = path.join(scratch, "custom", "haoshoku");
	tools = path.join(scratch, "tools");
	tarball = path.join(scratch, "bundle.tar.gz");
	fs.mkdirSync(tools);
	executable(path.join(tools, "uname"), "#!/bin/bash\necho x86_64\n");
	fixture("v1");
});

afterEach(() => fs.rmSync(scratch, { recursive: true, force: true }));

test("piped installer lays out assets, links the command, and warns about PATH", () => {
	const result = install();
	expect(result.status).toBe(0);
	expect(fs.existsSync(path.join(installHome, "haoshoku"))).toBe(true);
	for (const dir of ["configs", "common", "deskback", "icons"]) {
		expect(fs.readFileSync(path.join(installHome, dir, "asset"), "utf8")).toBe(
			"v1",
		);
	}
	const command = path.join(home, ".local/bin/haoshoku");
	expect(fs.readlinkSync(command)).toBe(path.join(installHome, "haoshoku"));
	expect(spawnSync(command, [], { encoding: "utf8" }).stdout.trim()).toBe("v1");
	expect(result.stderr).toContain(".local/bin");
	expect(result.stderr).toContain("PATH");
});

test("reinstall replaces the version and removes stale assets", () => {
	expect(install().status).toBe(0);
	expect(fs.existsSync(installHome)).toBe(true);
	const previous = fs.readlinkSync(installHome);
	fs.writeFileSync(path.join(installHome, "stale"), "old");
	fixture("v2");
	const result = install({ PATH: `${home}/.local/bin:${tools}:/usr/bin:/bin` });
	expect(result.status).toBe(0);
	expect(fs.readFileSync(path.join(installHome, "configs/asset"), "utf8")).toBe(
		"v2",
	);
	expect(fs.existsSync(path.join(installHome, "stale"))).toBe(false);
	expect(fs.readlinkSync(installHome)).not.toBe(previous);
	expect(fs.existsSync(previous)).toBe(false);
	expect(result.stderr).not.toContain("PATH");
});

test("unsupported architecture fails clearly before installing", () => {
	executable(path.join(tools, "uname"), "#!/bin/bash\necho riscv64\n");
	const result = install();
	expect(result.status).not.toBe(0);
	expect(result.stderr).toContain("Unsupported architecture: riscv64");
	expect(fs.existsSync(installHome)).toBe(false);
});

test("failed download preserves the installed version", () => {
	expect(install().status).toBe(0);
	executable(path.join(tools, "curl"), "#!/bin/bash\nexit 22\n");
	const result = install();
	expect(result.status).not.toBe(0);
	expect(result.stderr).toContain("Download failed");
	expect(fs.readFileSync(path.join(installHome, "configs/asset"), "utf8")).toBe(
		"v1",
	);
});

test.each([
	["x86_64", "x64"],
	["aarch64", "arm64"],
])("%s selects the %s release asset", (machine, arch) => {
	executable(path.join(tools, "uname"), `#!/bin/bash\necho ${machine}\n`);
	executable(
		path.join(tools, "curl"),
		'#!/bin/bash\nprintf "%s\\n" "$@" > "$CURL_ARGS"\nexec /usr/bin/curl -fsSL "file://$FIXTURE"\n',
	);
	const args = path.join(scratch, "curl-args");
	const result = install({
		HAOSHOKU_HOME: "",
		HAOSHOKU_TARBALL: "",
		CURL_ARGS: args,
		FIXTURE: tarball,
	});
	expect(result.status).toBe(0);
	expect(fs.existsSync(path.join(home, ".local/share/haoshoku/haoshoku"))).toBe(
		true,
	);
	expect(fs.readFileSync(args, "utf8")).toContain(
		`https://github.com/axatbhardwaj/Haoshoku/releases/latest/download/haoshoku-linux-${arch}.tar.gz`,
	);
});
