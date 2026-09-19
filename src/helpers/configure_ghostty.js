import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { log, safeCopyFile } from "../common/utils.js";

const HOME_DEFAULT = homedir();
const PROJECT_ROOT_DEFAULT = path.resolve(__dirname, "..", "..");
const XDG_TERMINAL_PREFERENCE =
	"# Terminal emulator preference order for xdg-terminal-exec\n" +
	"# The first found and valid terminal will be used\n" +
	"com.mitchellh.ghostty.desktop\n";

export function resolveGhosttyPaths({
	home = HOME_DEFAULT,
	env = process.env,
} = {}) {
	const configRoot = env.XDG_CONFIG_HOME || path.join(home, ".config");
	return {
		configDir: path.join(configRoot, "ghostty"),
		xdgTerminalPreference: path.join(configRoot, "xdg-terminals.list"),
	};
}

function configureXdgTerminalPreference(preferencePath) {
	const exists = fs.existsSync(preferencePath);
	const original = exists ? fs.readFileSync(preferencePath, "utf8") : "";
	fs.mkdirSync(path.dirname(preferencePath), { recursive: true });
	const firstCapture = `${preferencePath}.haoshoku-first-capture`;
	if (!fs.existsSync(firstCapture)) {
		if (exists)
			fs.copyFileSync(preferencePath, firstCapture, fs.constants.COPYFILE_EXCL);
		else fs.writeFileSync(firstCapture, "", { flag: "wx" });
	}
	if (original === XDG_TERMINAL_PREFERENCE) return;

	const temporary = `${preferencePath}.tmp`;
	fs.writeFileSync(temporary, XDG_TERMINAL_PREFERENCE);
	fs.renameSync(temporary, preferencePath);
	log.success("Set Ghostty as the XDG terminal default.");
}

export async function configureGhostty({
	home = HOME_DEFAULT,
	env = process.env,
	projectRoot = PROJECT_ROOT_DEFAULT,
} = {}) {
	const { configDir, xdgTerminalPreference } = resolveGhosttyPaths({
		home,
		env,
	});
	const source = path.join(projectRoot, "configs", "ghostty", "config");
	if (!fs.existsSync(source)) {
		throw new Error(`Ghostty configuration source not found: ${source}`);
	}
	fs.mkdirSync(configDir, { recursive: true });
	safeCopyFile(source, path.join(configDir, "config"));
	configureXdgTerminalPreference(xdgTerminalPreference);
	log.success("Configured Ghostty.");
}
