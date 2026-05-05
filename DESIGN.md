# Design System — Miles McCrocklin Resume

This is the as-built design system extracted from `styles.css`. It documents
the system that exists, not a system to migrate to. Known drift is captured at
the end so future changes either close it or cite a reason.

## Product Context

- **What this is:** A personal resume website that doubles as an editorial
  portfolio. It carries the live resume, embedded UI screenshots from past
  work, photo-essay marginalia, Airbnb host reviews, and a 1-pager mode that
  prints to a single Letter page.
- **Who it's for:** Hiring partners (engineers, EMs, founders, investors)
  reading on desktop or mobile, plus the printed PDF reader.
- **Project type:** Personal site / editorial document.
- **Memorable thing:** *A resume that respects typography the way a printed
  document does.* Knuth-Plass line breaking, soft-hyphen pre-processing,
  hanging-indent bullets, italic editorial taglines, tabular numerals on
  dates. Every design decision should serve this.

## Aesthetic Direction

- **Direction:** Editorial CV — LaTeX "Awesome-CV" / Deedy lineage rendered in
  HTML, presented under museum-mat lighting. The cream paper floats on a
  dark canvas; the document voice is the same, the framing is what changed.
- **Decoration level:** Minimal. Type and whitespace do the work. The only
  decoration is the dark canvas mat, the floating-paper shadow, and the
  forest-green accent.
- **Mood:** Confident, deliberate, restrained. The page should feel like a
  well-set book page resting on a dark felt portfolio — not a marketing site,
  not a dashboard.
- **Reference lineage:** Awesome-CV (LaTeX), Deedy resume template,
  monograph-style editorial layout.

## Typography

- **Display + body:** Georgia, with Times / Times New Roman as graceful
  fallback. Italics carry editorial weight (taglines, locations, dates).
- **UI / mono / metrics:** JetBrains Mono (400, 500), with
  `ui-monospace, SFMono-Regular, Menlo, monospace` fallback. Used for
  toolbar, eyebrow labels, repo paths, metric numerals, contact mono row.
- **Loading:** Google Fonts via `@import` for JetBrains Mono. Georgia is
  system-installed, no network cost.
- **Hierarchy convention:** Section labels are deliberately the *smallest*
  type on the page (~10.5px). Weight (800), tracking (0.36em), and caps do
  the work — size restraint is what creates the editorial hierarchy.
- **Italic register:** Reserved for serif italic at the muted color —
  used for taglines, summaries, locations, and dates. They share one voice
  and recede into the body register; only size separates them.
- **Numerals:** `font-variant-numeric: tabular-nums` and
  `font-feature-settings: "tnum" 1` on every date and metric so columns
  align across stacked entries.

### Type scale (screen)

Editorial type rewards half-pixel tuning at small sizes; this is a register
naming, not a strict modular ratio. Tokens live on `:root`. 1-pager / print
uses `pt` units — see `.page.mode-1pager`.

| Token              | Value     | Used by                                            |
| ------------------ | --------- | -------------------------------------------------- |
| `--fs-display`     | 48px      | `.name` (display)                                  |
| `--fs-display-sm`  | 32px      | `.name` (mobile @ ≤560px)                          |
| `--fs-body`        | 13.5px    | page baseline, entry-summary, lead body            |
| `--fs-entry`       | 13px      | entry-head .l (primary), era-tagline, play-badge   |
| `--fs-bullet`      | 12.5px    | bullets, era-summary, entry-sub .r, ab-text/name   |
| `--fs-entry-sub`   | 12px      | entry-sub .l, entry-head .r (date), inline mode    |
| `--fs-era`         | 11.5px    | era-head, ab-translate                             |
| `--fs-tag`         | 11px      | contact-stack inline, era-head period, toolbar     |
| `--fs-eyebrow`     | 10.5px    | section labels, mono toolbar, metrics chrome       |
| `--fs-micro`       | 10px      | chip, audit, ab-stars                              |
| `--fs-eyebrow-sm`  | 9.5px     | metric key, ai-summary-hint                        |
| `--fs-overlay`     | 9px       | figure-tag overlay, ab-translate sub               |

