import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
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
	for (const name of UPSTREAM_AGENT_SKILLS) {
		const skill = path.join(projectRoot, "configs", "upstream-skills", name);
		fs.mkdirSync(skill, { recursive: true });
		fs.writeFileSync(path.join(skill, "SKILL.md"), `upstream ${name}\n`);
	}
	return { home, projectRoot };
}

describe("Haoshoku agent skills", () => {
	it("syncs upstream skills and creates portable links for both agents", () => {
		const { home, projectRoot } = fixture();

		expect(syncAgentSkills({ home, projectRoot })).toBe(true);
		for (const name of UPSTREAM_AGENT_SKILLS) {
			expect(
				fs.readFileSync(
					path.join(home, ".agents", "skills", name, "SKILL.md"),
					"utf8",
				),
			).toBe(`upstream ${name}\n`);
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
		const name = UPSTREAM_AGENT_SKILLS[0];
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

	it("syncs without requiring retired routing dependencies", () => {
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
		expect(warnings).toEqual([]);
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

	it.each([
		"html-deliverables",
		"model-routing",
		"paseo-pr-babysit",
		"paseo-pr-review",
	])("archives %s and removes managed links", (name) => {
		const { home, projectRoot } = fixture();
		const live = path.join(home, ".agents", "skills", name);
		fs.mkdirSync(live, { recursive: true });
		fs.writeFileSync(path.join(live, "CUSTOM.md"), "preserve me\n");
		for (const agent of [".claude", ".codex"]) {
			const skills = path.join(home, agent, "skills");
			fs.mkdirSync(skills, { recursive: true });
			fs.symlinkSync(`../../.agents/skills/${name}`, path.join(skills, name));
		}

		expect(syncAgentSkills({ home, projectRoot })).toBe(true);
		const archive = path.join(
			home,
			".config",
			"haoshoku",
			"retired-agent-skills",
			name,
		);
		expect(fs.existsSync(live)).toBe(false);
		expect(fs.readFileSync(path.join(archive, "CUSTOM.md"), "utf8")).toBe(
			"preserve me\n",
		);
		for (const agent of [".claude", ".codex"]) {
			expect(
				fs.lstatSync(path.join(home, agent, "skills", name), {
					throwIfNoEntry: false,
				}),
			).toBeUndefined();
		}

		expect(syncAgentSkills({ home, projectRoot })).toBe(true);
		expect(fs.readdirSync(path.dirname(archive))).toEqual([name]);
	});

	it.each([
		"html-deliverables",
		"model-routing",
		"paseo-pr-babysit",
		"paseo-pr-review",
	])("preserves real agent-specific %s directories", (name) => {
		const { home, projectRoot } = fixture();
		const custom = path.join(home, ".codex", "skills", name);
		fs.mkdirSync(custom, { recursive: true });
		fs.writeFileSync(path.join(custom, "KEEP"), "custom\n");

		expect(syncAgentSkills({ home, projectRoot })).toBe(true);
		expect(fs.readFileSync(path.join(custom, "KEEP"), "utf8")).toBe("custom\n");
	});

	it.each([
		"html-deliverables",
		"model-routing",
		"paseo-pr-babysit",
		"paseo-pr-review",
	])("leaves %s intact when archival fails", (name) => {
		const { home, projectRoot } = fixture();
		const live = path.join(home, ".agents", "skills", name);
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
