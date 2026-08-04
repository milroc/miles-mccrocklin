# Design System — Miles McCrocklin Resume

This is the as-built design system extracted from `styles.css`. It documents
the system that exists, not a system to migrate to. Known drift is captured at
the end so future changes either close it or cite a reason.

## Product Context

- **What this is:** A personal resume website that doubles as an editorial
  portfolio. It carries the live resume, embedded UI screenshots from past
  work, photo-essay marginalia, Airbnb host reviews, and a 1-pager mode that
  prints to a single Letter page.
- **Who it's for:** Anyone Miles points at it — friends, collaborators,
  guests, readers. This is a personal site and a home for future
  projects, NOT a job-seeking funnel (owner decision, 2026-07-22).
  Don't optimize copy or layout for recruiter scan patterns.
- **Project type:** Personal site / editorial document / project hub.
- **Memorable thing:** *A resume that respects typography the way a printed
  document does.* Hanging-indent bullets, italic editorial taglines,
  redaction variables with footnote anchors, careful micro-typography
  (kerning, curly punctuation, en-dash ranges). Every design decision
  should serve this.

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
- **Loading:** JetBrains Mono is self-hosted via the
  `@fontsource-variable/jetbrains-mono` npm package, `@import`ed from
  `globals.css` and `splash-globals.css`. Bun's CSS bundler resolves
  through `node_modules` and inlines the woff2 files into the emitted
  CSS chunks at build time — no external CDN. The family is referenced
  as `'JetBrains Mono Variable'` (the name fontsource exports). Georgia
  is system-installed, no network cost.
- **Hierarchy convention:** Section labels are deliberately the *smallest*
  type on the page (~10.5px). Weight (800), tracking (0.36em), and caps do
  the work — size restraint is what creates the editorial hierarchy.
- **Italic register:** Reserved for serif italic at the muted color —
  used for taglines, summaries, locations, and dates. They share one voice
  and recede into the body register; only size separates them.
- **Numerals:** `font-variant-numeric: tabular-nums` and
  `font-feature-settings: "tnum" 1` are declared on dates and metrics,
  but note: Georgia has no tabular figures, so the declarations are
  inert on serif dates (measured: `1111` ≠ `9999` width with tnum
  requested). Georgia's proportional old-style figures are accepted as
  part of the editorial voice; date columns align by right-alignment,
  not digit width. Metric numerals get true tabular behavior from
  JetBrains Mono (monospace, so every figure is tabular by nature).
  The declarations stay as future-proofing if the serif ever changes.

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

Component-local one-offs (left inline, deliberately): the lightbox
nav arrows 26px / close 30px (`MediaProvider.module.css`), the 12px
skills caption (`SkillsCaption.module.css`), and the 12px redaction
tooltip (`KPText.css`). The splash/explorer/photography surfaces run
their own px sizes; the `--fs-*` scale only claims the resume page.

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
| `--canvas-fg-muted`    | `#8a8780`                      | Muted text on canvas (toolbar label). Lightened 2026-08-04 from `#7a7770` (~3.7:1) to clear WCAG AA 4.5:1 at the small mono sizes it carries |
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
| `--accent-soft`    | `rgba(58,107,74,0.10)` | Photography chip/search + reviews highlights |
| `--laurel-gold`    | `#C7A958`              | "Top-5% Superhost" star + rating seal — editorial accent (gold leaf), not a brand quote |

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

Other guest palettes on `:root`, same convention:

- `--guest-claude-*` — the Terminal glass block quotes the Claude Code
  shell (near-black panel, orange brand, hostname yellow, sage-teal
  muted text). See the token comments in `globals.css` for the
  per-value rationale.
- `--guest-linkedin-blue` (`#0a66c2`) / `--guest-instagram-pink`
  (`#e1306c`) — contact-stack icon hover colors; each icon lights up
  with its own identity on intent while the handle text stays on
  `--accent`.

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
- **Shadows:** Four registers.
  - `--shadow` — the paper float (three-stop, see D8).
  - `0 6px 20px rgba(0,0,0,0.16-0.18)` — hover lifts on paper-context
    figures and portraits.
  - `0 30px 80px rgba(0,0,0,0.55)` — lightbox imagery, dark-theater voice.
  - `--canvas-shadow` (`rgba(10, 12, 10, 0.55)`) — every floating surface
    on the dark mat: the photographer filter dropdown and mobile sheet,
    masonry tile hover, the explorer country panel edge and album-cover
    hover. One color derived from the `#0a0c0a` void tone (not neutral
    black — warm shadows on the warm mat); offsets and blur stay
    per-surface because they encode real geometry (dropdowns drop, sheets
    rise, panels slide in from the right). Decided 2026-07-22, replacing
    five ad-hoc `rgba(0,0,0,…)` values.

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
- **Exception — /photographer/ masonry wall.** On the gallery page the
  photography IS the document, not marginalia, so tiles ship full color at
  rest (`contrast(1.02)`) and light up on hover
  (`saturate(1.15) contrast(1.04)`). Documented 2026-07-22 (was
  undocumented drift; the code was right, this file was behind).
