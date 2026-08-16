// Test-run nonce: nonce-gaming-lua-9a34c7
import { expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.join(import.meta.dir, "..");
const configsRoot = path.join(repoRoot, "configs");
const hyprctlDispatchPattern =
	/(?:\bhyprctl|"\$\{?[A-Za-z_][A-Za-z0-9_]*\}?"|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?)[ \t]+dispatch\b(?<arguments>.*)/;

function filesBelow(directory) {
	return fs
		.readdirSync(directory, { withFileTypes: true })
		.sort((left, right) => left.name.localeCompare(right.name))
		.flatMap((entry) => {
			const entryPath = path.join(directory, entry.name);
			return entry.isDirectory() ? filesBelow(entryPath) : [entryPath];
		});
}

function shouldScan(relativePath) {
	// Caelestia targets a different compositor setup whose .conf files still require positional dispatches.
	return !relativePath.startsWith("configs/caelestia/");
}

function firstShellArgument(source) {
	const input = source.trimStart();
	let quote = null;
	let escaped = false;
	for (let index = 0; index < input.length; index += 1) {
		const character = input[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (character === "\\" && quote !== "'") {
			escaped = true;
			continue;
		}
		if (quote) {
			if (character === quote) quote = null;
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			continue;
		}
		if (/\s/.test(character)) return input.slice(0, index);
	}
	return input;
}

function unquote(argument) {
	if (
		(argument.startsWith('"') && argument.endsWith('"')) ||
		(argument.startsWith("'") && argument.endsWith("'"))
	) {
		return argument.slice(1, -1);
	}
	return argument;
}

function isLuaExpressionArgument(argument) {
	const value = unquote(argument);
	if (value.trimStart().startsWith("hl.")) return true;
	const variable = value.match(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/)?.[1];
	return variable ? /(?:expression|lua)/i.test(variable) : false;
}

function directDispatchArguments(line) {
	if (/^\s*#/.test(line)) return null;
	const match = hyprctlDispatchPattern.exec(line);
	return match?.groups.arguments ?? null;
}

function directLegacyDispatch(line) {
	const argumentsSource = directDispatchArguments(line);
	if (argumentsSource === null) return false;
	const argument = firstShellArgument(argumentsSource);
	return argument.length === 0 || !isLuaExpressionArgument(argument);
}

function braceDelta(line) {
	let delta = 0;
	let quote = null;
	let escaped = false;
	for (const character of line) {
		if (escaped) {
			escaped = false;
			continue;
		}
		if (character === "\\" && quote !== "'") {
			escaped = true;
			continue;
		}
		if (quote) {
			if (character === quote) quote = null;
			continue;
		}
		if (character === '"' || character === "'") quote = character;
		else if (character === "#") break;
		else if (character === "{") delta += 1;
		else if (character === "}") delta -= 1;
	}
	return delta;
}

function shellFunctions(lines) {
	const functions = [];
	for (let start = 0; start < lines.length; start += 1) {
		const declaration = lines[start].match(
			/^\s*(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*\{/,
		);
		if (!declaration) continue;
		let depth = braceDelta(lines[start]);
		let end = start;
		while (depth > 0 && end + 1 < lines.length) {
			end += 1;
			depth += braceDelta(lines[end]);
		}
		functions.push({ end, name: declaration[1], start });
		start = end;
	}
	return functions;
}

function wrapperCallArguments(line, wrapperName) {
	const pattern = new RegExp(
		`(?:^|[;&|])\\s*${wrapperName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(?<arguments>.*)$`,
	);
	return pattern.exec(line)?.groups.arguments ?? null;
}

function legacyDispatchViolations(relativePath, source) {
	const lines = source.split("\n");
	const functions = shellFunctions(lines);
	const dispatchWrappers = new Set(
		functions
			.filter(({ start, end }) =>
				lines
					.slice(start, end + 1)
					.some((line) => directDispatchArguments(line) !== null),
			)
			.map(({ name }) => name),
	);
	const violations = [];

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (directLegacyDispatch(line)) {
			violations.push({
				call: line.trim(),
				file: relativePath,
				line: index + 1,
			});
		}
		for (const wrapperName of dispatchWrappers) {
			const argumentsSource = wrapperCallArguments(line, wrapperName);
			if (argumentsSource === null) continue;
			const argument = firstShellArgument(argumentsSource);
			if (argument.length > 0 && !isLuaExpressionArgument(argument)) {
				violations.push({
					call: line.trim(),
					file: relativePath,
					line: index + 1,
				});
			}
		}
	}

	return violations.filter(
		(violation, index) =>
			violations.findIndex(
				(candidate) =>
					candidate.file === violation.file &&
					candidate.line === violation.line,
			) === index,
	);
}

it("rejects legacy Hyprland dispatches across configs, including passthrough wrappers", () => {
	const violations = filesBelow(configsRoot).flatMap((file) => {
		const relativePath = path.relative(repoRoot, file);
		return shouldScan(relativePath)
			? legacyDispatchViolations(relativePath, fs.readFileSync(file, "utf8"))
			: [];
	});
	const evidence = violations
		.map(({ file, line, call }) => `${file}:${line}: ${call}`)
		.join("\n");

	expect(
		violations,
		`Legacy Hyprland dispatch calls must be v4 Lua expressions:\n${evidence}`,
	).toEqual([]);
});

it("recognizes caelestia legacy syntax before excluding that path", () => {
	const legacyLine = "bind = SUPER, 5, exec, hyprctl dispatch workspace 5";

	expect(directLegacyDispatch(legacyLine)).toBe(true);
	expect(
		directLegacyDispatch('$SOME_VAR dispatch workspace "$workspace"'),
	).toBe(true);
	expect(directLegacyDispatch("# hyprctl dispatch workspace 5")).toBe(false);
	expect(shouldScan("configs/caelestia/hypr-user-pc.conf")).toBe(false);
	expect(shouldScan("configs/scripts/example")).toBe(true);
	expect(
		directLegacyDispatch(
			'"$HYPRCTL" dispatch "hl.dsp.focus({ workspace = \\"11\\" })"',
		),
	).toBe(false);
	expect(
		directLegacyDispatch('hyprctl dispatch "prefix hl.dsp.focus({})"'),
	).toBe(true);
});

it("follows one level of a Lua-expression dispatch wrapper", () => {
	const source = `dispatch() {
  "$HYPRCTL" dispatch "$expression"
}
dispatch workspace "$workspace"`;

	expect(legacyDispatchViolations("configs/scripts/example", source)).toEqual([
		{
			call: 'dispatch workspace "$workspace"',
			file: "configs/scripts/example",
			line: 4,
		},
	]);
});
