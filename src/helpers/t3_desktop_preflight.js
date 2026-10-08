import path from "node:path";
import {
	checkOpEnvironment,
	OP_DROP_CONTENT,
	OP_DROP_IN,
	OP_ENV_FIX,
	OP_ENV_PATH,
} from "./configure_t3_op.js";
import { shellQuote } from "./t3_tailscale.js";

// T3's installed desktop defaults localEnvironmentEnabled to true, uses
// T3CODE_HOME (otherwise ~/.t3), and stores desktop settings under userdata.
// Read effective systemd properties rather than assuming the generated unit
// is still the complete configuration. Never read pairing state.
function words(value) {
	const result = [];
	let word = "";
	let quote = "";
	let escaped = false;
	for (const char of value) {
		if (escaped) {
			word += char;
			escaped = false;
		} else if (char === "\\") escaped = true;
		else if (quote) {
			if (char === quote) quote = "";
			else word += char;
		} else if (char === '"' || char === "'") quote = char;
		else if (/\s/.test(char)) {
			if (word) result.push(word);
			word = "";
		} else word += char;
	}
	if (quote || escaped) throw new Error("ambiguous service environment");
	if (word) result.push(word);
	return result;
}

// systemd omits empty optional properties, including all selected properties
// for transient scopes. Nonempty output must still be unambiguous show data.
function showProperties(output) {
	const properties = {};
	for (const line of output.split("\n").filter(Boolean)) {
		const match =
			/^(LoadState|Environment|ExecStart|EnvironmentFiles)=(.*)$/.exec(line);
		if (!match || Object.hasOwn(properties, match[1]))
			throw new Error("invalid systemd property evidence");
		properties[match[1]] = match[2];
	}
	return properties;
}