Component-local one-offs (left inline, deliberately):
`.metric .v` 15px, `.ab-favorite-title` 20px, `.ab-favorite-rating` 56px /
44px (mobile), `.lb-prev`/`.lb-next` 32px, `.lb-close` 22px.

### 1-pager / print sizes

The 1-pager mode swaps to `pt` units so the on-screen preview and the
printed PDF share one ruleset. The mapping is approximate, not derived from
the screen scale.

| Role                  | Print pt        |
| --------------------- | --------------- |
| Name (display)        | 20pt            |
| Body / page baseline  | 9.5pt           |
| Bullets               | 9pt             |
| Entry head            | 10.5pt          |
| Entry sub             | 9pt             |
| Section labels        | 8.5pt           |
| Era period            | 8.5pt           |

## Color

- **Approach:** Restrained. Cream paper floating on a dark canvas mat, with
  one forest-green accent. The page reads as a document presented under
  museum-mat lighting — the dark mat makes the paper pop without turning
  the resume itself into "dark mode UI."

### Canvas (the mat the paper floats on)

The canvas is a separate context from the paper. Anything that renders
directly on canvas (toolbar, skip-link) uses the `--canvas-fg`
token family — `--ink` and `--muted` are paper-context and would be
unreadable on the dark mat.

| Token                  | Value                          | Usage                                            |
| ---------------------- | ------------------------------ | ------------------------------------------------ |
| `--canvas`             | `#1c1f1a`                      | Outside the paper (body background)              |
| `--canvas-fg-strong`   | `#ece9e2`                      | Primary text on canvas, hover/active states      |
| `--canvas-fg`          | `#b8b5ad`                      | Secondary text on canvas (toolbar buttons rest)  |
| `--canvas-fg-muted`    | `#7a7770`                      | Muted text on canvas (toolbar label)             |
| `--canvas-rule`        | `rgba(236, 233, 226, 0.20)`    | Subtle borders on canvas (toolbar buttons)       |

### Paper (the resume itself)

| Token              | Value     | Usage                                            |
| ------------------ | --------- | ------------------------------------------------ |
| `--paper`          | `#fdfdfb` | Page background (the floating paper)             |
| `--ink`            | `#111111` | Primary text, name, hover state                  |
| `--ink-soft`       | `#2a2a2a` | Body bullets, entry summaries, era body          |
| `--muted`          | `#6b6b6b` | Dates, captions, eyebrow labels, mono rows       |
| `--rule`           | `#d9d6cf` | Section rules, chip borders, dividers            |
| `--rule-strong`    | `#1a1a1a` | Defined; rarely used                             |
| `--shadow`         | layered   | Floating-paper shadow — tuned for dark canvas    |

### Accent

The single piece of color personality on the page. Used sparingly: link
hover underline, metric numerals, top-skill emphasis, focus outline. Hue
picked to read confident at 10–13px and to coordinate with the canvas
undertone.

| Token              | Value                  | Usage                                  |
| ------------------ | ---------------------- | -------------------------------------- |
| `--accent`         | `#3a6b4a`              | Forest green — accent surfaces above  |
| `--accent-soft`    | `rgba(58,107,74,0.10)` | Metrics block background               |

- **Dark mode:** Not implemented as a toggle. The screen presentation is
  cream paper on dark mat; print is cream paper on white (browsers honor
  `background: white` from the `@media print` block). The paper itself is
  always cream/black ink.

### Guest palette — Airbnb reviews block

The Airbnb reviews block (`.reviews.airbnb`) deliberately quotes Airbnb's
visual identity. Tokens live on `:root` with the `--guest-airbnb-*` prefix
so the boundary between the resume system and a brand quote is explicit.
Future guest palettes (e.g. a quoted Substack or LinkedIn block) follow the
same convention.

| Token                          | Value              |
| ------------------------------ | ------------------ |
| `--guest-airbnb-bg`            | `var(--paper)`     |
| `--guest-airbnb-border`        | `#ebebeb`          |
| `--guest-airbnb-fg`            | `#222222`          |
| `--guest-airbnb-fg-soft`       | `#484848`          |
| `--guest-airbnb-fg-muted`      | `#717171`          |
| `--guest-airbnb-highlight`     | `rgba(0,0,0,0.06)` |
| `--guest-airbnb-red`           | `#FF5A5F`          |

