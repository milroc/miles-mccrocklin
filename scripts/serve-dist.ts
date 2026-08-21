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
import { readdir } from 'node:fs/promises';
import { join, normalize, relative, sep } from 'node:path';

const ROOT = join(import.meta.dir, '..', 'dist');
const PORT = Number(process.env.PORT ?? 4318);
const HOST = process.env.HOST ?? '127.0.0.1';

// Resolve a request path to a file inside dist/, or null.
//
// Two things this has to get right to match Pages rather than the local
// filesystem:
//
//   - Traversal. Any path that escapes dist/ once normalized is refused.
//   - Case. APFS is case-insensitive, so `Bun.file('dist/Builder/
//     index.html').exists()` answers true for a directory actually named
//     `builder` — while Pages, on a case-sensitive filesystem, 404s it
//     into the client-side redirect table. Without the segment check
//     below, a case-sensitivity bug would pass locally, pass in CI on
//     ext4, and only show up in production.
async function existsExact(abs: string): Promise<boolean> {
  if (!(await Bun.file(abs).exists())) return false;
  let current = ROOT;
  for (const segment of relative(ROOT, abs).split(sep)) {
    const names = await readdir(current);
    if (!names.includes(segment)) return false;
    current = join(current, segment);
  }
  return true;
}

async function resolve(pathname: string): Promise<string | null> {
  const decoded = decodeURIComponent(pathname);
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const candidates = rel.endsWith('/')
    ? [join(rel, 'index.html')]
    : [rel, join(rel, 'index.html')];
  for (const candidate of candidates) {
    const abs = join(ROOT, candidate);
    const inside = relative(ROOT, abs);
    if (inside.startsWith('..') || inside === '') continue;
    if (await existsExact(abs)) return abs;
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
