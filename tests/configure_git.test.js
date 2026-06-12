import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { configureGit } from "../src/helpers/configure_git.js";

// Each test gets a throwaway HOME so we never touch the real ~/.gitconfig.
let tmpHome;

beforeEach(() => {
	tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-git-"));
});

afterEach(() => {
	fs.rmSync(tmpHome, { recursive: true, force: true });
});

// A prompts() stand-in: hand it the answer objects to return in order. Each
// call shifts the next scripted response off the queue.
function makePromptFn(responses) {
	const queue = [...responses];
	const calls = [];
	const promptFn = async (questions) => {
		calls.push(questions);
		return queue.shift() ?? {};
	};
	return { promptFn, calls };
}

// A Bun.spawn-style runner stand-in returning a scripted exit code, recording
// every argv it was handed.
function makeRunner({ exitCode = 0 } = {}) {
	const calls = [];
	const runner = async (argv) => {
		calls.push(argv);
		return { exitCode };
	};
	return { runner, calls };
}

// Minimal profile answers for createProfile's prompts().
const personalAnswers = {
	email: "me@personal.example",
	username: "Me Personal",
	githubUser: "mepersonal",
};
const workAnswers = {
	email: "me@work.example",
	username: "Me Work",
	githubUser: "mework",
};

// Convenience: run configureGit with no work profile (promptUser answers false).
async function runNoWork(opts = {}) {
	const { promptFn } = makePromptFn([personalAnswers]);
	return configureGit({
		home: tmpHome,
		promptFn,
		promptUser: async () => false,
		runner: makeRunner().runner,
		startAgent: async () => {},
		...opts,
	});
}

describe("configureGit — global ~/.gitconfig backup", () => {
	it("backs up an existing differing ~/.gitconfig to .bak before overwriting", async () => {
		const gitConfigPath = path.join(tmpHome, ".gitconfig");
		fs.writeFileSync(gitConfigPath, "old user content\n");

		await runNoWork();

		const bak = `${gitConfigPath}.bak`;
		expect(fs.existsSync(bak)).toBe(true);
		expect(fs.readFileSync(bak, "utf8")).toBe("old user content\n");
		// The live file was overwritten with the generated includeIf config.
		expect(fs.readFileSync(gitConfigPath, "utf8")).toContain(
			'[includeIf "gitdir:~/personal/"]',
		);
	});

	it("does NOT create a .bak when no ~/.gitconfig exists", async () => {
		const gitConfigPath = path.join(tmpHome, ".gitconfig");
		expect(fs.existsSync(gitConfigPath)).toBe(false);

		await runNoWork();

		expect(fs.existsSync(`${gitConfigPath}.bak`)).toBe(false);
		expect(fs.existsSync(gitConfigPath)).toBe(true);
	});

	it("skips the write entirely when ~/.gitconfig already matches (no .bak)", async () => {
		const gitConfigPath = path.join(tmpHome, ".gitconfig");
		// First run to compute the exact content the generator produces.
		await runNoWork();
		const generated = fs.readFileSync(gitConfigPath, "utf8");

		// Reset: pre-seed the live file with that exact content, no stale .bak.
		fs.writeFileSync(gitConfigPath, generated);
		fs.rmSync(`${gitConfigPath}.bak`, { force: true });

		await runNoWork();

		expect(fs.existsSync(`${gitConfigPath}.bak`)).toBe(false);
		expect(fs.readFileSync(gitConfigPath, "utf8")).toBe(generated);
	});
});

describe("configureGit — includeIf global config content", () => {
	it("emits only the personal includeIf when no work profile is created", async () => {
		await runNoWork();
		const content = fs.readFileSync(path.join(tmpHome, ".gitconfig"), "utf8");
		expect(content).toContain('[includeIf "gitdir:~/personal/"]');
		expect(content).toContain("path = ~/personal/.gitconfig.personal");
		expect(content).not.toContain('[includeIf "gitdir:~/work/"]');
	});

	it("emits both personal and work includeIf when a work profile is created", async () => {
		const { promptFn } = makePromptFn([workAnswers, personalAnswers]);
		await configureGit({
			home: tmpHome,
			promptFn,
			promptUser: async () => true,
			runner: makeRunner().runner,
			startAgent: async () => {},
		});
		const content = fs.readFileSync(path.join(tmpHome, ".gitconfig"), "utf8");
		expect(content).toContain('[includeIf "gitdir:~/personal/"]');
		expect(content).toContain('[includeIf "gitdir:~/work/"]');
		expect(content).toContain("path = ~/work/.gitconfig.work");
	});
});

