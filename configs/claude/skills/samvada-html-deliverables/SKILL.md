---
name: samvada-html-deliverables
description: Use when creating HTML files for human readers, including reports, explainers, specs, plans, reviews, audits, research write-ups, and status pages.
---

# Samvada HTML Deliverables

## Overview

Use one visual language for every human-facing HTML file: dark ground, a
role-colored actor duel, mono machine words, and diagram-led sections.
Copy `template.html` and fill it with real content.

## Output contract

Every page has these parts, in order:

1. A concise `<title>` and `samvada-artifact-meta` JSON block containing
   `schema`, `artifact_type`, `title`, `date`, and `basis`.
2. The template's `:root` token block verbatim, including
   `color-scheme: dark;`.
3. Sections opened by a lowercase mono `.eyebrow` and an `h2` thesis.
4. A `figure` for each structural idea, using hand-authored inline SVG and a
   `figcaption` that states the remaining insight.
5. Sans prose at no more than 68 characters; commands, fields, states, and
   exit codes in mono.
6. A `.foot` stamp naming what the page reflects and its version, commit, or
   as-of date.

Map the subject's two opposing actors to `--vadi` and `--prat`—for example,
writer/reviewer or before/after. Reserve `--team` for shared ownership,
`--human` for human decisions, `--seal` for success, and `--stop` for failure.

## Quick reference

| Need | Use |
|---|---|
| Page and cards | `--ground`, `--panel`, `--panel2`, `--line` |
| Text hierarchy | `--ink`, `--dim`, `--faint` |
| Facts and routes | `.chip`, `.cards`, `.card`, `.lane`, `.route` |
| Structure | `figure > svg + figcaption` |
| Long pages | Sticky `nav` only beyond roughly three screens |

Draw SVG with geometric shapes, sparse mono labels, and a wide `viewBox`.
Keep wide content scrollable inside its `figure`; never make the page body
scroll sideways. Use dashed strokes for optional or repeated paths and a
`--seal`-stroked rectangle for gates. For several routes through shared
stages, draw one transit map instead of repeated flowcharts.

## Minimal example

```html
<section id="decision">
  <p class="eyebrow">decision path</p>
  <h2>One gate separates evidence from acceptance</h2>
  <figure>
    <svg viewBox="0 0 720 140" role="img" aria-label="Evidence reaches an acceptance gate"></svg>
    <figcaption>The human acts only after the evidence gate closes.</figcaption>
  </figure>
</section>
```

## Common mistakes

| Mistake | Correction |
|---|---|
| Improvised dark palette | Keep the template tokens verbatim |
| Structure described only in bullets | Draw the relationship; annotate it with prose |
| One accent owns every state | Map actors to `--vadi` and `--prat` |
| Figure lacks its insight | Add a specific `figcaption` |
| External fonts, scripts, or CDNs | Keep the file self-contained and offline |

Before delivery, validate the metadata JSON, inspect the page at desktop and
mobile widths, confirm reduced-motion behavior, and verify the foot stamp.
