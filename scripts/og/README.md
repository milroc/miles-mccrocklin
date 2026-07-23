# Open Graph share card

The image people see when `miles.mccrockl.in` is shared on Twitter/X,
Facebook, LinkedIn, Slack, iMessage, etc.

## Files

| File | Purpose |
| --- | --- |
| `scripts/og/og-card.html` | Source for the default site card. Renders at 1200×630 with real Georgia + JetBrains Mono via Google Fonts. |
| `media/og.png` | Built artifact for the default site card. Shipped to `https://miles.mccrockl.in/media/og.png` by `build.ts` (copies `media/` → `dist/media/`). |
| `scripts/og/explorer/variant-b.html` | Source for the **explorer-specific still card**. Composites a posed globe screenshot (`globe-hero.png`) with the editorial type stack. |
| `scripts/og/explorer/variant-b-overlay.html` | Same as `variant-b.html` but with a transparent background. Rendered once to a PNG and overlaid on every video frame so the type stack stays static while the globe animates. |
| `scripts/og/explorer/globe-hero.png` | Posed screenshot of the live `/explorer/` globe, captured via Playwright (see "Per-page cards" below). |
| `media/explorer-og.png` | Built artifact for `/explorer/` (still card). Shipped to `https://miles.mccrockl.in/media/explorer-og.png`. |
| `media/explorer-og.mp4` | Built artifact for `/explorer/` (animated card). 1200×630, 3s loop at 30fps, ~600KB. Shipped to `https://miles.mccrockl.in/media/explorer-og.mp4` and referenced via `og:video` on the explorer page. Facebook/Discord auto-play it; all other platforms ignore the `og:video` tags and fall back to the still PNG above. |
| `media/explorer-og.gif` | Side artifact (NOT referenced from any `<meta>` tag). 800×420, 3s loop at 12fps, ~2.3MB. Available at `https://miles.mccrockl.in/media/explorer-og.gif` for manual use — drop into a tweet, Discord chat, or blog embed when you want the animation without the platform's auto-unfurl. Excluded from `og:image` deliberately: swapping the still PNG for an animated GIF degrades the first-frame preview on LinkedIn/iMessage/WhatsApp/Twitter, which don't animate `og:image` GIFs reliably. |
| `index.html` | Holds the default `<meta property="og:*">` / `<meta name="twitter:*">` tags. URL must be **absolute** — relative paths break crawlers. |
| `explorer/index.html` | Holds the explorer-specific OG / Twitter tags pointing at `explorer-og.png`. |

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

## Per-page cards (the `/explorer/` pipeline)

`/explorer/` ships its own OG image because its primary topic is the
interactive globe, not the person. Same render flow as the default card,
plus a screenshot pose step.

1. Start the dev server: `bun run dev`.
2. Pose the globe and capture it. The globe is WebGL, so headless
   Chromium needs hardware-accelerated rendering. Playwright works:

   ```sh
   # one-shot — captures the current default Americas-facing pose
   npx playwright screenshot \
     --viewport-size=2400,1260 \
     --wait-for-timeout=5000 \
     "http://localhost:4317/explorer/" \
     scripts/og/explorer/globe-hero.png
   ```

   For specific poses (Europe-visible, tilted, etc.), use a short
   Playwright script that drags the canvas — the captured `pose-*.js`
   helpers in this repo's history (search the design session at
   `~/.gstack/projects/$SLUG/designs/explorer-og-*/`) are a starting
   point. The 90-arc animation cycles every 6s, so capture a burst
   (8–12 frames at ~600ms intervals) and pick the densest by file size
   — that's a good proxy for "more arcs visible right now."

3. Re-render the card to `media/explorer-og.png`:

   ```sh
   npx playwright screenshot \
     --viewport-size=1200,630 \
     --wait-for-timeout=1500 \
     "http://localhost:4317/scripts/og/explorer/variant-b.html" \
     media/explorer-og.png
   ```

   The card HTML references `./globe-hero.png` relatively, so as long
   as both files sit in `scripts/og/explorer/` the dev server resolves
   them correctly.

4. Verify dimensions:

   ```sh
   sips -g pixelWidth -g pixelHeight media/explorer-og.png
   # expect: pixelWidth: 1200 / pixelHeight: 630
   ```

   If Playwright captured at 2x (deviceScaleFactor: 2), `sips -z 630 1200`
   downscales to spec.

