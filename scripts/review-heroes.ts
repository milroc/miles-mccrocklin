// Review-and-pick hero photos across countries that have multiple
// candidates in the build-photo-atlas manifest.
//
// Generates a single static HTML contact sheet at
// .context/hero-review.html. One section per multi-candidate country;
// every candidate appears as a thumbnail with the current hero
// outlined in forest green. Click any thumbnail to mark it as your
// new pick (cream outline). Click the floating "Download picks.json"
// button to save your selections — paste that JSON back to whoever
// edits the manifest.
//
// Usage:
//   bun run scripts/review-heroes.ts
//   open .context/hero-review.html

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MANIFEST, buildIndexCoverMap, type Entry, type AlbumRef, type LocalImageRef } from './build-photo-atlas';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT_PATH = join(ROOT, '.context/hero-review.html');

interface Candidate {
  // Identifier the user's JSON output echoes back. Album candidates
  // use the portfolio album URL; local-image candidates use the
  // project-relative file path. Both are unique within a country and
  // map cleanly to manifest fields.
  id: string;
  title: string;
  // Image URL to display in the <img>. For albums this is the
  // portfolio CDN cover URL (network-hosted); for locals it's a
  // path relative to .context/ so the browser can load it.
  src: string;
  // 'portfolio' | 'local' — shown as a small caption.
  source: 'portfolio' | 'local';
  // True for the candidate that's currently the country's hero.
  isCurrent: boolean;
}

