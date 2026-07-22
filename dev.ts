// Local dev server with HMR.
//
// `bun run dev` boots this. The HTML imports are bundled on demand by
// Bun's fullstack server: JSX/TS/CSS get transpiled, JSON imports
// (resume, reviews, journey) are inlined into the bundle, and HMR
// pushes changes into the browser without a full reload.
//
// Routes match the production build's HTML outputs:
//
//   /                  → splash       (./index.html, mounts splash-entry.tsx)
//   /builder           → builder      (./builder/index.html, mounts builder-entry.tsx)
//   /builder/          → builder      (same)
//   /resume            → resume       (./resume/index.html, mounts main.tsx — the detailed resume)
//   /resume/           → resume       (same)
//   /explorer          → explorer     (./explorer/index.html, mounts explorer-entry.tsx)
//   /explorer/         → explorer     (same)
//   /photographer      → photographer (./photographer/index.html, mounts photography-entry.tsx)
//   /photographer/     → photographer (same)
//
// Legacy + alternative URL slugs 302 to their canonical pillar.
// Production handles the same redirects via 404.html.
//
//   /long-form, /dossier, /about, /work  → /builder/
//   /photography                         → /photographer/
//
// /resume USED to be a legacy redirect to /builder/; now it's a real
// route serving the detailed resume.
//
// The fetch fallback serves the project's static asset folders (media/,
// data/) directly from disk so JSON-referenced image/video URLs resolve
// against the dev server. The prod build copies these into dist/ at
// build time — see build.ts.
//
// Dev/prod divergence note: dev serves source HTML directly. The Person
// JSON-LD schema (injected by build.ts from me.json at build time) is
// NOT present in dev — but it's crawler-only metadata, so nothing visible
// to dev users is missing. To verify schema, run `bun run build` and
// inspect dist/.

import { serve } from "bun";
import splash from "./index.html";
import builder from "./builder/index.html";
import resume from "./resume/index.html";
import explorer from "./explorer/index.html";
import photographer from "./photographer/index.html";
import { buildPhotographyManifest } from "./scripts/build-photography-manifest";
import { buildSplashContent } from "./scripts/build-splash-content";

// Build the photography manifest on dev-server boot so /photographer
// has data to read. The page falls back to fetching
// /data/photography-manifest.json in dev (no inline injection), so this
// primes that file. Sharp variants also build into
// media/portfolio/derived/ on this same call.
//
// Re-runs of `bun run dev` are fast: sharp's mtime cache skips
// already-generated variants. Editing me.json / photography.json /
// photo-atlas.json mid-session requires a dev-server restart for the
// manifest to refresh (acceptable trade-off — these change rarely).
console.log("  building photography manifest...");
await buildPhotographyManifest();

// Regenerate the splash content module (writes
// src/generated/splash-content.ts) so dev matches the prod derivation.
buildSplashContent();

const PORT = Number(process.env.PORT ?? 4317);
// Default to localhost. Set HOST=0.0.0.0 to expose on the LAN for mobile
// testing (then visit http://<your-mac-ip>:<port> from the phone).
const HOST = process.env.HOST ?? "127.0.0.1";

// Legacy slug map: each non-canonical URL fragment redirects to its
// canonical pillar. /long-form is in here too — the page is now
// /builder, /long-form is kept for any inbound links from before the
// rename.
const LEGACY_TO_CANONICAL: Record<string, string> = {
  '/long-form':   '/builder/',
  '/dossier':     '/builder/',
  '/about':       '/builder/',
  '/work':        '/builder/',
  '/photography': '/photographer/',
};
const legacyRouteMap: Record<string, () => Response> = {};
for (const [slug, target] of Object.entries(LEGACY_TO_CANONICAL)) {
  const redirect = (): Response => Response.redirect(target, 302);
  legacyRouteMap[slug] = redirect;
  legacyRouteMap[`${slug}/`] = redirect;
}

const server = serve({
  port: PORT,
  hostname: HOST,
  routes: {
    "/": splash,
    "/builder": builder,
    "/builder/": builder,
    "/resume": resume,
    "/resume/": resume,
    "/explorer": explorer,
    "/explorer/": explorer,
    "/photographer": photographer,
    "/photographer/": photographer,
    ...legacyRouteMap,
  },
  development: {
    // HMR is disabled because Bun's HMR currently invalidates a sibling
    // module's bundler-internal CSS-Modules import (`import_X_module is
    // not defined`) when an unrelated file is hot-reloaded. Full reload
    // is the safe path until Bun fixes the interaction.
    hmr: false,
    console: true, // mirror browser console.* into this terminal
  },
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Fallback: serve any path that maps to a real file on disk.
    // Covers /media/**, /data/*, favicon.svg, and anything else
    // referenced by string (not by JS import) inside JSON or markup.
    const path = "." + decodeURIComponent(url.pathname);
    const file = Bun.file(path);
    if (await file.exists()) return new Response(file);
    return new Response("not found", { status: 404 });
  },
});

// Print the splash URL last on purpose: tools like Conductor scan
// stdout and grab the last URL they see for their "Open" button.
console.log(`  builder       → ${server.url}builder/`);
console.log(`  resume        → ${server.url}resume/ (deep link, noindex)`);
console.log(`  explorer      → ${server.url}explorer/`);
console.log(`  photographer  → ${server.url}photographer/`);
console.log(`  legacy        → /long-form, /dossier, /about, /work → /builder/`);
console.log(`  legacy        → /photography → /photographer/`);
console.log(`dev server → ${server.url}`);
