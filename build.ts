// Production build.
//
// Builds five HTML entries and emits them at GH-Pages-friendly paths:
//
//   ./index.html              → dist/index.html              (splash)
//   ./builder/index.html      → dist/builder/index.html      (public-facing builder page)
//   ./resume/index.html       → dist/resume/index.html       (detailed resume — noindex, deep-link only)
//   ./explorer/index.html     → dist/explorer/index.html     (globe)
//   ./photographer/index.html → dist/photographer/index.html (photo gallery)
//
// The three pillar URLs (/builder/, /photographer/, /explorer/) match
// the splash tile names. /resume/ is the detailed resume that
// /builder/ used to be; it's noindex and not linked from anywhere on
// the site. Legacy slugs — /long-form, /photography, /dossier, /about,
// /work — 404 in prod and the static 404.html runs a small redirect
// script that funnels each to its canonical pillar. (/resume is no
// longer in that legacy map — it's now a real route.)
//
// Splash gets a prerender pass: src/splash/ssr-entry.tsx is bundled,
// its renderToString(<Splash />) markup is injected into
// dist/index.html's #root, and crawlers + no-JS users get the full
// composition (wordmark, tagline, doors, socials, CSS wireframe
// globe) without running JavaScript. The client bundle hydrates and
// mounts the WebGL globe. See the prerender block below for why the
// render must go through the bundler.
//
// Uses Bun's JS bundler API instead of `bun build --minify` because the
// CLI's `--minify` umbrella flag emits a broken JSX-runtime binding
// (`h=void 0`) for our entry, which crashes on first render. Passing
// the granular `minify: { ... }` options to Bun.build() avoids that.

import { rmSync, cpSync, writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMe, buildContext, injectPersonSchema, PERSON_SCHEMA_PATHS } from './scripts/page-meta';
import { buildPhotographyManifest } from './scripts/build-photography-manifest';
import { buildSplashContent } from './scripts/build-splash-content';

rmSync('./dist', { recursive: true, force: true });

// Build the photography manifest FIRST, before bundling. The manifest
// builder is invoked here (not via an npm `prebuild` hook) because bun
// doesn't honor npm pre/post script hooks — see /plan-eng-review D1.
// Builds sharp variants into media/portfolio/derived/ as a side effect;
// cpSync below copies them along with the rest of media/ into dist/.
const photographyManifest = await buildPhotographyManifest();

// Regenerate the splash content module (doors, socials, tagline, stat)
// from data/splash.json + me.json + journey.json — see
// scripts/build-splash-content.ts.
buildSplashContent();

// Bundle all four HTML entries. Bun preserves their relative directory
// structure under outdir, so builder/index.html lands at dist/builder/index.html.
const result = await Bun.build({
  entrypoints: [
    './index.html',
    './builder/index.html',
    './resume/index.html',
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

// Splash prerender. renderToString(<Splash />) must NOT run against
// Bun's runtime module resolution — the runtime loads `*.module.css`
// imports as raw CSS source strings, so every `s.foo` resolves to
// undefined and the markup ships class="undefined" (the failure that
// killed the first SSR pass, commit aa94552). Instead this is option
// (b) from that pass's postmortem: bundle src/splash/ssr-entry.tsx to
// a scratch dir so it gets the BUNDLER's hashed-class-name mapping,
// import the emitted JS, and inject its markup into #root. Bun's
// CSS-Module hashing is deterministic (path + content), so the names
// match the client bundle built above; the parity check below turns
// any future hashing-scheme change into a build failure instead of a
// shipped hydration mismatch + unstyled page.
{
  const ssrOutdir = mkdtempSync(join(tmpdir(), 'splash-ssr-'));
  try {
    const ssr = await Bun.build({
      entrypoints: ['./src/splash/ssr-entry.tsx'],
      outdir: ssrOutdir,
      target: 'bun',
    });
    if (!ssr.success) {
      for (const log of ssr.logs) console.error(log);
      process.exit(1);
    }
    const ssrJs = ssr.outputs.find((o) => o.path.endsWith('.js'));
    if (!ssrJs) {
      console.error('splash prerender failed: no JS output from ssr-entry build');
      process.exit(1);
    }
    // SAFETY: ssrJs is the output of the ssr-entry build two lines up,
    // and src/splash/ssr-entry.tsx exports exactly this function. If it
    // ever stops, the destructure throws here and the build fails.
    const { renderSplash } = (await import(ssrJs.path)) as { renderSplash: () => string };
    const markup = renderSplash();

    // Parity check: every class token the markup references must exist
    // in the client CSS emitted by the main build above.
    const clientCss = result.outputs
      .filter((o) => o.path.endsWith('.css'))
      .map((o) => readFileSync(o.path, 'utf8'))
      .join('\n');
    const classTokens = new Set(
      [...markup.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1]!.split(/\s+/)),
    );
    for (const token of classTokens) {
      if (!clientCss.includes(`.${token}`)) {
        console.error(`splash prerender failed: class "${token}" not found in client CSS — CSS-Module hash drift between the SSR and client builds`);
        process.exit(1);
      }
    }

    const splashHtmlPath = './dist/index.html';
    const html = readFileSync(splashHtmlPath, 'utf8');
    const emptyRoot = '<div id="root"></div>';
    const updated = html.replace(emptyRoot, `<div id="root">${markup}</div>`);
    if (updated === html) {
      console.error(`splash prerender failed: ${emptyRoot} not found in ${splashHtmlPath}`);
      process.exit(1);
    }
    writeFileSync(splashHtmlPath, updated);
    console.log(`  prerendered splash chrome (${markup.length} bytes, ${classTokens.size} class names verified) into ${splashHtmlPath}`);
  } finally {
    rmSync(ssrOutdir, { recursive: true, force: true });
  }
}

// Static asset copies — same as before, plus 404.html now.
cpSync('./media', './dist/media', { recursive: true });
// Globe data fetched at runtime by src/splash/Globe.tsx. Shipped as
// raw JSON (served with application/json) instead of bundled as JS
// modules so dynamic-import MIME-type strictness can't break the
// globe in prod.
cpSync('./data/world-countries-50m.topo.json', './dist/data/world-countries-50m.topo.json');
// world-countries-tile.topo.json is no longer shipped: both globe
// surfaces fetch the 50m set since the 2026-07 splash redesign. The
// tile variant stays in /data (build-world-countries.ts still emits
// it) in case a small-tile surface returns.
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
    './dist/resume/index.html',
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