- **Terminal glass.** The Claude Code terminal dock keeps its heavy
  frosted-glass surface by owner preference ("it's how I prefer my own
  terminals") — a guest-register exception, like the Airbnb palette.

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

## Splash (globe-anchor composition, 2026-07)

The front page is an asymmetric globe-anchor layout: wordmark + tagline
+ door rows + socials in the left column, a large wireframe-globe hero
(link to /explorer/) on the right. Mobile stacks: header → globe →
doors → socials (~1.6 viewports). Patterns introduced here are system
vocabulary:

- **One label motif.** All three destinations (Explorer's globe label
  included) share the door-row text treatment: dark `--splash-door-bg`
  (`#22261f`) surface,
  mono caps label + italic sublabel, accent mono CTA. The cream
  "placard" chip was tried for the globe and retired 2026-07-22 — it
  outshouted the doors it should rhyme with. (The 2026-05
  frosted-glass chips stay retired too.)
- **Door row.** A compact link row: one tight thumbnail (96×64), mono
  caps label, italic sublabel, always-visible mono CTA in the accent
  color. No hover-only affordances. The list scales to future doors
  (e.g. PROJECTS) without recomposing the page.
- **WireGlobe.** The shared CSS 3D wireframe sphere
  (`src/globe/WireGlobe.tsx`) — the splash hero's base state and
  /explorer/'s loading state. The WebGL globe mounts on every viewport
  (2026-07: the mobile wireframe-only gate read as a loading state that
  never finished); the wireframe remains the pre-canvas base and the
  perf/failure fallback. Stroke alphas are tuned to read as a drawn
  object, not a loading stub; the equator carries the one accent line.
- **Hover language.** Door thumbnails follow the site's documented
  photo treatment: grayscale at rest → color on intent, 240ms ease. No
  blur, no 0ms snaps.
- **Splash stat.** Retired 2026-07: the "N COUNTRIES · 7 CONTINENTS"
  micro-type was dropped from the splash hero (the counts still appear
  in /explorer/'s title plate, derived from the same generated module).

## Naming

Employer naming is register-scoped:

- **Referential surfaces** (splash tagline, share-card badges, LinkedIn
  cover) say **FB / ex-FB** — era-true and terse, matched to the mono
  badge voice.
- **Document surfaces** (/builder/ and /resume/ prose in `data/me.json`)
  say **Meta**, anchored once as "Meta (formerly Facebook)".
- **Product names keep their historical names** (Facebook Creators,
  Forecast) — they shipped under those names.

## Typography Pipeline (removed 2026-07)

Bullets and summaries wrap natively. The Knuth-Plass line breaker +
soft-hyphen pre-processor that previously chose breaks was removed
after instrumented comparison (line-diff, rag depth, widow and river
counts) showed near-zero visible difference from browser wrapping at
this measure; a full justification variant was prototyped and rejected
(stretched spaces read as gaps and rivers). PR #49/#50 hold the
record. Redaction anchors from that pipeline live on in
`src/primitives/RedactedText.tsx` / `.redacted`.

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

2026-07-24: the standalone splash bundle now mirrors the three tokens in
`splash-globals.css` (same names, unprefixed — the `--canvas-shadow`
pattern); a retune must change both roots.

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

### D9 — Lightning strikes (removed 2026-05-08)

Originally shipped as cursor-driven typographic bolts in the dark mat —
each bolt spelled a bio fragment along a jagged path and faded. Removed
because the words flashed too quickly to parse and the effect competed
with the editorial restraint of the rest of the page. No replacement;
the dark mat reads cleaner as a quiet frame.

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
| 2026-07-22 | Audience: hiring partners → personal/project hub | Owner correction during splash design review; copy and layout stop optimizing for recruiters. |
| 2026-07-22 | Splash: globe-anchor redesign             | One visual anchor (WireGlobe hero) instead of three competing collages; placards replace glass chips; doors replace masonry tiles; mobile ships CSS globe only. Full review: ~/.gstack/projects/milroc-miles-mccrocklin/designs/splash-improve-20260721/. |
| 2026-07-22 | Dark-canvas shadows unified on `--canvas-shadow` | Five ad-hoc black shadows on canvas surfaces become one void-derived color (warm, not neutral black); geometry stays per-surface. |
| 2026-08-04 | Canvas-muted lifted to AA (`#7a7770` → `#8a8780`, both roots) | The token only ever carries 10–13px mono labels; ~3.7:1 failed WCAG AA. Hierarchy preserved (still clearly dimmer than `--canvas-fg`). Photography check glyphs move to `--canvas-fg-strong` for the same reason (dark-on-accent was ~2.7:1). |
| 2026-08-04 | Tokenized `--splash-door-bg` (`#22261f`) and `--phone-bezel` (`#0e0e0e`) | Door surface had two magic-value call sites and a roadmap of future doors; phone bezel border now cites `--ink-soft` instead of duplicating it. |
| 2026-08-04 | /builder/ era + job prose moved to roman (`BuilderProse`) | On /builder/ the `.entry-summary` italic IS the body content, five paragraphs deep — the italic register isn't meant for sustained reading. Italic register unchanged everywhere else (/resume/ summaries, builder Summary lede + taglines). Owner-approved. |
