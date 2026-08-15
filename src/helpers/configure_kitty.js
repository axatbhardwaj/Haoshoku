import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { log, safeCopyFile } from "../common/utils.js";

const HOME_DEFAULT = homedir();
const PROJECT_ROOT_DEFAULT = path.resolve(__dirname, "..", "..");
const XDG_TERMINAL_PREFERENCE =
	"# Terminal emulator preference order for xdg-terminal-exec\n" +
	"# The first found and valid terminal will be used\n" +
	"kitty.desktop\n";

export function resolveKittyPaths({
	home = HOME_DEFAULT,
	env = process.env,
} = {}) {
	const configRoot = env.XDG_CONFIG_HOME || path.join(home, ".config");
	return {
		configDir: path.join(configRoot, "kitty"),
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
	log.success("Set Kitty as the XDG terminal default.");
}

export async function configureKitty({
	home = HOME_DEFAULT,
	env = process.env,
	projectRoot = PROJECT_ROOT_DEFAULT,
} = {}) {
	const { configDir, xdgTerminalPreference } = resolveKittyPaths({ home, env });
	const sourceDir = path.join(projectRoot, "configs", "kitty");
	fs.mkdirSync(configDir, { recursive: true });
	for (const filename of ["kitty.conf", "haki.session", "agents.session"]) {
		const source = path.join(sourceDir, filename);
		if (!fs.existsSync(source)) {
			throw new Error(`Kitty configuration source not found: ${source}`);
		}
		safeCopyFile(source, path.join(configDir, filename));
	}
	configureXdgTerminalPreference(xdgTerminalPreference);
	log.success("Configured Kitty and its split sessions.");
}
