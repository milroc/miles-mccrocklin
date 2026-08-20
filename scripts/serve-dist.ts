// Static server for dist/, matching how GitHub Pages serves this site.
//
// The e2e suite runs against the real build artifact, not the dev
// server, because that is what ships: prerendered splash markup, the
// inlined photography manifest, hashed asset URLs, and EDIT_ENABLED
// compiled to false. Only the edit-mode specs need dev, and they get
// their own Playwright project pointed at `bun run dev`.
//
// Pages semantics this reproduces:
//   /foo/    → dist/foo/index.html
//   /foo     → dist/foo/index.html   (Pages serves the directory)
//   missing  → dist/404.html with status 404 (which then runs the
//              client-side legacy-slug redirects in that file)
//
// Not a general-purpose server. `bun run scripts/serve-dist.ts`.
import { serve } from 'bun';
import { join, normalize } from 'node:path';

const ROOT = join(import.meta.dir, '..', 'dist');
const PORT = Number(process.env.PORT ?? 4318);
const HOST = process.env.HOST ?? '127.0.0.1';

// Resolve a request path to a file inside dist/, or null. Rejects any
// path that escapes the root once normalized.
async function resolve(pathname: string): Promise<string | null> {
  const decoded = decodeURIComponent(pathname);
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const candidates = rel.endsWith('/')
    ? [join(rel, 'index.html')]
    : [rel, join(rel, 'index.html')];
  for (const candidate of candidates) {
    const abs = join(ROOT, candidate);
    if (!abs.startsWith(ROOT)) continue;
    if (await Bun.file(abs).exists()) return abs;
  }
  return null;
}

const server = serve({
  port: PORT,
  hostname: HOST,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const hit = await resolve(url.pathname === '/' ? '/index.html' : url.pathname);
    if (hit) return new Response(Bun.file(hit));
    const notFound = Bun.file(join(ROOT, '404.html'));
    if (await notFound.exists()) {
      return new Response(notFound, {
        status: 404,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    return new Response('not found', { status: 404 });
  },
});

console.log(`dist server → ${server.url}`);
