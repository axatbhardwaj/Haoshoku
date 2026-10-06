import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	AGENT_SKILLS,
	backupAgentSkills,
	syncAgentSkills,
	UPSTREAM_AGENT_SKILLS,
} from "../src/helpers/configure_agent_skills.js";

const roots = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "haoshoku-agent-skills-"));
	roots.push(root);
	const home = path.join(root, "home");
	const projectRoot = path.join(root, "project");
	for (const name of AGENT_SKILLS) {
		const skill = path.join(projectRoot, "configs", "agent-skills", name);
		fs.mkdirSync(skill, { recursive: true });
		fs.writeFileSync(path.join(skill, "SKILL.md"), `owned ${name}\n`);
	}
	for (const name of UPSTREAM_AGENT_SKILLS) {
		const skill = path.join(projectRoot, "configs", "upstream-skills", name);
		fs.mkdirSync(skill, { recursive: true });
		fs.writeFileSync(path.join(skill, "SKILL.md"), `upstream ${name}\n`);
	}
	return { home, projectRoot };
}

describe("Haoshoku agent skills", () => {
	it("keeps upstream skills outside the owned backup allowlist", () => {
		expect(AGENT_SKILLS).toEqual([
			"model-routing",
			"paseo-pr-babysit",
			"paseo-pr-review",
		]);
		expect(UPSTREAM_AGENT_SKILLS).toEqual(["visual-explainer"]);
	});

	it("syncs owned skills and creates portable links for both agents", () => {
		const { home, projectRoot } = fixture();
		for (const name of ["paseo", "code-review"]) {
			fs.mkdirSync(path.join(home, ".agents", "skills", name), {
				recursive: true,
			});
		}

		expect(syncAgentSkills({ home, projectRoot })).toBe(true);
		for (const name of [...AGENT_SKILLS, ...UPSTREAM_AGENT_SKILLS]) {
			expect(
				fs.readFileSync(
					path.join(home, ".agents", "skills", name, "SKILL.md"),
					"utf8",
				),
			).toBe(
				UPSTREAM_AGENT_SKILLS.includes(name)
					? `upstream ${name}\n`
					: `owned ${name}\n`,
			);
			for (const agent of [".claude", ".codex"]) {
				expect(fs.readlinkSync(path.join(home, agent, "skills", name))).toBe(
					`../../.agents/skills/${name}`,
				);
			}
		}
		expect(
			JSON.parse(
				fs.readFileSync(
					path.join(home, ".config", "haoshoku", "visual-explainer.json"),
					"utf8",
				),
			),
		).toEqual({ theme: "dark" });
		expect(
			fs.existsSync(path.join(home, ".config", "haoshoku", "paseo-tasks.json")),
		).toBe(false);
	});

	it("replaces absolute links but preserves real skill directories", () => {
		const { home, projectRoot } = fixture();
		const name = AGENT_SKILLS[0];
		const claudeLink = path.join(home, ".claude", "skills", name);
		const codexDirectory = path.join(home, ".codex", "skills", name);
		fs.mkdirSync(path.dirname(claudeLink), { recursive: true });
		fs.symlinkSync(`/home/old/.agents/skills/${name}`, claudeLink);
		fs.mkdirSync(codexDirectory, { recursive: true });
		fs.writeFileSync(path.join(codexDirectory, "KEEP"), "user-owned\n");
		const warnings = [];

		expect(
			syncAgentSkills({
				home,
				logger: {
					info() {},
					success() {},
					warning: (value) => warnings.push(value),
				},
				projectRoot,
			}),
		).toBe(true);
		expect(fs.readlinkSync(claudeLink)).toBe(`../../.agents/skills/${name}`);
		expect(fs.readFileSync(path.join(codexDirectory, "KEEP"), "utf8")).toBe(
			"user-owned\n",
		);
		expect(warnings.join("\n")).toContain("real directory");
	});

	it("warns without failing when referenced external skills are missing", () => {
		const { home, projectRoot } = fixture();
		const warnings = [];

		expect(
			syncAgentSkills({
				home,
				logger: {
					info() {},
					success() {},
					warning: (value) => warnings.push(value),
				},
				projectRoot,
			}),
		).toBe(true);
		expect(warnings.join("\n")).toContain("paseo");
		expect(warnings.join("\n")).toContain("code-review");
	});

	it("ignores existing retired task config without changing it", () => {
		const { home, projectRoot } = fixture();
		const config = path.join(home, ".config", "haoshoku", "paseo-tasks.json");
		fs.mkdirSync(path.dirname(config), { recursive: true });
		fs.writeFileSync(config, '{"cleanup":"delete"}\n');
		const before = fs.readFileSync(config);

		expect(syncAgentSkills({ home, projectRoot })).toBe(true);
		expect(fs.readFileSync(config)).toEqual(before);
	});

	it("deploys the bundled task lifecycle reference", () => {
		const { home } = fixture();
		const projectRoot = path.resolve(import.meta.dir, "..");
		const bundled = path.join(
			projectRoot,
			"configs",
			"agent-skills",
			"model-routing",
			"references",
			"task-lifecycle.md",
		);
		const deployed = path.join(
			home,
			".agents",
			"skills",
			"model-routing",
			"references",
			"task-lifecycle.md",
		);

		expect(syncAgentSkills({ home, projectRoot })).toBe(true);
		expect(fs.readFileSync(deployed)).toEqual(fs.readFileSync(bundled));
		const lifecycle = fs.readFileSync(deployed, "utf8");
		expect(lifecycle).toContain("<slug>--<full-driver-paseo-id>--<run-id>");
		expect(lifecycle).toContain("paseo.parent-agent-id");
		expect(lifecycle).toContain("Provider-native subagents");
		expect(lifecycle).toContain("paseo run --background");
		expect(lifecycle).toContain("driver-recorded launch or reuse receipt");
		expect(lifecycle).toContain("this run's exact task-label update receipt");
		expect(lifecycle).toContain("A null `ParentAgentId` is eligible only when");
		expect(lifecycle).toContain(
			"A non-null mismatched parent chain is a hard retain condition",
		);
		expect(lifecycle).toContain("mandatory exit step");
		expect(lifecycle).toContain("concrete reason for every retained worker");
		expect(lifecycle).toContain("settle the old run first");
		expect(lifecycle).not.toContain(
			"Archive only when its parent chain still matches",
		);
		expect(lifecycle).toContain("never retry with `--force`");
		expect(
			fs.readFileSync(
				path.join(home, ".agents", "skills", "model-routing", "SKILL.md"),
				"utf8",
			),
		).toContain("references/task-lifecycle.md");
	});

	it("backs up only the owned allowlist byte-for-byte", () => {
		const { home, projectRoot } = fixture();
		const liveSkills = path.join(home, ".agents", "skills");
		for (const name of AGENT_SKILLS) {
			fs.mkdirSync(path.join(liveSkills, name), { recursive: true });
			fs.writeFileSync(
				path.join(liveSkills, name, "SKILL.md"),
				`live ${name}\n`,
			);
		}
		fs.mkdirSync(path.join(liveSkills, "paseo"), { recursive: true });
		fs.writeFileSync(path.join(liveSkills, "paseo", "SKILL.md"), "upstream\n");
		fs.mkdirSync(path.join(liveSkills, "visual-explainer"), {
			recursive: true,
		});
		fs.writeFileSync(
			path.join(liveSkills, "visual-explainer", "SKILL.md"),
			"locally edited upstream\n",
		);

		expect(backupAgentSkills({ home, projectRoot })).toBe(true);
		for (const name of AGENT_SKILLS) {
			expect(
				fs.readFileSync(
					path.join(projectRoot, "configs", "agent-skills", name, "SKILL.md"),
					"utf8",
				),
			).toBe(`live ${name}\n`);
		}
		expect(
			fs.existsSync(path.join(projectRoot, "configs", "agent-skills", "paseo")),
		).toBe(false);
		expect(
			fs.readFileSync(
				path.join(
					projectRoot,
					"configs",
					"upstream-skills",
					"visual-explainer",
					"SKILL.md",
				),
				"utf8",
			),
		).toBe("upstream visual-explainer\n");
	});

	it("archives the retired shared skill and removes only managed links", () => {
		const { home, projectRoot } = fixture();
		const live = path.join(home, ".agents", "skills", "html-deliverables");
		fs.mkdirSync(live, { recursive: true });
		fs.writeFileSync(path.join(live, "CUSTOM.md"), "preserve me\n");
		for (const agent of [".claude", ".codex"]) {
			const skills = path.join(home, agent, "skills");
			fs.mkdirSync(skills, { recursive: true });
			fs.symlinkSync(
				"../../.agents/skills/html-deliverables",
				path.join(skills, "html-deliverables"),
			);
		}

		expect(syncAgentSkills({ home, projectRoot })).toBe(true);
		const archive = path.join(
			home,
			".config",
			"haoshoku",
			"retired-agent-skills",
			"html-deliverables",
		);
		expect(fs.existsSync(live)).toBe(false);
		expect(fs.readFileSync(path.join(archive, "CUSTOM.md"), "utf8")).toBe(
			"preserve me\n",
		);
		for (const agent of [".claude", ".codex"]) {
			expect(
				fs.existsSync(path.join(home, agent, "skills", "html-deliverables")),
			).toBe(false);
		}

		expect(syncAgentSkills({ home, projectRoot })).toBe(true);
		expect(fs.readdirSync(path.dirname(archive))).toEqual([
			"html-deliverables",
		]);
	});

	it("preserves real agent-specific retired skill directories", () => {
		const { home, projectRoot } = fixture();
		const custom = path.join(home, ".codex", "skills", "html-deliverables");
		fs.mkdirSync(custom, { recursive: true });
		fs.writeFileSync(path.join(custom, "KEEP"), "custom\n");

		expect(syncAgentSkills({ home, projectRoot })).toBe(true);
		expect(fs.readFileSync(path.join(custom, "KEEP"), "utf8")).toBe("custom\n");
	});

	it("leaves the retired live skill intact when archival fails", () => {
		const { home, projectRoot } = fixture();
		const live = path.join(home, ".agents", "skills", "html-deliverables");
		fs.mkdirSync(live, { recursive: true });
		fs.writeFileSync(path.join(live, "KEEP"), "still here\n");

		expect(
			syncAgentSkills({
				home,
				projectRoot,
				renameImpl: () => {
					throw new Error("read-only archive");
				},
			}),
		).toBe(false);
		expect(fs.readFileSync(path.join(live, "KEEP"), "utf8")).toBe(
			"still here\n",
		);
	});
});
