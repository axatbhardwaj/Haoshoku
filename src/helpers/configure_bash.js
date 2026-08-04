import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { log, safeCopyFile } from "../common/utils.js";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..", "..");
const BASH_FRAGMENT = path.join(
	PROJECT_ROOT,
	"configs",
	"bash",
	"haoshoku.bash",
);
const SOURCE_LINE =
	'[[ -r "$HOME/.config/haoshoku/bashrc" ]] && source "$HOME/.config/haoshoku/bashrc"';

export function configureBash({ home = homedir(), fsImpl = fs } = {}) {
	const destination = path.join(home, ".config", "haoshoku", "bashrc");
	fsImpl.mkdirSync(path.dirname(destination), { recursive: true });
	const changed = safeCopyFile(BASH_FRAGMENT, destination, fsImpl);

	const bashrc = path.join(home, ".bashrc");
	const existing = fsImpl.existsSync(bashrc)
		? fsImpl.readFileSync(bashrc, "utf8")
		: "";
	let bashrcChanged = false;
	if (!existing.includes(SOURCE_LINE)) {
		const separator =
			existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
		fsImpl.writeFileSync(
			bashrc,
			`${existing}${separator}\n# Haoshoku managed shell additions\n${SOURCE_LINE}\n`,
		);
		bashrcChanged = true;
		log.info("Added Haoshoku Bash additions to ~/.bashrc");
	}

	return { changed, bashrcChanged };
}