5. The explorer's `<meta>` tags live in `explorer/index.html` and point
   at the absolute URL `https://miles.mccrockl.in/media/explorer-og.png`.
   No edits there unless the URL or alt text changes.

### Re-rendering the animated card (`explorer-og.mp4`)

The MP4 is a composite of two captures:

1. **Live globe video** — Playwright records 6s of `/explorer/` with
   chrome stripped (saved as `.webm` at 2400×1260).
2. **Type overlay** — A one-shot screenshot of `variant-b-overlay.html`
   at 1200×630 with a transparent background (rendered with
   `omitBackground: true`).
3. **ffmpeg composite + 2x speedup** — Trims the last 6s of the webm
   (Playwright records the whole context lifetime), scales/crops to
   1200×630 to match the still card's globe placement, applies
   `setpts=0.5*PTS` to halve the duration, and overlays the type PNG on
   every frame. Output: ~600KB H.264 MP4, 3s loop, 30fps.

Concrete pipeline (run from the repo root with the dev server up):

```sh
# 1. Capture 6s of the live globe (Playwright script in design session history;
#    see ~/.gstack/projects/$SLUG/designs/explorer-og-*/ for reference scripts).

# 2. Render the type overlay once (variant-b-overlay.html → overlay.png, transparent BG).

# 3. ffmpeg composite + 2x speed + crop to globe-right placement:
ffmpeg -y -ss 20 -i /tmp/globe-recording.webm -t 6 \
  -i /tmp/overlay.png \
  -filter_complex "[0:v]scale=1700:-1,crop=1200:630:153:131,setpts=0.5*PTS[bg];[bg][1:v]overlay=0:0" \
  -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart -r 30 \
  media/explorer-og.mp4
```

If you want a different speedup, change the `setpts` multiplier:
`0.5*PTS` = 2x faster, `0.33*PTS` = 3x faster, `1.0*PTS` = real-time.

### The GIF side artifact (`explorer-og.gif`)

`media/explorer-og.gif` is 800×420 / 12fps / 2.3MB. It's NOT referenced
from any `<meta>` tag — it ships as a static file you can link to
manually.

Why not as `og:image`: GIF-as-og:image only auto-animates on Slack (and
only under ~1MB) and inconsistently on Twitter. Every other major
platform (LinkedIn, iMessage, WhatsApp, Facebook feed previews) shows
the first frame, which would be a palette-quantized version of the PNG
we already ship as the still card — strictly worse. Trading global
still-card quality for one platform's animation isn't worth it for a
portfolio site.

When the GIF IS useful: tweet uploads (Twitter animates GIFs uploaded
via media API even when it won't animate them via `og:image`), Discord
drag-drops, blog post embeds, or any context where you're sharing the
animation directly rather than via unfurl.

To re-render the GIF after a new MP4 capture:

```sh
# 800×420 / 12fps / full palette — the highest-quality variant under ~3MB
ffmpeg -y -i media/explorer-og.mp4 \
  -vf "fps=12,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
  -loop 0 media/explorer-og.gif
```

For smaller (sub-1MB) variants — useful if you want a Slack-friendly
version for manual embedding — drop to 600px wide, 12fps, max_colors=64:

```sh
ffmpeg -y -i media/explorer-og.mp4 \
  -vf "fps=12,scale=600:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" \
  -loop 0 media/explorer-og-small.gif
```

### Why no animated WebP

The system ffmpeg (homebrew default) ships without the libwebp encoder,
so animated WebP would need a `brew install ffmpeg --with-webp` rebuild
or a separate `cwebp` install. Skipped for now — the MP4 covers the
animation use case and the GIF covers the manual-share use case.

## Iterating on the default card

The exploration HTML used to arrive at the locked-in cards has been
deleted; the surviving sources are `og-card.html` (default card),
`explorer/variant-b.html` + `explorer/variant-b-overlay.html` (explorer
card), and `photographer/photographer-og-card.html`. To iterate, copy
the relevant card to a scratch variant, tweak, re-render per the steps
above, and delete the scratch file when done — exploration variants are
dev-only and shouldn't accumulate in the tree.