## Spacing

- **Base unit:** 4px (most rhythms snap to 4 / 8 / 12 / 14 / 18 / 24 / 28 / 36).
- **Density:** Comfortable on screen, dense in 1-pager mode.
- **Page padding:** Fluid via `clamp()`. `--page-pad-y: clamp(28px, 4.5vw, 56px)`,
  `--page-pad-x: clamp(16px, 5vw, 72px)`. Below 600px viewport the page sits
  edge-to-edge.

## Layout

- **Approach:** Single-column editorial. One 850px paper page, centered on a
  cream canvas, floating with a soft shadow.
- **Page width:** `--page-width: 850px`. Content shrinks to viewport below
  that. 1-pager mode uses 816px (US Letter at 96dpi).
- **Border radius:** Almost universally 0 (sharp document edges). Selective
  use: 2px on toolbar buttons, chips, metrics block; 4px on the Airbnb
  block; 50% on summary-portrait avatars and lightbox nav circles.
- **Container queries:** The header uses `container-type: inline-size` so
  contact rows can collapse to a single column when wrapping would orphan
  separator dots. Inline entries do the same with `container-name: inline-l`.
- **Shadows:** Two registers. `--shadow` (subtle paper float). `0 6px 20px
  rgba(0,0,0,0.16-0.18)` for hover lifts on figures and portraits.
  Lightbox imagery gets `0 30px 80px rgba(0,0,0,0.55)`.

## Photography Treatment

A real piece of design language. Tokens live on `:root` so the editorial
register stays visible.

| Token                       | Value                                          |
| --------------------------- | ---------------------------------------------- |
| `--photo-filter-rest`       | `grayscale(0.18) contrast(1.02)`               |
| `--photo-filter-hover`      | `grayscale(0) contrast(1.04)`                  |
| `--photo-filter-trans`      | `filter 240ms ease, transform 320ms ease`      |

- **Hover transform:** `scale(1.03–1.04)` (kept inline; the value differs
  per surface — figures lift 1.03, portraits lift 1.04).
- **Intent:** Photography reads as editorial marginalia at rest, snaps to
  full color on intent. Avoids the "vacation slideshow" energy a 100%-color
  gallery would carry inside an editorial document.

## Motion

- **Approach:** Minimal-functional. Motion is reserved for hover states,
  carousel/lightbox transitions, and the skip-link reveal.
- **Easing + duration:**
  - Standard hover: `120-200ms ease`
  - Photography filter / scale: `240-320ms ease`
  - Lightbox carousel slide: `360ms cubic-bezier(0.4, 0, 0.2, 1)`
  - Lightbox fade-in: `180ms ease`
- **Reduced motion:** `@media (prefers-reduced-motion: reduce)` pauses
  carousel autoplay videos and clears photo-card transitions. The
  `lightbox` fade still runs (single 180ms event, judged tolerable).

## Modes

The page supports three orthogonal modes set as classes on `.page`:

1. **Default (interactive editorial).** Full media, carousels, lightbox,
   reviews. The portfolio voice.
2. **`text-only`.** Hides figures, reviews, metrics, chips, summary gallery,
   era taglines, and entry summaries (except `.entry-summary.lead`). Bullets
   shift to full-ink color. The terse deliverables-focused view.
3. **`mode-1pager`.** Compresses to 816px wide, switches to `pt` units
   (9.5pt body), tightens spacing, expands AI-experiments details, prepares
   for print. The print pipeline auto-switches to this before the browser
   snapshots the DOM.

Print uses `@page { size: letter; margin: 0 }` with page padding handled by
`.page` CSS instead. The browser's auto header/footer is starved of margin
space and dropped.

## Custom Typography Pipeline

The soul of the site. Documented here because anyone touching `.bullets`
needs to know.

