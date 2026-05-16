// Local dev server with HMR.
//
// `bun run dev` boots this. The HTML imports are bundled on demand by
// Bun's fullstack server: JSX/TS/CSS get transpiled, JSON imports
// (resume, reviews, journey) are inlined into the bundle, and HMR
// pushes changes into the browser without a full reload.
//
// Routes match the production build's HTML outputs:
//
//   /              → splash      (./index.html, mounts splash-entry.tsx)
//   /long-form     → long-form   (./long-form/index.html, mounts main.tsx)
//   /long-form/    → long-form   (same)
//   /explorer      → explorer    (./explorer/index.html, mounts explorer-entry.tsx)
//   /explorer/     → explorer    (same)
//
// Legacy + alternative URL slugs all 302 to /long-form/. Production
// handles the same redirects via 404.html.
//
//   /resume, /resume/      → /long-form/  (original legacy slug)
//   /dossier, /dossier/    → /long-form/  (intermediate rename)
//   /about,   /about/      → /long-form/  (alternative)
//   /work,    /work/       → /long-form/  (alternative)
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
import longForm from "./long-form/index.html";
import explorer from "./explorer/index.html";

const PORT = Number(process.env.PORT ?? 4317);
// Default to localhost. Set HOST=0.0.0.0 to expose on the LAN for mobile
// testing (then visit http://<your-mac-ip>:<port> from the phone).
const HOST = process.env.HOST ?? "127.0.0.1";

const longFormRedirect = (): Response =>
  Response.redirect("/long-form/", 302);

// All non-canonical URL slugs that should funnel to /long-form/.
const LEGACY_SLUGS = ['resume', 'dossier', 'about', 'work'] as const;
const legacyRouteMap: Record<string, () => Response> = {};
for (const slug of LEGACY_SLUGS) {
  legacyRouteMap[`/${slug}`] = longFormRedirect;
  legacyRouteMap[`/${slug}/`] = longFormRedirect;
}

const server = serve({
  port: PORT,
  hostname: HOST,
  routes: {
    "/": splash,
    "/long-form": longForm,
    "/long-form/": longForm,
    "/explorer": explorer,
    "/explorer/": explorer,
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
console.log(`  long-form  → ${server.url}long-form/`);
console.log(`  explorer   → ${server.url}explorer/`);
console.log(`  legacy     → /resume, /dossier, /about, /work all 302 → /long-form/`);
console.log(`dev server → ${server.url}`);
