import fs from "node:fs";
import { safeCopyFile } from "../common/utils.js";

const AXSTACK_BLOCK =
	/<!-- axstack:begin v\d+ -->[\s\S]*?<!-- axstack:end -->/g;

/** Axstack owns its routing block; portable profiles must not capture it. */
export function stripAxstackBlock(content) {
	return content.replace(
		/(?:\r?\n)?<!-- axstack:begin v\d+ -->[\s\S]*?<!-- axstack:end -->(?:\r?\n)?/g,
		"",
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
