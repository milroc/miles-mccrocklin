# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

In order: friends and family (people who know Miles, checking in on what
he's up to — travel, photos, work), Miles himself (the site is a personal
archive and a craft playground), and collaborators/peers (people he might
build or work with, for whom the site is a credibility artifact).

Explicitly NOT a job-seeking funnel (owner decision, 2026-07-22). Do not
optimize copy, layout, or information order for recruiter scan patterns.

## Product Purpose

A personal site at [miles.mccrockl.in](https://miles.mccrockl.in) that is
simultaneously a live resume, an editorial photography portfolio, a travel
explorer, and the future home for personal projects.

Success means two things (confirmed 2026-08-04):

1. **The craft itself.** The site keeps meeting a print-quality typographic
   bar Miles is personally proud of. Craft is a first-order goal, not a
   means to conversions.
2. **A durable home for projects.** New projects get a well-made door here
   instead of scattered external links.

## Positioning

"A resume that respects typography the way a printed document does" — an
editorial document rendered in HTML with print-grade micro-typography
(hanging indents, curly punctuation, en-dash ranges, redaction variables
with footnote anchors), presented as cream paper on a dark museum mat. The
mechanism a neighboring personal site couldn't truthfully copy is the
document-first discipline: one source of truth (`data/me.json`) rendering
to an interactive portfolio, a text-only view, and a one-page printed
Letter PDF from the same content.

## Operating Context

- Static site: Bun + React, built to `dist/`, deployed to GitHub Pages
  (CNAME `miles.mccrockl.in`). No backend.
- Five surfaces: splash (`/`), `/resume/`, `/builder/` (resume variant),
  `/explorer/` (WebGL travel globe), `/photographer/` (masonry photo wall).
- Resume content lives in `data/me.json`; photography labels are an
  event-sourced pipeline under `data/photography-labels/` merged into
  `data/photography.json` (see CLAUDE.md for commit rules).
- The resume supports three orthogonal modes: interactive editorial,
  `text-only`, and `mode-1pager` (816px, pt units, prints to one Letter
  page via the browser snapshot pipeline).
- Dev: `bun dev` on http://127.0.0.1:4317.

## Capabilities and Constraints

- All content is real: real work history, real photos with EXIF-derived
  geography, real Airbnb reviews. Nothing is invented for the page.
- Some resume facts are deliberately redacted (`data/me.json` `redactions`,
  `src/redactions.ts`); redaction anchors with footnote markers are a
  product feature, not a gap to fill.
- Country polygon data is generated (`scripts/build-world-countries.ts`);
  the explorer and splash globes share one source at two detail levels.
- Roadmap: nothing concrete is planned (confirmed 2026-08-04). The one
  durable roadmap fact is that the splash door-row list is designed to
  scale to future doors (e.g. PROJECTS) without recomposing the page.

## Brand Commitments

- Employer naming is register-scoped: referential surfaces say FB / ex-FB;
  document prose says Meta, anchored once as "Meta (formerly Facebook)";
  product names keep their historical names (see DESIGN.md § Naming).
- Guest brand quotes (Airbnb reviews block, Claude Code terminal,
  LinkedIn/Instagram hover colors) are deliberate, tokenized under
  `--guest-*`, and bounded — the resume system does not absorb them.
- Resume prose must pass the `/humanizer` bar (no spaced em-dashes, no AI
  writing tells); see CLAUDE.md § Editing resume prose.

## Evidence on Hand

- `data/me.json` — full resume content, contact, community, redactions.
- `data/photography.json` + `media/` — real photo library with labels.
- `data/journey.json`, `data/timeline.json`, world-countries topo files —
  travel data behind /explorer/.
- Real Airbnb host reviews (rendered in the reviews block), including the
  "Top-5% Superhost" seal.
- Embedded UI screenshots from past work in the resume's media figures.
- Absent, do not fabricate: testimonials beyond the Airbnb reviews,
  metrics not present in `me.json`, client names behind redactions.

## Product Principles

1. **Document first.** Every surface answers to the editorial-document
   register; interactivity serves reading, never the reverse.
2. **Craft is the product.** Typographic and visual quality is a success
   criterion in itself, held to a printed-page bar.
3. **One source of truth per content type.** `me.json` for resume prose,
   the labels event log for photography; surfaces render data, they don't
   fork it.
4. **Real things only.** Real photos, real reviews, real history;
   redaction over invention.
5. **Doors, not sprawl.** New projects join the site through the door-row
   pattern; the splash scales by addition, not redesign.
