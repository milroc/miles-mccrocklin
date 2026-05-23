# Open Graph share card — /photographer/

The image people see when `miles.mccrockl.in/photographer/` is shared on
Twitter/X, Facebook, LinkedIn, Slack, iMessage, etc. Separate from the
homepage card (`scripts/og/og-card.html` → `media/og.png`) so the
photography URL gets its own visual identity instead of reusing the
portrait card.

## Files

| File | Purpose |
| --- | --- |
| `scripts/og/photographer/photographer-og-card.html` | Source. Fetches `data/photography.json` and packs every photo into a varied-rhythm masonry filling 1200×630, then overlays the type cartouche. |
| `media/photography-og.png` | Built artifact. Shipped to `https://miles.mccrockl.in/media/photography-og.png` by `build.ts` (which copies `media/` → `dist/media/`). |
| `photographer/index.html` | Holds the `<meta property="og:*">` and `<meta name="twitter:*">` tags. Image URLs must be absolute. |

## How to re-render after editing

1. Start the dev server: `bun run dev` (defaults to port 4317).
2. Open `http://localhost:4317/scripts/og/photographer/photographer-og-card.html`.
   It renders at exact 1200×630 — what you see is what gets shipped.
3. Re-render to `media/photography-og.png` using a headless browser:

   ```sh
   # Option A — Chromium via Playwright:
   npx playwright screenshot \
     --viewport-size=1200,630 \
     --wait-for-timeout=2000 \
     "http://localhost:4317/scripts/og/photographer/photographer-og-card.html" \
     media/photography-og.png

   # Option B — gstack browse:
   browse viewport 1200x630
   browse goto http://localhost:4317/scripts/og/photographer/photographer-og-card.html
   browse wait "html[data-fonts=ready]"
   browse screenshot --clip 0,0,1200,630 /tmp/photography-og.png
   cp /tmp/photography-og.png media/photography-og.png
   ```

   The `data-fonts=ready` attribute is set after fonts load AND the first
   ~100 masonry tiles have decoded. Without the wait you get an empty
   canvas — the field is JS-rendered.

4. Verify the rendered file is exactly `1200×630`:

   ```sh
   sips -g pixelWidth -g pixelHeight media/photography-og.png
   ```

5. If the tagline copy changed, update the matching `<meta>` tags in
   `photographer/index.html`:
   - `<meta property="og:image:alt" content="…">`
   - `<meta name="twitter:image:alt" content="…">`
   - `<meta name="description" content="…">` and `og:description` /
     `twitter:description` if the page-level copy is also drifting.

6. Commit `media/photography-og.png` +
   `scripts/og/photographer/photographer-og-card.html` +
   `photographer/index.html` together so the PNG, source, and meta tags
   don't drift.

7. Push to `main`. The GitHub Pages workflow rebuilds and deploys
   `https://miles.mccrockl.in/media/photography-og.png` within ~2 minutes.

## Validating in the wild

Crawlers cache aggressively. After deploy, re-scrape so changes show up:

- **Twitter/X** — post a tweet with the URL and Twitter re-fetches. Force
  a refresh by appending `?v=2` once.
- **Facebook / LinkedIn** — paste into
  https://developers.facebook.com/tools/debug/ and hit "Scrape Again."
  LinkedIn: https://www.linkedin.com/post-inspector/.
- **iMessage / Slack** — both honor `Cache-Control` headers. A new
  thread pulls the latest.

## Design constraints (so future-you doesn't drift)

- **Size:** 1200×630 (the OG / Twitter `summary_large_image` standard).
- **Brand:** Georgia serif (italic for first name, roman for surname),
  JetBrains Mono for the eyebrow. Dark canvas `#1c1f1a`, cream `#fdfdfb`,
  forest-green accent `#3a6b4a`. See `DESIGN.md`.
- **Backdrop:** every photo in `data/photography.json` packed into
  justified rows of varied target heights (`170, 70, 110, 55, 145, 90,
  60, 130`) so the field reads as both "a body of work" and "a textured
  pattern." Tile order is seeded-deterministic — the same seed always
  produces the same crop, so the PNG is reproducible across re-renders.
- **Type plate:** a tight inner radial gradient under the cartouche
  isolates the type from the photo field without dimming the corners.
- **Surname uses superscript Mc** (`M<sup>c</sup>Crocklin`), the
  Scottish/Irish editorial convention. Matches the homepage card.

## Iterating on the design

Tunable knobs in `photographer-og-card.html`:

- `RH_CYCLE` — row-height target sequence. Longer/shorter for taller or
  shorter rows. Larger spread = more visual rhythm.
- `GAP` — gutter between tiles. 2px is the current setting; 1px reads
  denser, 4px reads more grid-like.
- The seed in `let seed = 7777` — reroll for a different crop.
- The veil's first radial gradient controls the type-plate dimness.
- `MIN_ASPECT` / `MAX_ASPECT` — clamps that prevent very tall portraits
  or very wide panoramas from breaking row math.

Keep the brand color tokens and font stack in sync with
`scripts/og/og-card.html` so the two cards read as a system.