- **Knuth-Plass line breaker** lives in `src/utils/kp.ts`, soft-hyphen
  pre-processor in `src/utils/hyphenate.ts`. They run client-side after fonts
  load and re-run when the column width changes.
- **`.kp-wrap` and `.kp-line`** are load-bearing class hooks. `.kp-line` is
  set to `display: inline; white-space: nowrap` because the browser would
  otherwise re-break at internal hyphens on top of KP's chosen breaks,
  doubling the wrap.
- **Don't add `word-wrap`, `overflow-wrap`, or `hyphens` rules to `.bullets`
  without reading the KP wrap logic.** It will fight the line-breaker and
  produce visible jitter.

## Known Drift

### D1 — Lato is loaded but never rendered ✅ Closed 2026-05-01

Dropped Lato from the Google Fonts `@import`; removed misleading "Lato
first" comments. Body and display now correctly cite Georgia.

### D2 — No type scale ✅ Closed 2026-05-01

Defined `--fs-display` through `--fs-overlay` on `:root` and migrated every
screen-mode `font-size` declaration. Component-local one-offs left inline
(see "Type scale" §). The 1-pager `pt` sizes were not migrated — they're a
separate ruleset for print fidelity.

Note: the scale is register-named, not a strict modular ratio. Editorial
type at small sizes rewards half-pixel tuning more than ratio purity. If a
future change wants ratio discipline, it should pick a base (~13.5px body)
and a ratio (1.067 or 1.125) and reflow the registers in one pass.

### D3 — Hardcoded colors outside the token system ✅ Closed 2026-05-01

- Canvas `#ece9e2` → `--canvas`.
- Airbnb red `#FF5A5F` → `--guest-airbnb-red`.

Remaining hex literals are lightbox chrome (`#fff`, `#000`, `#ddd`, `#999`)
and carousel mask-image gradient stops. These are intentionally local —
the lightbox is a "dark theater" voice that shouldn't borrow editorial
ink tokens.

### D4 — Guest tokens lack a naming prefix ✅ Closed 2026-05-01

Renamed `--ab-*` → `--guest-airbnb-*` and lifted the definition out of
`.reviews.airbnb` into `:root`. The `guest-` prefix is the convention for
any future deliberate brand quote.

### D5 — Photography filter values are inline ✅ Closed 2026-05-01

Promoted to `--photo-filter-rest`, `--photo-filter-hover`, and
`--photo-filter-trans`. The `transform: scale()` lift stays inline because
the value differs per surface (figures 1.03, portraits 1.04).

### D6 — Accent dosage ✅ Closed 2026-05-01 (held dosage, swapped hue)

The dosage of `--accent` (5 surfaces) was kept as-is — restraint is the
right call for an editorial document; loud accent dosage would read as
marketing-site energy. The hue moved from brick red `#b03a2e` to forest
green `#3a6b4a`. Reason: the green coordinates with the new dark-canvas
undertone and matches the project owner's aesthetic, while preserving
the "color is rare and meaningful" principle.

### D7 — Dark canvas + paper-pop framing ✅ Shipped 2026-05-01

Not originally a drift item; added during the same pass. Replaced the
cream `--canvas` with a deep warm near-black (`#1c1f1a`) so the cream
paper genuinely pops as a discrete artifact. Introduced a `--canvas-fg`
token family for everything that renders on the mat (toolbar,
skip-link). Print mode is unaffected; the resume itself is still cream
paper with black ink.

### D9 — Lightning strikes (delight) ✅ Shipped 2026-05-01

Brief jagged typographic bolts arc from the cursor in the dark mat to
fixed anchors on the resume page — like the resume is a Faraday cage
absorbing the discharge. Each bolt spells a fragment of the user's bio
(names, roles, teams, products, tools) along its zigzag path, flashes
briefly, and fades. Five marquees fire on staggered cadences so the
storm reads as organic, not synchronized.

**Lives in `src/lightning.ts`.** Self-installing ES module, no globals.
Hides under `prefers-reduced-motion` and on print. The lightning
metaphor is product-meaningful: the resume *attracts* the discharge.

