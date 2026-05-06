# LinkedIn cover banner

The image at the top of `https://www.linkedin.com/in/miles-mccrocklin-7b635127/`,
sized to LinkedIn's 1584×396 personal-profile cover.

## Files

| File | Purpose |
| --- | --- |
| `scripts/linkedin-cover/cover.html` | Source. Renders the locked-in cover at exactly 1584×396 with real Georgia + JetBrains Mono via Google Fonts. Photos pulled from `media/` via the `CONFIG.photos` array. |
| `scripts/linkedin-cover/builder.html` | Dev-only. Interactive layout designer — pick a structure (Editorial Strip / Justified Gallery / Hero + Marginalia / Era Bands), choose photos from the full media library, weight their sizes (S/M/L/XL), drag-drop to reorder, reorder era bands. Click *Copy config* to dump JSON, paste into `cover.html`'s `CONFIG.photos`. |
| `scripts/linkedin-cover/cropper.html` | Dev-only. Single-photo cropper with drag-pan + scroll-wheel zoom + per-photo caption editing. Used if you want a one-photo cover variant later. |
| `media/linkedin-cover.png` | Built artifact. 1584×396. Uploaded directly to LinkedIn via *Edit profile background photo*. |

## How to re-render after editing

1. Start the dev server: `bun run dev` (defaults to port 4317).
2. Open `http://localhost:4317/scripts/linkedin-cover/cover.html` in a browser. It
   renders at exact 1584×396 — what you see is what gets shipped.
3. Re-render to `media/linkedin-cover.png` using a headless browser:

   ```sh
   # Option A — Chromium via Playwright (a one-liner if you have it):
   npx playwright screenshot \
     --viewport-size=1584,396 \
     --wait-for-timeout=3000 \
     "http://localhost:4317/scripts/linkedin-cover/cover.html" \
     media/linkedin-cover.png

   # Option B — gstack browse:
   browse viewport 1584x396
   browse goto "http://localhost:4317/scripts/linkedin-cover/cover.html"
   browse wait --networkidle
   sleep 3   # let images load + DOM ready flag flip
   browse screenshot --viewport /tmp/linkedin-cover.png
   cp /tmp/linkedin-cover.png media/linkedin-cover.png
   ```

4. Verify the rendered file is exactly `1584×396`:

   ```sh
   sips -g pixelWidth -g pixelHeight media/linkedin-cover.png
   ```

5. Upload to LinkedIn: profile → camera icon on the cover → *Edit profile
   background photo* → upload `media/linkedin-cover.png`.

## How to redesign

Open `scripts/linkedin-cover/builder.html` in a browser. The page loads
into the current locked-in arrangement (the same one in `cover.html`'s
`CONFIG`). From there:

- Switch layout structure via the four cards at the top.
- Click photos in the grid to include / exclude. Drag-drop included
  photos to reorder. Right-click a photo to bump it to the front.
- Click `S` / `M` / `L` / `XL` to weight a photo's size — XL takes
  ~3× the horizontal real estate of S in the layout.
- For Era Bands, the chip row above the grid lets you reorder the
  band stack (top to bottom). Each chip carries `↑` / `↓` arrows.
- Click *Copy config* — the JSON goes to your clipboard. Paste it
  into `cover.html`'s `CONFIG.photos` array. (You'll need to fill
  in the `era` field on each photo — `Meta`, `Sabbatical`,
  `Community`, or `Bluenose` — since the builder's config export
  doesn't include it. Era is needed only if you're shipping the
  Era Bands layout.)

## Adding new photos

Drop the file into the appropriate `media/` subdirectory, then add
an entry to two places:

- `scripts/linkedin-cover/builder.html` — the `PHOTOS` array. Provide
  `src`, `name`, `cat` (one of `travel`, `summary`, `meta`, `bluenose`,
  `community`), and `era` (one of `Sabbatical`, `Meta`, `Community`,
  `Bluenose`).
- `scripts/linkedin-cover/cropper.html` — the `PHOTOS` array. Same
  fields plus an optional `cap` object with default eyebrow/lede
  caption text per photo.

The two arrays drift apart if you only update one — keep them in sync.

## Design constraints (so future-you doesn't drift)

- **Size:** 1584×396 (LinkedIn personal-profile cover, 4:1).
- **Profile circle blast zone:** bottom-left ~155px circle, anchored
  ~30px from the left edge, bottom-half overlaps the cover. Compositions
  must clear this zone — `cover.html` uses a soft radial vignette
  (`radial-gradient at 12% 100%`) to tone down the photos there.
- **Brand voice from `media/og.png`:**
  - **Eyebrow** (mono, uppercase, letter-spacing 0.36em): *Builder
    (ex-FB) · Explorer · Photographer*
  - **Tagline** (Georgia italic, paper-cream `#fdfdfb`): *Building
    for humans / in an agentic world.* (explicit `<br>` after
    "humans" — the natural wrap orphans "world." otherwise.)
- **Brand:** Georgia serif (italic for the tagline), JetBrains Mono
  for the role line. Cream `#fdfdfb` paper-white text, dark canvas
  `#1c1f1a`. **No forest-green hairline rule** under the role line —
  removed from the cover; reserved for the resume site only.
- **Photography filter:** `grayscale(0.18) contrast(1.02)` — the
  editorial filter from `DESIGN.md` so the photo wall reads as one
  curated artifact, not a vacation slideshow.
- **Right-edge scrim:** linear gradient ramping from transparent at
  38% to `0.92` opacity at the right edge — strong enough to make
  the cream text legible against any photo, soft enough that the
  rightmost photos still feel "in" the composition.
- **Text shadows:** stacked at three layers (2px tight + 6–8px body
  + 14–40px halo) so the type stays sharp on dense photo backgrounds.

## Iterating on the design

The folder also contains exploration HTML used to arrive at the
locked-in cover. The exploration variants (lightning fan, type-only
plate, single-photo with caption, justified gallery without era
bands) live in `.context/linkedin-cover/` — gitignored, dev-only,
not part of the build. Feel free to delete them or keep them as a
starting point for the next iteration.
