---
name: html-explainer
description: Create human-facing HTML reports, explainers, specs, plans, or reviews.
---

# HTML Explainer

## Overview

Use one visual language for every human-facing HTML file: dark ground, a
role-colored actor duel, mono machine words, and diagram-led sections.
Copy `template.html` and fill it with real content.

## Authorship

Separate **who decides the content** from **who renders it**. Being HTML is
not what picks the seat.

- **Content authority — `fable-planner`, `opus-reviewer`, or `sol-high-wrapper`.**
  Every technical claim, decision, correction, and revision in a plan, spec,
  or review is settled here first. Integrating contradictory revisions into
  one coherent document is a content decision, not a formatting pass.
- **Rendering — `luna-max-wrapper`.** Luna transforms already-finished content
  into the page. It is the right seat for UI and mechanical transformation,
  and for explainers or status pages whose content is already settled.

Luna never resolves a technical question, adjudicates a contradiction, or
decides what a plan says. If the packet you are about to send Luna contains
an unresolved question, it is not ready to send — route it to a content seat
first.

Delegate only the declared destination file and give the seat this skill's
output contract plus `template.html` as evidence. Validate the result yourself before
delivery: metadata JSON, fully self-contained offline page (no external
loads; citation links allowed), desktop and mobile widths, reduced-motion,
print, and the foot stamp.

## Output contract

Every page has these parts, in order:

1. A concise `<title>` and `artifact-meta` JSON block containing
   `schema`, `artifact_type`, `title`, `date`, and `basis`.
2. The template's `:root` token block verbatim, including
   `color-scheme: dark;`.
3. Sections opened by a lowercase mono `.eyebrow` and an `h2` thesis.
4. A `figure` only where geometry carries meaning, using hand-authored
   inline SVG and a `figcaption` that states the remaining insight.
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

## What earns a figure

A drawing must encode a variable in its geometry. Position, length, area, or
containment has to carry information that the labels do not. If the only
thing the layout conveys is reading order, you have drawn a list.

Apply the demotion test before drawing: **could this be an `ol` or a `table`
with nothing lost?** If yes, make it one. HTML text is selectable,
searchable, responsive, and screen-readable; an SVG of the same content is
none of those.

| Shape | Verdict |
|---|---|
| Rows of `label · value · note` | A `table`. Never draw it. |
| Boxes chained left to right, one per step | An `ol`. Never draw it. |
| A stage with a gate is the only interest | Prose plus one `--seal` chip |
| Concurrency, critical path, idle time | Draw it — length means duration |
| Same structure before and after | Draw it — both states share an axis |
| Branch that rejoins, cycle, retry loop | Draw it — a list cannot close a loop |
| Containment, nesting, ownership transfer | Draw it — enclosure means scope |
| Several routes over shared stages | Draw one transit map, not N flowcharts |

Two figures that each earn their place beat five that decorate. A section
with no such relationship gets prose, a table, or `.lane` blocks — that is a
correct outcome, not a missing figure.

Draw with geometric shapes, sparse mono labels, and a wide `viewBox`. Keep
wide content scrollable inside its `figure`; never make the page body scroll
sideways. Use dashed strokes for optional or repeated paths and a
`--seal`-stroked rectangle for gates. Where length encodes a quantity, say
what the axis measures in the `figcaption` — an unlabelled axis is
decoration.

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
| A table or ordered list drawn in SVG | Demote it to `table` or `ol` |
| Boxes and arrows that only set reading order | Cut the figure or find the real variable |
| Length or position varies for looks | Make it mean something, or make it uniform |
| A figure per section, by reflex | Only where geometry carries meaning |
| Structure described only in bullets | Draw the relationship; annotate it with prose |
| One accent owns every state | Map actors to `--vadi` and `--prat` |
| Figure lacks its insight | Add a specific `figcaption` |
| External fonts, scripts, or CDNs | Keep the file self-contained and offline |

Before delivery, validate the metadata JSON, inspect the page at desktop and
mobile widths, confirm reduced-motion behavior, and verify the foot stamp.