**Phrase pool** is hardcoded as `MARQUEES` — five sublists for five
marquees. Each strike picks one phrase and lays it head-to-tail along
the jagged path with natural Georgia letter widths, repeating if the
path is longer than the phrase. Reverse-emit isn't needed (chars are
static during the strike, not scrolling).

**Path generation.** Midpoint-displacement subdivision. Start with
`[cursor, anchor]`, then for `PATH_DEPTH: 5` passes, insert a
perpendicular-jittered midpoint between every adjacent pair. Initial
displacement `BASE_DISPLACEMENT: 60px`, decaying by `DISP_FALLOFF: 0.55`
per pass. Yields a self-similar jagged bolt with ~32 segments.

**Strike envelope** (per bolt):
- `STRIKE_PEAK_MS: 60` — opacity ramps 0→1 (the snap of the bolt
  appearing).
- `STRIKE_HOLD_MS: 80` — full brightness (the channel).
- `STRIKE_DECAY_MS: 380` — linear fade 1→0 (the afterimage).
- Inter-strike gap: `GAP_MS_MIN: 320 + rand(0..1200)` ms.

**Visual treatment.** Bright cream chars (`var(--canvas-fg-strong)`) with
green text-shadow at full bold weight. The shadow gives an electrical
aura at peak; opacity decay carries it away. Each char is rotated to the
tangent of its path segment so the text follows the bolt's bends.

**Path is frozen during the strike.** The bolt's geometry and chars are
captured when `startStrike()` fires and stay fixed for `STRIKE_TOTAL_MS`.
Real lightning bolts have a fixed shape during their brief existence;
re-randomizing per frame would feel like static. The cursor and anchor
ARE re-evaluated only when the *next* strike fires.

**Fixed viewport anchors.** Each marquee has a fixed fraction of the
viewport height for its anchor Y — `ANCHOR_Y_VIEWPORT: [0.10, 0.30, 0.50,
0.70, 0.90]`. Anchors live in screen space, not page space, so they
NEVER converge regardless of scroll position (page-px offsets like 1900
and 4500 both clamped to the bottom-of-viewport edge when the page was
scrolled to the top — visible "two tendrils land on the same spot"
collision). Anchor X always rides the page edge nearest the cursor.

### D8 — Paper realism cues ✅ Shipped 2026-05-01

Three layered effects make the paper read as a physical artifact resting
on the dark mat instead of a white rectangle painted on the dark color.
**All three are load-bearing — do not strip thinking they're decoration.**

1. **Directional shadow.** `--shadow` is three-stop: tight contact line
   (paper meets mat), near drop biased downward (overhead-front light),
   far ambient halo. Negative spread on the bottom two stops keeps the
   paper edge crisp and softens the falloff with distance.
2. **Top-edge highlight.** `.page` adds `inset 0 1px 0 rgba(255,255,255,0.6)`
   above `var(--shadow)`. The 1px white inset reads as a paper edge with
   thickness catching overhead light. Without it the paper looks "drawn,"
   not "placed."
3. **Canvas grain.** `html, body` background is the canvas color plus an
   inline SVG fractal-noise overlay (~600 bytes, no network). Alpha
   capped at 0.04 — felt more than seen. Reads as felt / portfolio mat
   rather than flat paint. At higher alpha it competes with the paper.

## Decisions Log

| Date       | Decision                                  | Rationale                                                                 |
| ---------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| 2026-05-01 | Documented as-built design system         | Codebase had a fully-realized system in `styles.css` with no `DESIGN.md`. |
| 2026-05-01 | Closed drift D1–D5                        | Mechanical fixes — token system now matches intent.                       |
| 2026-05-01 | Type tokens are register-named, not ratio-based | Editorial design rewards half-pixel tuning over modular-scale purity. |
| 2026-05-01 | Accent: brick red → forest green          | Coordinates with the new dark-canvas undertone; matches owner's aesthetic. Dosage held — restraint is the right register for an editorial document. |
| 2026-05-01 | Canvas: cream → deep warm near-black      | Make the cream paper pop. Document voice unchanged; framing now reads as "paper on dark felt portfolio" instead of "cream on cream." |
