import fs from "node:fs";
import { safeCopyFile } from "../common/utils.js";

const AXSTACK_BLOCK =
	/<!-- axstack:begin v\d+ -->[\s\S]*?<!-- axstack:end -->/g;

/** Axstack owns its routing block; portable profiles must not capture it. */
export function stripAxstackBlock(content) {
	const blockWithNewlines = new RegExp(
		`(\\r?\\n)?${AXSTACK_BLOCK.source}(\\r?\\n)?`,
		"g",
	);
	return content.replace(
		blockWithNewlines,
		(match, leading, trailing, offset) => {
			const before = content.slice(0, offset);
			const after = content.slice(offset + match.length);
			// Keep one separator if removing both newlines would join profile lines.
			if (!leading || !trailing || !before || !after) return "";
			return before.endsWith("\n") || /^\r?\n/.test(after) ? "" : leading;
		},
	);
}

/** Keep live Axstack bytes while replacing the Haoshoku-owned profile. */
export function syncAgentInstructions(srcPath, destPath, content) {
	const profile = stripAxstackBlock(
		content ?? fs.readFileSync(srcPath, "utf8"),
	);
	const blocks = fs.existsSync(destPath)
		? fs.readFileSync(destPath, "utf8").match(AXSTACK_BLOCK)
		: null;
	const merged = blocks
		? `${profile.replace(/\s+$/, "")}\n\n${blocks.join("\n\n")}\n`
		: profile;
	// Retain safeCopyFile's unchanged-skip and first-capture/backup semantics.
	const staging = `${destPath}.haoshoku-staging-${process.pid}`;
	fs.writeFileSync(staging, merged);
	try {
		return safeCopyFile(staging, destPath);
	} finally {
		fs.unlinkSync(staging);
	}
}
