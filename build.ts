// Production build.
//
// Builds two HTML entries and emits them at GH-Pages-friendly paths:
//
//   ./index.html           → dist/index.html           (splash)
//   ./long-form/index.html   → dist/long-form/index.html   (long-form page)
//
// `/resume` and `/resume/` are legacy URLs — 404.html handles the
// redirect to `/long-form/` for any inbound links that still use the
// old slug.
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

rmSync('./dist', { recursive: true, force: true });

// Bundle both HTML entries. Bun preserves their relative directory
// structure under outdir, so long-form/index.html lands at dist/long-form/index.html.
const result = await Bun.build({
  entrypoints: [
    './index.html',
    './long-form/index.html',
    './explorer/index.html',
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
cpSync('./data/world-countries-110m.json', './dist/data/world-countries-110m.json');
cpSync('./data/photo-atlas.json', './dist/data/photo-atlas.json');
cpSync('./favicon-32.png', './dist/favicon-32.png');
// Bun content-hashes favicon.svg for any HTML it processes, but 404.html is
// copied as-is below — so it needs an un-hashed copy at the canonical path.
cpSync('./favicon.svg', './dist/favicon.svg');
cpSync('./404.html', './dist/404.html');
writeFileSync('./dist/CNAME', 'miles.mccrockl.in');
writeFileSync('./dist/.nojekyll', '');

// GA injection: walks every emitted .html file (splash + long-form) and
// inserts the GA tag before </head>. Previously hardcoded dist/index.html.
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
    './dist/long-form/index.html',
    './dist/explorer/index.html',
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
