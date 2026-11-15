import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const oldRule =
	"- When I correct the same thing twice, write it here as one rule that day.";
export const newRule =
	"- When I correct the same thing twice, make it a check, test or code change that day; the rule line here points to that check. Keep prose only for authority or judgement.";
export const block =
	"<!-- axstack:begin v1 -->\r\nINSTALLER OWNED\r\n<!-- axstack:end -->";

export async function createRuleFixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-rule-"));
	fs.chmodSync(root, 0o700);
	const home = path.join(root, "home");
	const source = path.join(root, "configs/agent-profile/PROFILE.md");
	const evidenceDir = path.join(root, "evidence");
	fs.cpSync(path.resolve(import.meta.dir, "../src"), path.join(root, "src"), {
		recursive: true,
	});
	fs.mkdirSync(path.join(root, "scripts"));
	fs.copyFileSync(
		path.resolve(import.meta.dir, "../scripts/agent-rule-patch.js"),
		path.join(root, "scripts/agent-rule-patch.js"),
	);
	fs.mkdirSync(path.dirname(source), { recursive: true });
	fs.writeFileSync(source, `SOURCE\n${newRule}\n`);
	const git = (...args) =>
		execFileSync("git", args, {
			cwd: root,
			env: { ...process.env, HOME: home },
			encoding: "utf8",
		});
	fs.mkdirSync(home);
	git("init", "-q");
	git("add", "src", "scripts", "configs");
	const commit = () =>
		git(
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.invalid",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"-qm",
			"fixture",
			"--allow-empty",
		);
	commit();
	const destinations = [
		".claude/CLAUDE.md",
		".codex/AGENTS.md",
		".config/opencode/AGENTS.md",
		".gemini/GEMINI.md",
	].map((name) => path.join(home, name));
	const original = `LOCAL\r\n${oldRule}\r\n${block}\r\nTAIL`;
	for (const file of destinations) {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, original);
	}
	const { runAgentRulePatch } = await import(
		path.join(root, "src/helpers/agent_rule_patch.js")
	);
	const run = (mode) =>
		runAgentRulePatch({ mode, evidenceDir, source, destinations });
	const command = (mode, args = []) =>
		Bun.spawnSync(
			[
				process.execPath,
				path.join(root, "scripts/agent-rule-patch.js"),
				mode,
				"--home",
				home,
				"--evidence",
				evidenceDir,
				...args,
			],
			{ cwd: root, env: { ...process.env, HOME: home } },
		);
	return {
		root,
		home,
		source,
		evidenceDir,
		destinations,
		original,
		run,
		command,
		git,
		commit,
	};
}