export async function preflightT3Desktop({
	home,
	env,
	fsImpl,
	captureCommandImpl,
	fail,
}) {
	try {
		if (env.T3CODE_DEV_SERVER_URL || env.T3CODE_DESKTOP_DEV_SERVER_URL)
			throw new Error("ambiguous development desktop directory");
		const read = (file) => {
			try {
				return fsImpl.readFileSync(file, "utf8");
			} catch (error) {
				if (error.code === "ENOENT") return null;
				throw new Error("unreadable T3 evidence");
			}
		};
		const list = (directory) => {
			try {
				return fsImpl.readdirSync(directory);
			} catch (error) {
				if (error.code === "ENOENT") return [];
				throw new Error("unreadable desktop installation evidence");
			}
		};
		const probe = async (command, allowAbsent = false) => {
			const result = await captureCommandImpl(command, {
				log: false,
				stdin: "ignore",
				expectFailure: true,
				shell: command.startsWith("command -v "),
			});
			if (result.exitCode !== 0 && !(allowAbsent && result.exitCode === 1))
				throw new Error("desktop/service probe failed");
			if (allowAbsent && result.exitCode === 1 && result.stderr?.trim())
				throw new Error("failed launcher absence probe");
			if (typeof result.stdout !== "string")
				throw new Error("invalid probe result");
			return result.stdout.trim();
		};
		const directory = (value, systemd = false) => {
			const expanded = systemd
				? value.trim().replaceAll("%h", home)
				: value.trim();
			const absolute = expanded.startsWith("~/")
				? path.join(home, expanded.slice(2))
				: expanded;
			if (
				!path.isAbsolute(absolute) ||
				absolute.includes("\0") ||
				/[%\r\n]/.test(absolute)
			)
				throw new Error("ambiguous T3 directory");
			return path.normalize(absolute);
		};
		const defaultBase = path.join(home, ".t3");
		const desktopBase = env.T3CODE_HOME?.trim()
			? directory(env.T3CODE_HOME)
			: defaultBase;
		const service = await probe(
			"systemctl --user show t3code.service --property=LoadState,Environment,ExecStart,EnvironmentFiles",
		);
		const properties = showProperties(service);
		if (!["loaded", "not-found"].includes(properties.LoadState))
			throw new Error("unknown effective T3 service directory");
		const opDrop = path.join(
			home,
			".config/systemd/user/t3code.service.d",
			OP_DROP_IN,
		);
		const opContents = read(opDrop);
		if (opContents !== null && checkOpEnvironment(home, fsImpl) === "invalid")
			throw new Error(OP_ENV_FIX);
		if (opContents !== null && opContents !== OP_DROP_CONTENT)
			throw new Error("unrecognized 1Password drop-in");
		const opEnvironment = path.join(home, OP_ENV_PATH);
		const environmentFiles = properties.EnvironmentFiles;
		if (
			(environmentFiles &&
				(opContents !== OP_DROP_CONTENT ||
					![opEnvironment, `${opEnvironment} (ignore_errors=yes)`].includes(
						environmentFiles,
					))) ||
			properties.ExecStart?.includes("--base-dir") ||
			(properties.LoadState === "not-found" &&
				(properties.Environment || properties.ExecStart || environmentFiles))
		)
			throw new Error("ambiguous service directory overrides");
		const environmentBases = (value) =>
			words(value)
				.filter((word) => word.startsWith("T3CODE_HOME="))
				.map((word) => directory(word.slice(12), true));
		const bases = environmentBases(properties.Environment ?? "");
		if (properties.LoadState === "loaded" && bases.length !== 1)
			throw new Error("unknown effective T3 service directory");
		const baseDir = bases[0] ?? desktopBase;
		if (env.T3CODE_HOME?.trim() && baseDir !== desktopBase)
			throw new Error("conflicting T3 directories");
		// Pending unit edits must agree with the running manager before mutation.
		const unitDir = path.join(home, ".config/systemd/user");
		const unitFiles = [
			path.join(unitDir, "t3code.service"),
			...list(path.join(unitDir, "t3code.service.d"))
				.filter((name) => name.endsWith(".conf"))
				.map((name) => path.join(unitDir, "t3code.service.d", name)),
		];
		for (const file of unitFiles) {
			const contents = read(file);
			if (contents === null) continue;
			if (file === opDrop && contents === OP_DROP_CONTENT) continue;
			for (const line of contents.split("\n")) {
				if (
					/^\s*EnvironmentFile\s*=/.test(line) ||
					/^\s*ExecStart\s*=.*--base-dir/.test(line)
				)
					throw new Error("ambiguous service directory overrides");
				const environment = /^\s*Environment\s*=(.*)$/.exec(line)?.[1];
				if (
					environment !== undefined &&
					environmentBases(environment).some((base) => base !== baseDir)
				)
					throw new Error("conflicting service directory evidence");
			}
		}
		let desktop = Boolean(
			await probe("command -v t3code t3code-nightly", true),
		);
		for (const file of [
			"/usr/lib/t3code/resources/app.asar",
			"/usr/lib/t3code-nightly/resources/app.asar",
			"/opt/T3 Code/resources/app.asar",
		]) {
			try {
				fsImpl.statSync(file);
				desktop = true;
			} catch (error) {
				if (error.code !== "ENOENT")
					throw new Error("unreadable desktop installation evidence");
			}
		}
		for (const applications of new Set([
			path.join(home, ".local/share/applications"),
			path.join(
				env.XDG_DATA_HOME || path.join(home, ".local/share"),
				"applications",
			),
			"/usr/share/applications",
		])) {
			for (const name of list(applications).filter((name) =>
				/(?:t3code|t3-code|com\.t3tools\.T3Code).*\.desktop$/i.test(name),
			)) {
				desktop = true;
				const launcher = read(path.join(applications, name));
				if (
					launcher === null ||
					/T3CODE_HOME|--base-dir|T3CODE_.*DEV_SERVER_URL/.test(launcher)
				)
					throw new Error("ambiguous desktop launch directory");
			}
		}
		const desktopUnits = new Set();
		for (const command of [
			"systemctl --user list-unit-files --no-legend --no-pager",
			"systemctl --user list-units --all --no-legend --no-pager",
		]) {
			const units = await probe(command);
			for (const line of units.split("\n")) {
				const unit = line.trim().replace(/^●\s*/, "").split(/\s+/)[0];
				if (
					/t3code|t3-code|com\.t3tools\.T3Code/i.test(unit) &&
					unit !== "t3code.service"
				)
					desktopUnits.add(unit);
			}
		}
		for (const unit of desktopUnits) {
			desktop = true;
			const detail = await probe(
				`systemctl --user show ${shellQuote(unit)} --property=Environment,ExecStart,EnvironmentFiles`,
			);
			const properties = showProperties(detail);
			const isScope = unit.endsWith(".scope");
			if (
				(!isScope && !detail) ||
				properties.LoadState !== undefined ||
				properties.EnvironmentFiles ||
				/--base-dir|^ExecStart=.*T3CODE_HOME|T3CODE_.*DEV_SERVER_URL/m.test(
					detail,
				)
			)
				throw new Error("ambiguous desktop unit directory");
			const unitBases = environmentBases(properties.Environment ?? "");
			// A scope signals desktop presence but carries no launch environment;
			// retain the process check below instead of inventing a default base.
			const unitBase = unitBases[0] ?? (isScope ? undefined : defaultBase);
			if (
				unitBases.length > 1 ||
				(unitBase !== undefined && unitBase !== desktopBase)
			)
				throw new Error("conflicting desktop unit directory");
		}
		const processes = await probe("ps -eo pid=,comm=,args=");
		for (const line of processes.split("\n")) {
			const match = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line);
			if (
				!match ||
				!/(?:^|[\s/])(?:t3code(?:-nightly)?|T3 Code)(?:[\s/]|$)/i.test(
					`${match[2]} ${match[3]}`,
				) ||
				/apps\/server\/|service-launcher/.test(match[3])
			)
				continue;
			desktop = true;
			const environment = read(`/proc/${match[1]}/environ`);
			if (environment === null)
				throw new Error("unverifiable desktop process directory");
			const entries = environment.split("\0");
			const homes = entries.filter((entry) => entry.startsWith("T3CODE_HOME="));
			if (homes.length > 1)
				throw new Error("ambiguous desktop process directory");
			const processBase = homes.length
				? directory(homes[0].slice(12))
				: defaultBase;
			if (
				processBase !== desktopBase ||
				entries.some((entry) =>
					/^T3CODE_(?:DEV_SERVER_URL|DESKTOP_DEV_SERVER_URL)=.+/.test(entry),
				)
			)
				throw new Error("conflicting desktop process directory");
		}
		if (desktop && baseDir !== desktopBase)
			throw new Error("conflicting desktop and service directories");
		let missingSettings;
		for (const base of new Set([defaultBase, desktopBase, baseDir])) {
			const settingsFile = path.join(base, "userdata/desktop-settings.json");
			const contents = read(settingsFile);
			if (contents === null) {
				if (desktop && base === desktopBase) missingSettings = settingsFile;
				continue;
			}
			if (base !== baseDir)
				throw new Error("conflicting desktop settings directories");
			let settings;
			try {
				settings = JSON.parse(contents);
			} catch {
				throw new Error("malformed desktop settings");
			}
			if (
				!settings ||
				Array.isArray(settings) ||
				typeof settings !== "object" ||
				settings.localEnvironmentEnabled !== false
			)
				throw new Error("Local environment is enabled or unverified");
		}
		if (missingSettings) {
			fsImpl.mkdirSync(path.dirname(missingSettings), { recursive: true });
			fsImpl.writeFileSync(
				missingSettings,
				`${JSON.stringify({ localEnvironmentEnabled: false }, null, 2)}\n`,
				{ flag: "wx", mode: 0o600 },
			);
		}
		return { baseDir };
	} catch (error) {
		fail(
			error.message === OP_ENV_FIX
				? OP_ENV_FIX
				: "T3 setup is incomplete: desktop Local environment or its data directory could not be confirmed safe. In T3 Code desktop, disable Local environment, then pair the desktop to the existing service. Resolve unreadable or conflicting desktop/service directory evidence, including service drop-ins, before retrying. Haoshoku leaves desktop settings and pairing tokens unchanged.",
		);
		return null;
	}
}
