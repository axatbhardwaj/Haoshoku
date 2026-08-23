import { describe, expect, it } from "bun:test";
import {
	configureSkills,
	LIST_GLOBAL_SKILLS_COMMAND,
	listSkills,
	MATT_POCOCK_SKILLS_COMMAND,
	MATT_POCOCK_SKILLS_SOURCE,
} from "../src/helpers/configure_skills.js";

describe("Matt Pocock skill management", () => {
	it("pins the single declarative source", () => {
		expect(MATT_POCOCK_SKILLS_SOURCE).toBe("mattpocock/skills");
		expect(MATT_POCOCK_SKILLS_COMMAND).toBe(
			"npx -y skills@latest add mattpocock/skills -g -a claude-code codex -s '*' -y --full-depth",
		);
	});

	it("syncs the source for Claude Code and Codex", async () => {
		const commands = [];
		expect(
			await configureSkills({
				run: async (command) => {
					commands.push(command);
					return true;
				},
			}),
		).toBe(true);
		expect(commands).toEqual([MATT_POCOCK_SKILLS_COMMAND]);
	});

	it("reports a failed sync without throwing", async () => {
		expect(await configureSkills({ run: async () => false })).toBe(false);
		expect(
			await configureSkills({
				run: async () => {
					throw new Error("offline");
				},
			}),
		).toBe(false);
	});

	it("lists the Skills CLI global inventory", async () => {
		const commands = [];
		expect(
			await listSkills({
				run: async (command) => {
					commands.push(command);
					return true;
				},
			}),
		).toBe(true);
		expect(commands).toEqual([LIST_GLOBAL_SKILLS_COMMAND]);
	});
});
