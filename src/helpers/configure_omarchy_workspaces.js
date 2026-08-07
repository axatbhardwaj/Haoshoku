import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { log, runCommand } from "../common/utils.js";

const ROOT = path.resolve(import.meta.dir, "..", "..");
const OVERLAY = path.join(ROOT, "configs", "omarchy", "workspaces.conf");
const BINDINGS = path.join(ROOT, "configs", "omarchy", "bindings.conf");
const SCRIPT = path.join(
	ROOT,
	"configs",
	"scripts",
	"haoshoku-special-workspace",
);
const SOURCE_LINE = "source = ~/.config/hypr/haoshoku-workspaces.conf";
const OMARCHY_BINDINGS_SOURCE = "source = ~/.config/hypr/bindings.conf";
const BINDINGS_SOURCE_LINE = "source = ~/.config/hypr/haoshoku-bindings.conf";

function shellEscape(value) {
	return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function ensureSourceAfter(mainText, sourceLine, precedingSourceLine) {
	let lines =
		mainText
			.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)
			?.filter((line) => line.length > 0) ?? [];
	const lineContent = (line) => line.replace(/(?:\r\n|\n|\r)$/, "");
	const sourceIndexes = lines.flatMap((line, index) =>
		lineContent(line) === sourceLine ? [index] : [],
	);
	const precedingIndex = lines.findIndex(
		(line) => lineContent(line) === precedingSourceLine,
	);
	if (
		sourceIndexes.length === 1 &&
		precedingIndex >= 0 &&
		sourceIndexes[0] === precedingIndex + 1
	)
		return { text: mainText, changed: false };

	lines = lines.filter((line) => lineContent(line) !== sourceLine);
	const insertionIndex = lines.findIndex(
		(line) => lineContent(line) === precedingSourceLine,
	);
	if (insertionIndex < 0) {
		let text = lines.join("");
		if (text && !/[\r\n]$/.test(text)) text += "\n";
		return { text: `${text}${sourceLine}\n`, changed: true };
	}

	let newline = lines[insertionIndex].match(/(?:\r\n|\n|\r)$/)?.[0];
	if (!newline) {
		newline = mainText.includes("\r\n") ? "\r\n" : "\n";
		lines[insertionIndex] += newline;
	}
	lines.splice(insertionIndex + 1, 0, `${sourceLine}${newline}`);
	return { text: lines.join(""), changed: true };
}

export async function configureOmarchyWorkspaces({
	home = homedir(),
	fsImpl = fs,
	now = Date.now,
	runCommandImpl = runCommand,
	env = process.env,
} = {}) {
	const hyprDir = path.join(home, ".config", "hypr");
	const main = path.join(hyprDir, "hyprland.conf");
	if (!fsImpl.existsSync(main))
		throw new Error(`Omarchy Hyprland config not found: ${main}`);

	const bindingsDestination = path.join(hyprDir, "haoshoku-bindings.conf");
	const bindingsDesired = fsImpl.readFileSync(BINDINGS);
	if (
		!fsImpl.existsSync(bindingsDestination) ||
		!fsImpl.readFileSync(bindingsDestination).equals(bindingsDesired)
	) {
		if (fsImpl.existsSync(bindingsDestination))
			fsImpl.copyFileSync(
				bindingsDestination,
				`${bindingsDestination}.bak.${now()}`,
			);
		fsImpl.writeFileSync(bindingsDestination, bindingsDesired);
	}

	const destination = path.join(hyprDir, "haoshoku-workspaces.conf");
	const desired = fsImpl.readFileSync(OVERLAY);
	let overlayChanged = false;
	if (
		!fsImpl.existsSync(destination) ||
		!fsImpl.readFileSync(destination).equals(desired)
	) {
		if (fsImpl.existsSync(destination))
			fsImpl.copyFileSync(destination, `${destination}.bak.${now()}`);
		fsImpl.writeFileSync(destination, desired);
		overlayChanged = true;
	}

	const omarchyBindings = path.join(
		home,
		".local",
		"share",
		"omarchy",
		"config",
		"hypr",
		"bindings.conf",
	);
	const userBindings = path.join(hyprDir, "bindings.conf");
	let bindingsFileRestored = false;
	if (fsImpl.existsSync(omarchyBindings)) {
		const stockBindings = fsImpl.readFileSync(omarchyBindings);
		if (
			!fsImpl.existsSync(userBindings) ||
			!fsImpl.readFileSync(userBindings).equals(stockBindings)
		) {
			if (fsImpl.existsSync(userBindings))
				fsImpl.copyFileSync(userBindings, `${userBindings}.bak.${now()}`);
			fsImpl.copyFileSync(omarchyBindings, userBindings);
			bindingsFileRestored = true;
		}
	}

	const binDir = path.join(home, ".local", "bin");
	const scriptDestination = path.join(binDir, "haoshoku-special-workspace");
	fsImpl.mkdirSync(binDir, { recursive: true });
	const scriptDesired = fsImpl.readFileSync(SCRIPT);
	const scriptChanged =
		!fsImpl.existsSync(scriptDestination) ||
		!fsImpl.readFileSync(scriptDestination).equals(scriptDesired);
	if (scriptChanged) fsImpl.writeFileSync(scriptDestination, scriptDesired);
	fsImpl.chmodSync(scriptDestination, 0o755);

	let mainText = fsImpl.readFileSync(main, "utf8");
	const bindingsSource = ensureSourceAfter(
		mainText,
		BINDINGS_SOURCE_LINE,
		OMARCHY_BINDINGS_SOURCE,
	);
	mainText = bindingsSource.text;
	const workspaceSourceChanged = !mainText.split(/\r?\n/).includes(SOURCE_LINE);
	if (workspaceSourceChanged) {
		if (mainText && !mainText.endsWith("\n")) mainText += "\n";
		mainText = `${mainText}\n# Haoshoku workspace behavior (Omarchy visuals remain unchanged)\n${SOURCE_LINE}\n`;
	}
	const sourceChanged = bindingsSource.changed || workspaceSourceChanged;
	if (sourceChanged) fsImpl.writeFileSync(main, mainText);

	let validated = false;
	if (env.HYPRLAND_INSTANCE_SIGNATURE) {
		validated =
			Boolean(await runCommandImpl("hyprctl reload")) &&
			Boolean(await runCommandImpl("hyprctl configerrors"));
		// exec-once is not replayed by reload, so ensure the managed workspace is
		// populated during this install as well as on the next full login.
		await runCommandImpl(
			`${shellEscape(scriptDestination)} numbered-login 7 kitty`,
		);
	} else
		log.info(
			"Hyprland is not active; workspace validation is deferred to login.",
		);
	return {
		bindingsFileRestored,
		overlayChanged,
		scriptChanged,
		sourceChanged,
		validated,
	};
}
