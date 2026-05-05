# Open Graph share card

The image people see when `miles.mccrockl.in` is shared on Twitter/X,
Facebook, LinkedIn, Slack, iMessage, etc.

## Files

| File | Purpose |
| --- | --- |
| `scripts/og/og-card.html` | Source. Renders the card at exactly 1200×630 with real Georgia + JetBrains Mono via Google Fonts. |
| `media/og.png` | Built artifact. Shipped to `https://miles.mccrockl.in/media/og.png` by `build.ts` (which copies `media/` → `dist/media/`). |
| `index.html` | Holds the `<meta property="og:*">` and `<meta name="twitter:*">` tags. The `og:image` URL must be **absolute** (`https://…`) — relative paths break crawlers. |

## How to re-render after editing

1. Start the dev server: `bun run dev` (defaults to port 4317).
2. Open `http://localhost:4317/scripts/og/og-card.html` in a browser. It
   renders at exact 1200×630 — what you see is what gets shipped.
3. Re-render to `media/og.png` using a headless browser (any of these works):

   ```sh
   # Option A — Chromium via Playwright (a one-liner if you have it):
   npx playwright screenshot \
     --viewport-size=1200,630 \
     --wait-for-timeout=1500 \
     "http://localhost:4317/scripts/og/og-card.html" \
     media/og.png

   # Option B — gstack browse (if you use it):
   browse viewport 1200x630
   browse goto http://localhost:4317/scripts/og/og-card.html
   browse wait "html[data-fonts=ready]"
   browse screenshot --clip 0,0,1200,630 /tmp/og.png
   cp /tmp/og.png media/og.png
   ```

4. Verify the rendered file is exactly `1200×630`:

   ```sh
   sips -g pixelWidth -g pixelHeight media/og.png
   ```

5. If the tagline / role line / description copy changed, also update the
   four `<meta>` tags in `index.html` so social previews stay in sync:
   - `<meta name="description" content="…">`
   - `<meta property="og:description" content="…">`
   - `<meta name="twitter:description" content="…">`
   - `<meta property="og:image:alt" content="…">` (if the alt copy mentions roles)

6. Commit `media/og.png` + `scripts/og/og-card.html` + `index.html`
   together so the PNG, source, and meta tags don't drift.

7. Push to `main`. The GitHub Pages workflow rebuilds and deploys
   `https://miles.mccrockl.in/media/og.png` within ~2 minutes.

## Validating in the wild

Crawlers cache aggressively. After deploy, re-scrape so changes show up:

- **Twitter/X** — the Card Validator was retired; in practice, post a
  tweet with the URL and Twitter re-fetches automatically. To force a
  refresh, append a cache-buster (`?v=2`) once.
- **Facebook / LinkedIn** — paste the URL into
  https://developers.facebook.com/tools/debug/ and hit "Scrape Again."
  LinkedIn has https://www.linkedin.com/post-inspector/.
- **iMessage / Slack** — both honor `Cache-Control` headers and refetch
  fairly quickly. A new chat thread will pull the latest.

## Design constraints (so future-you doesn't drift)

- **Size:** 1200×630 (the OG / Twitter `summary_large_image` standard).
- **Brand:** Georgia serif (italic for first name + tagline, roman for
  surname), JetBrains Mono for the URL. Cream `#fdfdfb` paper, dark
  canvas `#1c1f1a`, forest-green accent `#3a6b4a`. See `DESIGN.md`.
- **Type lives on the dark mat;** the photo lives on the right and fades
  into the canvas via a radial gradient overlay (no straight edge between
  photo and canvas).
- **Surname uses superscript Mc** (`M<sup>c</sup>Crocklin`), the
  Scottish/Irish editorial convention.
- **Hair has 4–10 px headroom** above the frame top. If you change the
  source photo, retune `background-size` and `background-position` so the
  hair clears the top and the photo's lower-right reflection artifact
  stays cropped.

## Iterating on the design

The folder also contains exploration HTML used to arrive at the locked-in
card (`variant-a.html`, `variant-b.html`, `variant-c.html`,
`variant-d2.html`, `multi-1..4.html`) plus a `contexts.html` that mocks
the card inside Twitter/Facebook/iMessage at platform-accurate sizes.
These are dev-only — not part of the build, not loaded by the site, not
crawled. Feel free to delete them or keep them as a starting point for
the next iteration.
