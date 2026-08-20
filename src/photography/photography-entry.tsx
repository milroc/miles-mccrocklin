// /photographer entry: mounts Photography into #root. Reads the manifest
// from window.__PHOTOGRAPHY_MANIFEST__ when present (build.ts injects
// it inline per design D3 — zero fetch round trip on first paint). In
// dev (no injection), falls back to fetching the manifest from
// /data/photography-manifest.json (dev.ts serves data/ from disk).

import { createRoot } from 'react-dom/client';
import { Photography } from './Photography';
import type { PhotographyManifest } from '../types';
import '../styles/globals.css';

async function loadManifest(): Promise<PhotographyManifest> {
  if (typeof window !== 'undefined' && window.__PHOTOGRAPHY_MANIFEST__) {
    return window.__PHOTOGRAPHY_MANIFEST__;
  }
  const res = await fetch('/data/photography-manifest.json');
  if (!res.ok) {
    throw new Error(
      `photography-entry: failed to load manifest (${res.status} ${res.statusText})`,
    );
  }
  // SAFETY: this fetches the manifest the build generated from this
  // repo's own data, and the build fails if it can't produce one. A
  // drifted manifest surfaces as a render-time error, not silent
  // corruption of someone else's data.
  return res.json() as Promise<PhotographyManifest>;
}

async function main(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) {
    throw new Error('photography-entry: #root not found');
  }
  const manifest = await loadManifest();
  createRoot(root).render(<Photography manifest={manifest} />);
}

main().catch((err) => {
  console.error(err);
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML =
      '<p style="padding:48px;font-family:Georgia,serif;color:#b8b5ad;background:#1c1f1a;min-height:100vh">' +
      'Photography page failed to load. <a style="color:#ece9e2" href="https://milesmccrocklin.myportfolio.com/">View the catalog on Adobe Portfolio →</a>' +
      '</p>';
  }
});