function entryCandidates(entry: Entry, coverByUrl: Map<string, string>): Candidate[] {
  const out: Candidate[] = [];

  // Local-image hero (if present).
  if (entry.local_image) {
    out.push({
      id: entry.local_image.path,
      title: entry.local_image.title,
      src: `../${entry.local_image.path}`,
      source: 'local',
      isCurrent: true,
    });
  }
  // Primary-album hero (if no local_image, this is the current hero;
  // if both are set the local wins, so primary lives as a candidate).
  if (entry.primary_album) {
    const cover = coverByUrl.get(entry.primary_album.url);
    if (!cover) {
      console.warn(`  no cover URL for primary album ${entry.primary_album.url}`);
    } else {
      out.push({
        id: entry.primary_album.url,
        title: entry.primary_album.title,
        src: cover,
        source: 'portfolio',
        isCurrent: !entry.local_image,
      });
    }
  }
  // Secondary albums (paper trail).
  for (const album of entry.secondary_albums ?? []) {
    const cover = coverByUrl.get(album.url);
    if (!cover) {
      console.warn(`  no cover URL for secondary album ${album.url}`);
      continue;
    }
    out.push({
      id: album.url,
      title: album.title,
      src: cover,
      source: 'portfolio',
      isCurrent: false,
    });
  }
  // Secondary local images (paper trail).
  if ('secondary_local_images' in entry) {
    for (const img of entry.secondary_local_images ?? []) {
      out.push({
        id: img.path,
        title: img.title,
        src: `../${img.path}`,
        source: 'local',
        isCurrent: false,
      });
    }
  }

  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderCandidate(c: Candidate): string {
  return `<label class="candidate ${c.isCurrent ? 'current' : ''}">
    <input type="radio" name="${escapeHtml(`pick-${c.id}`)}" value="${escapeHtml(c.id)}" ${c.isCurrent ? 'checked' : ''}>
    <img loading="lazy" src="${escapeHtml(c.src)}" alt="${escapeHtml(c.title)}">
    <div class="title">${escapeHtml(c.title)}${c.isCurrent ? ' <span class="badge">CURRENT HERO</span>' : ''}</div>
    <div class="meta">${c.source} · <code>${escapeHtml(c.id)}</code></div>
  </label>`;
}

function renderCountrySection(country: string, kind: string, candidates: Candidate[]): string {
  const radios = candidates.map((c) => `
    <label class="candidate" data-current="${c.isCurrent}">
      <input type="radio" name="country:${escapeHtml(country)}" value="${escapeHtml(c.id)}" ${c.isCurrent ? 'checked' : ''}>
      <img loading="lazy" src="${escapeHtml(c.src)}" alt="${escapeHtml(c.title)}">
      <div class="title">${escapeHtml(c.title)}${c.isCurrent ? ' <span class="badge">CURRENT</span>' : ''}</div>
      <div class="meta">${c.source} · <code>${escapeHtml(c.id)}</code></div>
    </label>
  `).join('');

  return `
    <section class="country" data-country="${escapeHtml(country)}">
      <h2>${escapeHtml(country)} <small>(${kind} · ${candidates.length} candidates)</small></h2>
      <div class="candidates">
        ${radios}
      </div>
    </section>
  `;
}

function buildHtml(sections: string[], currentPicks: Record<string, string>): string {
  const initialPicksJson = JSON.stringify(currentPicks, null, 2);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Hero photo review — pick one per country</title>
<style>
  :root {
    --canvas: #1c1f1a;
    --canvas-fg: #b8b5ad;
    --canvas-fg-strong: #ece9e2;
    --canvas-fg-muted: #7a7770;
    --canvas-rule: rgba(236, 233, 226, 0.20);
    --accent: #3a6b4a;
  }
  * { box-sizing: border-box; }
  body {
    background: var(--canvas);
    color: var(--canvas-fg);
    font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    margin: 0;
    padding: 24px 32px 96px;
    font-size: 13px;
    line-height: 1.5;
  }
  h1 {
    font-family: Georgia, 'Times New Roman', serif;
    font-style: italic;
    color: var(--canvas-fg-strong);
    font-weight: normal;
    font-size: 32px;
    margin: 0 0 8px;
  }
  h2 {
    font-family: Georgia, serif;
    color: var(--canvas-fg-strong);
    font-weight: normal;
    margin: 32px 0 12px;
    font-size: 22px;
    border-top: 1px solid var(--canvas-rule);
    padding-top: 24px;
  }
  h2 small { color: var(--canvas-fg-muted); font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; margin-left: 8px; }
  p.lede { color: var(--canvas-fg); max-width: 720px; }
  .candidates {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
  }
  .candidate {
    display: block;
    cursor: pointer;
    background: rgba(255, 255, 255, 0.02);
    border: 2px solid transparent;
    border-radius: 4px;
    padding: 8px;
    transition: border-color 120ms ease, background 120ms ease;
  }
  .candidate input { display: none; }
  .candidate img {
    width: 100%;
    aspect-ratio: 4 / 3;
    object-fit: cover;
    display: block;
    border-radius: 2px;
    background: #0e110d;
  }
  .candidate .title { margin-top: 8px; color: var(--canvas-fg-strong); font-size: 12px; line-height: 1.3; }
  .candidate .meta { margin-top: 4px; color: var(--canvas-fg-muted); font-size: 10px; word-break: break-all; }
  .candidate .meta code { font-size: 9.5px; }
  .candidate[data-current="true"] { border-color: rgba(58, 107, 74, 0.55); }
  .candidate input:checked + img { box-shadow: 0 0 0 3px var(--accent); }
  .candidate.changed { border-color: var(--canvas-fg-strong); background: rgba(236, 233, 226, 0.05); }
  .badge {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 6px;
    border: 1px solid rgba(58, 107, 74, 0.6);
    color: var(--accent);
    font-size: 9px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    vertical-align: middle;
    border-radius: 2px;
  }
  .toolbar {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: var(--canvas);
    border: 1px solid var(--canvas-rule);
    padding: 12px 16px;
    display: flex;
    gap: 12px;
    align-items: center;
    border-radius: 4px;
    z-index: 100;
  }
  .toolbar button {
    background: var(--accent);
    color: var(--canvas-fg-strong);
    border: 0;
    padding: 10px 16px;
    border-radius: 3px;
    cursor: pointer;
    font-family: inherit;
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .toolbar button.secondary { background: transparent; border: 1px solid var(--canvas-rule); color: var(--canvas-fg); }
  .toolbar .count { color: var(--canvas-fg); font-size: 11px; }
  .toolbar .count strong { color: var(--canvas-fg-strong); }
</style>
</head>
<body>
  <h1>Hero photo review</h1>
  <p class="lede">
    Click any photo to make it the country's hero. Forest-green outline = current hero;
    cream outline = your new pick (changed from current). Use the toolbar to download
    your picks as JSON, or copy them to the clipboard. Hand the JSON back to the agent
    to apply the swaps to <code>scripts/build-photo-atlas.ts</code>.
  </p>

  ${sections.join('\n')}

  <div class="toolbar">
    <span class="count"><strong id="changedCount">0</strong> changed</span>
    <button onclick="copyPicks()">Copy picks JSON</button>
    <button class="secondary" onclick="downloadPicks()">Download picks.json</button>
  </div>

<script>
const INITIAL_PICKS = ${initialPicksJson};

function currentPicks() {
  const picks = {};
  document.querySelectorAll('section.country').forEach((sec) => {
    const country = sec.dataset.country;
    const checked = sec.querySelector('input[type="radio"]:checked');
    if (checked) picks[country] = checked.value;
  });
  return picks;
}

function diffFromInitial() {
  const picks = currentPicks();
  const out = {};
  for (const [country, id] of Object.entries(picks)) {
    if (INITIAL_PICKS[country] !== id) out[country] = id;
  }
  return out;
}

function highlightChanges() {
  document.querySelectorAll('section.country').forEach((sec) => {
    const country = sec.dataset.country;
    const checked = sec.querySelector('input[type="radio"]:checked');
    if (!checked) return;
    const changed = INITIAL_PICKS[country] !== checked.value;
    sec.querySelectorAll('.candidate').forEach((c) => c.classList.remove('changed'));
    if (changed) checked.parentElement.classList.add('changed');
  });
  const n = Object.keys(diffFromInitial()).length;
  document.getElementById('changedCount').textContent = String(n);
}

document.querySelectorAll('input[type="radio"]').forEach((r) => {
  r.addEventListener('change', highlightChanges);
});

function copyPicks() {
  const json = JSON.stringify(diffFromInitial(), null, 2);
  navigator.clipboard.writeText(json).then(() => {
    alert('Copied picks (changes only) to clipboard.\\n\\n' + json);
  });
}

function downloadPicks() {
  const json = JSON.stringify(diffFromInitial(), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'hero-picks.json';
  a.click();
  URL.revokeObjectURL(url);
}

highlightChanges();
</script>
</body>
</html>
`;
}

async function main() {
  await mkdir(join(ROOT, '.context'), { recursive: true });

  console.log('Scraping portfolio index for cover URLs...');
  const coverByUrl = await buildIndexCoverMap();
  console.log(`  ${coverByUrl.size} covers indexed`);

  const sections: string[] = [];
  const currentPicks: Record<string, string> = {};

  let multi = 0;
  let single = 0;
  for (const entry of MANIFEST) {
    const candidates = entryCandidates(entry, coverByUrl);
    if (candidates.length <= 1) {
      single++;
      continue;
    }
    multi++;
    sections.push(renderCountrySection(entry.country, entry.render_kind, candidates));
    const cur = candidates.find((c) => c.isCurrent);
    if (cur) currentPicks[entry.country] = cur.id;
  }

  const html = buildHtml(sections, currentPicks);
  await writeFile(OUT_PATH, html);

  console.log(`\nwrote ${OUT_PATH}`);
  console.log(`  ${multi} multi-candidate countries (pickable)`);
  console.log(`  ${single} single-candidate countries (skipped)`);
  console.log(`\nopen ${OUT_PATH}`);
}

void renderCandidate;

if (import.meta.main) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
