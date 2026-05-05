// Local dev server with HMR.
//
// `bun run dev` boots this. The HTML import is bundled on demand by Bun's
// fullstack server: JSX/TS/CSS get transpiled, JSON imports (resume,
// reviews) are inlined into the bundle, and HMR pushes changes into the
// browser without a full reload.
//
// The fetch fallback serves the project's static asset folders (media/,
// data/) directly from disk so JSON-referenced image/video URLs resolve
// against the dev server. The prod build copies these into dist/ at
// build time — see package.json's "build" script.

import { serve } from "bun";
import index from "./index.html";

const PORT = Number(process.env.PORT ?? 4317);

const server = serve({
  port: PORT,
  routes: {
    "/": index,
  },
  development: {
    // HMR is disabled because Bun's HMR currently invalidates a sibling
    // module's bundler-internal CSS-Modules import (`import_X_module is
    // not defined`) when an unrelated file is hot-reloaded. Full reload
    // is the safe path until Bun fixes the interaction. Tracked here:
    //   https://github.com/oven-sh/bun/issues — CSS Modules + HMR
    hmr: false,
    console: true, // mirror browser console.* into this terminal
  },
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Fallback: serve any path that maps to a real file on disk.
    // Covers /media/**, /data/*, and anything else referenced by string
    // (not by JS import) inside JSON or markup.
    const path = "." + decodeURIComponent(url.pathname);
    const file = Bun.file(path);
    if (await file.exists()) return new Response(file);
    return new Response("not found", { status: 404 });
  },
});

console.log(`dev server → ${server.url}`);
