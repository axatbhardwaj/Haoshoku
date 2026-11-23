#!/usr/bin/env node
// Inline T3 report glass check: renders a report inside a T3-style embed frame
// over two host backdrops with real Chrome and samples pixels.
// Usage: node tests/report_glass/check.js [report.html]
// Default report is fixture.html; it must pass and its solid twin must fail.
// Re-run when the T3 client embed styles or the theme change. Set CHROME to
// pick a browser binary and REPORT_GLASS_PNG=<file> to save the screenshot.
// Zero dependencies; runs on Node or a CI host runner.
import fs from "node:fs";
import path from "node:path";
import { render } from "./chrome.js";

// Copied from the T3 client inline-render frame (itemDetail chunk, 0.1.11).
export const EMBED_BASE =
	"html{box-sizing:border-box;padding:8px;background:var(--background);color:var(--foreground);font-family:var(--font-sans);font-size:14px;line-height:1.5}body{margin:0}";
export const THEME = {
	"--background": "#16191d",
	"--card": "#262b31",
	"--foreground": "#e8eaed",
	"--border": "#3a4048",
	"--muted": "#3a4048",
	"--muted-foreground": "#9aa0a6",
	"--font-sans": "system-ui,sans-serif",
};
export const BACKDROPS = ["#d03070", "#20a060"];
const CARD_ALPHA = 0.34;
const TOLERANCE = 3;
const FRAME = { width: 540, height: 300 };

const hex = (value) =>
	[1, 3, 5].map((i) => Number.parseInt(value.slice(i, i + 2), 16));
const mix = (top, bottom, alpha) =>
	top.map((c, i) => Math.round(c * alpha + bottom[i] * (1 - alpha)));
const near = (a, b) => a.every((c, i) => Math.abs(c - b[i]) <= TOLERANCE);

export function hostPage(report) {
	const vars = Object.entries(THEME)
		.map(([key, value]) => `${key}:${value}`)
		.join(";");
	const srcdoc = `<style>${EMBED_BASE}:root{${vars}}</style>${report}`;
	const escaped = srcdoc.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
	const cells = BACKDROPS.map(
		(color) =>
			`<div style="background:${color};padding:20px"><iframe srcdoc="${escaped}" style="display:block;border:0;width:${FRAME.width}px;height:${FRAME.height}px"></iframe></div>`,
	).join("");
	return `<!doctype html><style>html,body{margin:0}body{display:flex}</style>${cells}`;
}

// Runs in the host page: frame geometry plus computed alpha of text and marks.
const PROBE = `(() => [...document.querySelectorAll("iframe")].map((frame) => {
	const box = frame.getBoundingClientRect();
	const doc = frame.contentDocument;
	const view = frame.contentWindow;
	const rect = (el) => { const r = el.getBoundingClientRect(); return { left: box.left + r.left, top: box.top + r.top, right: box.left + r.right, bottom: box.top + r.bottom }; };
	const alpha = (value) => { const m = value.match(/rgba?\\(([^)]*)\\)/); if (!m) return 1; const parts = m[1].split(/[ ,/]+/).filter(Boolean); return parts.length > 3 ? Number(parts[3]) : 1; };
	const faded = [];
	for (const el of doc.body.querySelectorAll("*")) {
		const style = view.getComputedStyle(el);
		if (Number(style.opacity) < 1) faded.push(el.tagName + " opacity " + style.opacity);
		const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
		if (hasText && alpha(style.color) < 1) faded.push(el.tagName + " text " + style.color);
	}
	const bar = doc.querySelector(".rail b");
	return { frame: { left: box.left, top: box.top }, card: rect(doc.querySelector("article")), bar: rect(bar), barColor: view.getComputedStyle(bar).backgroundColor, faded };
}))()`;

export async function checkReport(report) {
	const { value: frames, png } = await render(hostPage(report), {
		width: (FRAME.width + 40) * BACKDROPS.length,
		height: FRAME.height + 40,
		probe: PROBE,
	});
	const failures = [];
	const cards = [];
	const expectCard = hex(THEME["--card"]);
	frames.forEach((frame, index) => {
		const backdrop = hex(BACKDROPS[index]);
		const label = `backdrop ${BACKDROPS[index]}`;
		const outer = png.pixel(frame.frame.left + 3, frame.frame.top + 3);
		if (!near(outer, backdrop))
			failures.push(
				`${label}: outer pixel ${outer} is not the host backdrop ${backdrop}`,
			);
		const card = png.pixel(
			frame.card.right - 6,
			(frame.card.top + frame.card.bottom) / 2,
		);
		cards.push(card);
		const glass = mix(expectCard, backdrop, CARD_ALPHA);
		if (!near(card, glass))
			failures.push(
				`${label}: card pixel ${card} is not a ${CARD_ALPHA * 100}% card tint ${glass}`,
			);
		const bar = png.pixel(
			(frame.bar.left + frame.bar.right) / 2,
			(frame.bar.top + frame.bar.bottom) / 2,
		);
		const barColor = frame.barColor.match(/\d+/g).slice(0, 3).map(Number);
		if (!near(bar, barColor))
			failures.push(
				`${label}: bar pixel ${bar} is not the opaque mark ${barColor}`,
			);
		for (const item of frame.faded)
			failures.push(`${label}: translucent ${item}`);
	});
	if (near(cards[0], cards[1]))
		failures.push(`card pixel ${cards[0]} ignores the backdrop on both hosts`);
	return failures;
}

export const solidTwin = (report) =>
	report.replace(/<style id="glass">[\s\S]*?<\/style>/, "");

async function main() {
	const target =
		process.argv[2] ?? path.join(import.meta.dirname, "fixture.html");
	const report = fs.readFileSync(target, "utf8");
	const failures = await checkReport(report);
	for (const failure of failures) console.log(`FAIL ${failure}`);
	if (!process.argv[2]) {
		const solid = await checkReport(solidTwin(report));
		const caught = ["outer pixel", "card pixel"].every((kind) =>
			solid.some((f) => f.includes(kind)),
		);
		console.log(
			caught
				? "PASS solid twin is rejected"
				: `FAIL solid twin not rejected: ${solid.join("; ") || "no failures"}`,
		);
		if (!caught) failures.push("solid twin");
	}
	console.log(
		failures.length
			? `REPORT GLASS FAIL ${target}`
			: `REPORT GLASS PASS ${target}`,
	);
	process.exit(failures.length ? 1 : 0);
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
)
	await main();