describe("createProfile — SSH keygen guards", () => {
	it("passes the email as a literal argv element to ssh-keygen (no shell interpolation)", async () => {
		const { runner, calls } = makeRunner();
		const trickyEmail = 'a"; rm -rf ~ #@evil.example';
		const { promptFn } = makePromptFn([
			{ ...personalAnswers, email: trickyEmail },
		]);
		await configureGit({
			home: tmpHome,
			promptFn,
			promptUser: async () => false,
			runner,
			startAgent: async () => {},
		});
		// First runner call is ssh-keygen; the email must be a discrete argv entry.
		const keygen = calls.find((argv) => argv[0] === "ssh-keygen");
		expect(keygen).toBeDefined();
		expect(keygen).toContain(trickyEmail);
		// And it is a standalone element (the -C flag's value), never concatenated
		// into a shell string.
		const cIdx = keygen.indexOf("-C");
		expect(cIdx).toBeGreaterThan(-1);
		expect(keygen[cIdx + 1]).toBe(trickyEmail);
	});

	it("writes signing config when keygen succeeds", async () => {
		const { runner } = makeRunner({ exitCode: 0 });
		const { promptFn } = makePromptFn([personalAnswers]);
		await configureGit({
			home: tmpHome,
			promptFn,
			promptUser: async () => false,
			runner,
			startAgent: async () => {},
		});
		const profilePath = path.join(
			tmpHome,
			"personal",
			".gitconfig.personal",
		);
		const content = fs.readFileSync(profilePath, "utf8");
		expect(content).toContain("signingkey =");
		expect(content).toContain("gpgsign = true");
		expect(content).toContain("format = ssh");
		expect(content).toContain("sshCommand =");
	});

	it("omits signing config when keygen FAILS (non-zero exit)", async () => {
		const { runner } = makeRunner({ exitCode: 1 });
		const { promptFn } = makePromptFn([personalAnswers]);
		await configureGit({
			home: tmpHome,
			promptFn,
			promptUser: async () => false,
			runner,
			startAgent: async () => {},
		});
		const profilePath = path.join(
			tmpHome,
			"personal",
			".gitconfig.personal",
		);
		const content = fs.readFileSync(profilePath, "utf8");
		// User identity still written...
		expect(content).toContain("email = me@personal.example");
		expect(content).toContain("name = Me Personal");
		// ...but every signing-related directive is absent.
		expect(content).not.toContain("signingkey");
		expect(content).not.toContain("gpgsign");
		expect(content).not.toContain("format = ssh");
		expect(content).not.toContain("sshCommand");
	});

	it("SKIPS keygen when the key already exists but keeps signing config", async () => {
		// Pre-create the personal key so generation must be skipped.
		const sshDir = path.join(tmpHome, ".ssh");
		fs.mkdirSync(sshDir, { recursive: true });
		const keyPath = path.join(sshDir, "personal_key");
		fs.writeFileSync(keyPath, "PRE-EXISTING KEY\n");

		const { runner, calls } = makeRunner({ exitCode: 0 });
		const { promptFn } = makePromptFn([personalAnswers]);
		await configureGit({
			home: tmpHome,
			promptFn,
			promptUser: async () => false,
			runner,
			startAgent: async () => {},
		});

		// ssh-keygen must NOT have been invoked.
		expect(calls.find((argv) => argv[0] === "ssh-keygen")).toBeUndefined();
		// The existing key is untouched.
		expect(fs.readFileSync(keyPath, "utf8")).toBe("PRE-EXISTING KEY\n");
		// Signing config is still written (we keep using the existing key).
		const content = fs.readFileSync(
			path.join(tmpHome, "personal", ".gitconfig.personal"),
			"utf8",
		);
		expect(content).toContain("signingkey =");
		expect(content).toContain("gpgsign = true");
	});
});
