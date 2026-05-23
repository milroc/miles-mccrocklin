// Production build.
//
// Builds four HTML entries and emits them at GH-Pages-friendly paths:
//
//   ./index.html              → dist/index.html              (splash)
//   ./builder/index.html      → dist/builder/index.html      (long-form / resume)
//   ./explorer/index.html     → dist/explorer/index.html     (globe)
//   ./photographer/index.html → dist/photographer/index.html (photo gallery)
//
// The three pillar URLs (/builder/, /photographer/, /explorer/) match
// the splash tile names. Legacy slugs — /long-form, /photography,
// /resume, /dossier, /about, /work — 404 in prod and the static
// 404.html runs a small redirect script that funnels each to its
// canonical pillar.
//
// Splash gets an SSR pass: src/splash/Splash.tsx is renderToString()'d
// and the resulting markup is injected into dist/index.html so crawlers
// + no-JS users see the full composition (wordmark, tiles, CTA, role
// labels) without running JavaScript. The client bundle hydrates and
// runs the reveal effect.
//
// Uses Bun's JS bundler API instead of `bun build --minify` because the
// CLI's `--minify` umbrella flag emits a broken JSX-runtime binding
// (`h=void 0`) for our entry, which crashes on first render. Passing
// the granular `minify: { ... }` options to Bun.build() avoids that.

import { rmSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { loadMe, buildContext, injectPersonSchema, PERSON_SCHEMA_PATHS } from './scripts/page-meta';
import { buildPhotographyManifest } from './scripts/build-photography-manifest';

rmSync('./dist', { recursive: true, force: true });

// Build the photography manifest FIRST, before bundling. The manifest
// builder is invoked here (not via an npm `prebuild` hook) because bun
// doesn't honor npm pre/post script hooks — see /plan-eng-review D1.
// Builds sharp variants into media/portfolio/derived/ as a side effect;
// cpSync below copies them along with the rest of media/ into dist/.
const photographyManifest = await buildPhotographyManifest();

// Bundle all four HTML entries. Bun preserves their relative directory
// structure under outdir, so builder/index.html lands at dist/builder/index.html.
const result = await Bun.build({
  entrypoints: [
    './index.html',
    './builder/index.html',
    './explorer/index.html',
    './photographer/index.html',
  ],
  outdir: './dist',
  minify: { whitespace: true, identifiers: true, syntax: true },
  sourcemap: 'linked',
  splitting: true,  // dedupe shared chunks across the two entries
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// SSR injection used to live here — renderToString(<Splash />) into the
// empty <div id="root"></div>. It's been removed because Bun's RUNTIME
// (which executes this script directly) loads `*.module.css` imports as
// the raw CSS source string rather than the hashed-class-name mapping
// that the Bun BUNDLER produces in the emitted JS chunks. So when the
// SSR pass evaluated `s.root`, `s.tile`, etc., every key resolved to
// undefined, and the rendered HTML shipped class="undefined undefined"
// strings everywhere. The client bundle still works (the bundler maps
// names correctly there) — the splash just hydrates from an empty
// root and paints once JS runs.
//
// Tradeoff: crawlers + no-JS visitors no longer see the splash chrome
// inline. The OG/Twitter meta tags + page title carry the SEO; no-JS
// browsers see a blank dark canvas. Acceptable for a personal site.
// To restore SSR cleanly we'd need to either (a) build a CSS-Module
// hash manifest from the emitted CSS and inject it before
// renderToString, or (b) move the SSR call into a bundler entrypoint
// so it gets the same module resolution as the client.

// Static asset copies — same as before, plus 404.html now.
cpSync('./media', './dist/media', { recursive: true });
// Globe data fetched at runtime by src/splash/Globe.tsx. Shipped as
// raw JSON (served with application/json) instead of bundled as JS
// modules so dynamic-import MIME-type strictness can't break the
// globe in prod.
cpSync('./data/world-countries-50m.topo.json', './dist/data/world-countries-50m.topo.json');
cpSync('./data/world-countries-tile.topo.json', './dist/data/world-countries-tile.topo.json');
cpSync('./data/photo-atlas.json', './dist/data/photo-atlas.json');
// Photography manifest is inlined into dist/photographer/index.html below
// for zero-fetch first paint, but we also ship it as a static JSON so the
// /photographer page has a sane fetch fallback if the inline script ever
// fails to parse (defensive — should never trigger in practice).
cpSync('./data/photography-manifest.json', './dist/data/photography-manifest.json');
cpSync('./favicon-32.png', './dist/favicon-32.png');
// Bun content-hashes favicon.svg for any HTML it processes, but 404.html is
// copied as-is below — so it needs an un-hashed copy at the canonical path.
cpSync('./favicon.svg', './dist/favicon.svg');
cpSync('./404.html', './dist/404.html');
cpSync('./robots.txt', './dist/robots.txt');
cpSync('./sitemap.xml', './dist/sitemap.xml');
writeFileSync('./dist/CNAME', 'miles.mccrockl.in');
writeFileSync('./dist/.nojekyll', '');

// Photography manifest inline injection. Same template-injection pattern
// as Person JSON-LD below: write the manifest as a window global before
// </head> so the /photographer page boots with data already in memory
// (zero fetch round trip on first paint — design D3).
//
// JSON.stringify is XSS-safe here because the manifest contains only
// trusted build-time data (paths under media/, our own captions, our own
// Adobe URLs). Escape </script> regardless as a hard rule — defense in
// depth in case a curator ever pastes user-provided text into a caption.
const photographyHtmlPath = './dist/photographer/index.html';
{
  const html = readFileSync(photographyHtmlPath, 'utf8');
  const safeJson = JSON.stringify(photographyManifest).replace(/<\/script/gi, '<\\/script');
  const snippet =
    `<script>window.__PHOTOGRAPHY_MANIFEST__=${safeJson}</script>`;
  const updated = html.replace('</head>', `${snippet}</head>`);
  if (updated === html) {
    console.error(`photography manifest injection failed: </head> not found in ${photographyHtmlPath}`);
    process.exit(1);
  }
  writeFileSync(photographyHtmlPath, updated);
  console.log(`  injected photography manifest (${photographyManifest.photos.length} photos) into ${photographyHtmlPath}`);
}

// JSON-LD Person schema injection. The only piece of <head> content
// we inject at build time, because its sameAs/name/image fields all
// derive from data/me.json — hardcoding it in the HTML would silently
// drift on the next me.json edit. All other metadata (OG/Twitter,
// favicons) lives literally in each page's source HTML.
//
// dev.ts intentionally does NOT inject this — Person schema is crawler-
// only metadata that dev users never see. Verify locally with
// `bun run build && grep ld+json dist/index.html` or Google's Rich
// Results Test against the deployed URL.
const ctx = buildContext(loadMe());
for (const pathSegment of PERSON_SCHEMA_PATHS) {
  const distPath = `./dist/${pathSegment}index.html`;
  const html = readFileSync(distPath, 'utf8');
  writeFileSync(distPath, injectPersonSchema(html, ctx));
}
console.log(`  injected Person JSON-LD into ${PERSON_SCHEMA_PATHS.length} HTML files`);

// GA injection: walks every emitted .html file (splash + the three
// pillars) and inserts the GA tag before </head>. Previously hardcoded
// dist/index.html.
const gaId = process.env.GA_MEASUREMENT_ID;
if (gaId) {
  if (!/^G-[A-Z0-9]{4,20}$/.test(gaId)) {
    console.error(`GA_MEASUREMENT_ID has unexpected format: ${gaId}`);
    process.exit(1);
  }
  const snippet =
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script>` +
    `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}` +
    `gtag('js',new Date());gtag('config','${gaId}')</script>`;
  const htmlPaths = [
    './dist/index.html',
    './dist/builder/index.html',
    './dist/explorer/index.html',
    './dist/photographer/index.html',
  ];
  for (const p of htmlPaths) {
    const html = readFileSync(p, 'utf8');
    const updated = html.replace('</head>', `${snippet}</head>`);
    if (updated === html) {
      console.error(`GA injection failed: </head> not found in ${p}`);
      process.exit(1);
    }
    writeFileSync(p, updated);
  }
  console.log(`  injected GA tag (${gaId}) into ${htmlPaths.length} HTML files`);
}

for (const out of result.outputs) {
  console.log('  ' + out.path.replace(process.cwd() + '/', ''));
}
