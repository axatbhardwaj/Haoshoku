// Headless Chrome over the DevTools pipe: load a page, evaluate a probe, then
// screenshot. No dependencies; set CHROME to pick the browser binary.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodePng } from "./png.js";

const NAMES = [
	"google-chrome",
	"google-chrome-stable",
	"chromium",
	"chromium-browser",
];

function chromeBinary() {
	if (process.env.CHROME) return process.env.CHROME;
	for (const name of NAMES) {
		for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
			const file = path.join(dir, name);
			if (fs.existsSync(file)) return file;
		}
	}
	throw new Error(
		"Chrome not found; set CHROME to a Chrome or Chromium binary",
	);
}

function connect(chrome) {
	const pending = new Map();
	const events = [];
	let nextId = 0;
	let buffered = "";
	chrome.stdio[4].on("data", (chunk) => {
		buffered += chunk.toString("utf8");
		for (
			let end = buffered.indexOf("\0");
			end >= 0;
			end = buffered.indexOf("\0")
		) {
			const message = JSON.parse(buffered.slice(0, end));
			buffered = buffered.slice(end + 1);
			const waiter = pending.get(message.id);
			if (!waiter) {
				events.push(message);
				continue;
			}
			pending.delete(message.id);
			if (message.error) waiter.reject(new Error(message.error.message));
			else waiter.resolve(message.result);
		}
	});
	const fail = (error) => {
		for (const waiter of pending.values()) waiter.reject(error);
		pending.clear();
	};
	chrome.on("error", fail);
	chrome.stdio[3].on("error", fail);
	chrome.on("exit", (code) => fail(new Error(`Chrome exited early (${code})`)));
	const send = (method, params = {}, sessionId) =>
		new Promise((resolve, reject) => {
			const id = ++nextId;
			pending.set(id, { resolve, reject });
			chrome.stdio[3].write(
				`${JSON.stringify({ id, method, params, sessionId })}\0`,
			);
		});
	return { send, events };
}

// Returns the probe's JSON value and the decoded viewport screenshot.
export async function render(html, { width, height, probe }) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "report-glass-"));
	const page = path.join(dir, "host.html");
	fs.writeFileSync(page, html);
	const args = [
		"--headless=new",
		"--remote-debugging-pipe",
		`--user-data-dir=${path.join(dir, "profile")}`,
		"--no-first-run",
		"--hide-scrollbars",
		"--force-device-scale-factor=1",
		"about:blank",
	];
	if (process.getuid?.() === 0) args.unshift("--no-sandbox");
	const chrome = spawn(chromeBinary(), args, {
		stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
	});
	const { send, events } = connect(chrome);
	try {
		const { targetId } = await send("Target.createTarget", {
			url: "about:blank",
		});
		const { sessionId } = await send("Target.attachToTarget", {
			targetId,
			flatten: true,
		});
		const on = (method, params) => send(method, params, sessionId);
		await on("Emulation.setDeviceMetricsOverride", {
			width,
			height,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await on("Page.enable");
		await on("Page.navigate", { url: `file://${page}` });
		const loaded = () => events.some((e) => e.method === "Page.loadEventFired");
		for (let i = 0; i < 400 && !loaded(); i++)
			await new Promise((r) => setTimeout(r, 25));
		if (!loaded()) throw new Error("Page did not load within 10s");
		const settle =
			"document.fonts.ready.then(() => new Promise(requestAnimationFrame))";
		await on("Runtime.evaluate", { expression: settle, awaitPromise: true });
		const result = await on("Runtime.evaluate", {
			expression: probe,
			returnByValue: true,
		});
		if (result.exceptionDetails)
			throw new Error(`Probe failed: ${result.exceptionDetails.text}`);
		const shot = await on("Page.captureScreenshot", { format: "png" });
		if (process.env.REPORT_GLASS_PNG)
			fs.writeFileSync(process.env.REPORT_GLASS_PNG, shot.data, "base64");
		return {
			value: result.result.value,
			png: decodePng(Buffer.from(shot.data, "base64")),
		};
	} finally {
		chrome.removeAllListeners("exit");
		chrome.kill();
		fs.rmSync(dir, { recursive: true, force: true });
	}
}
