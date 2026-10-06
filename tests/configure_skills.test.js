import { describe, expect, it } from "bun:test";
import {
	configureSkills,
	LIST_GLOBAL_SKILLS_COMMAND,
	listSkills,
	MATT_POCOCK_SKILLS_COMMAND,
	MATT_POCOCK_SKILLS_SOURCE,
} from "../src/helpers/configure_skills.js";

describe("external skill management", () => {
	it("pins the Matt Pocock source", () => {
		expect(MATT_POCOCK_SKILLS_SOURCE).toBe("mattpocock/skills");
		expect(MATT_POCOCK_SKILLS_COMMAND).toBe(
			"npx -y skills@latest add mattpocock/skills -g -a claude-code codex -s '*' -y --full-depth",
		);
	});

	it("syncs only Matt Pocock for Claude Code and Codex", async () => {
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

	it("reports failed or thrown sync without throwing", async () => {
		const failedCommands = [];
		expect(
			await configureSkills({
				run: async (command) => {
					failedCommands.push(command);
					return false;
				},
			}),
		).toBe(false);
		expect(failedCommands).toEqual([MATT_POCOCK_SKILLS_COMMAND]);
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
