// Manual photo review UI for the merged photo dataset.
//
// Serves a small browser-based tool on http://localhost:4318/ that
// shows each photo with the AI-generated metadata as read-only context
// + a big freeform "Your notes" textarea where the curator writes
// opinions / corrections / stories. Notes accumulate as JSONL events
// in data/photography-labels/human/{sessionStamp}.jsonl. The review
// tool ONLY writes events; it never touches photography.json /
// photo-classifications.json directly. Flush events to the output
// files by running `bun run scripts/merge-labels.ts` manually when
// you're ready (that step also runs the LLM refinement prompt that
// translates notes into refined structured labels). The UI overlays
// pending human events on top of the on-disk state so the curator
// always sees their latest edits even before merging.
//
// Scope: all 247 photos the build manifest renders — photography.json
// (photo-*), me.json sabbatical-travel (me-*), photo-atlas.json
// (atlas-*). Each save appends one event keyed by the namespaced id
// and the merger handles writing back to the output files.
//
// Below the photo: 5 perceptual-hash near-duplicate suggestions across
// the entire merged set. Click a suggestion to jump to it (when local)
// or use the "mark dupe" button to set dupeOf.
//
// Run:
//   bun run scripts/review-photos.ts
//
// Pre-computes dHashes for every manifest-bound photo on boot (~5-15s),
// so subsequent dupe lookups are instant.

import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import type { JsonObject, JsonValue } from '../src/utils/json';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { serve } from 'bun';
import sharp from 'sharp';
import { ensureLabelsDir, sessionStamp } from './merge-labels';

const ROOT = resolve(import.meta.dir, '..');
const PHOTOGRAPHY_JSON = join(ROOT, 'data', 'photography.json');
const PHOTO_CLASSIFICATIONS_JSON = join(ROOT, 'data', 'photo-classifications.json');
const ME_JSON = join(ROOT, 'data', 'me.json');
const ATLAS_JSON = join(ROOT, 'data', 'photo-atlas.json');
const HUMAN_DIR = join(ROOT, 'data', 'photography-labels', 'human');
const PORT = Number(process.env.PORT ?? 4318);

// Per-session human labels log. Every save appends one JSONL event
// here. The merger reads this directory to apply curator changes.
const SESSION_STAMP = sessionStamp();
const SESSION_LOG = join(ensureLabelsDir('human'), `${SESSION_STAMP}.jsonl`);

// Fields the human tier is allowed to set. Empty values clear; others
// pass through. The merger enforces the same set; we mirror it here so
// the review tool only sends sensible patches.
const HUMAN_FIELDS = new Set([
  'caption', 'alt', 'country', 'city', 'state', 'theme', 'species', 'story', 'entities',
  'album_url', 'featured', 'graphic', 'curator_notes', 'dupeOf',
  // Curator triage flags. Both are filter signals for the merger:
  //   omit       — drop the photo from the merged output entirely
  //   needs_edit — keep the photo, but list it on stdout during merge
  //                so the curator knows which sources to re-process
  //                externally (e.g. open in Lightroom and re-export).
  // Not shipped to the public manifest — see toPhotographyOutput /
  // toClassificationFields in merge-labels.ts.
  'omit', 'needs_edit',
  // Curator-assigned global ranking — lower wins (top of list = best).
  // Set in batches via the list view's drag-and-drop "Save order"
  // gesture. The manifest builder sorts the photos array by this field
  // so every downstream consumer inherits the ranking.
  'sort_order',
]);

interface PriorNote { ts: string; sessionFile: string; text: string; }

interface ReviewEntry {
  id: string;              // namespaced: photo-* / me-* / atlas-*
  src: string;
  source: 'photography' | 'me' | 'atlas';
  aspect?: number;
  // Merged AI/refined/ingest labels (read from output files):
  caption?: string;
  alt?: string;
  country?: string;       // ISO-3166-1 alpha-3 code
  city?: string;
  state?: string;
  theme?: string[];
  species?: string;
  story?: string;
  entities?: string[];
  album_url?: string;
  featured?: boolean;
  graphic?: boolean;
  omit?: boolean;
  needs_edit?: boolean;
  dupeOf?: string;
  sort_order?: number;
  // Chronological list of every saved curator_notes event for this
  // photo. The review UI renders these in a read-only "prior notes"
  // panel and starts the new-note textarea blank.
  prior_notes?: PriorNote[];
  // Convenience flag derived from prior_notes.length for filter UI —
  // the "has-notes" / "no-notes" filters check this without re-walking
  // the list.
  has_notes?: boolean;
}

interface AtlasEntry { country: string; country_slug: string; image?: string; }
type MeItem = { id: string; type?: string; src: string; aspect?: number; caption?: string; };

// Parse rather than assume: an item missing id or src is reported and
// skipped instead of showing up in the review UI with no identity.
function isMeItem(it: JsonValue): it is MeItem {
  return (
    typeof it === 'object' &&
    it !== null &&
    !Array.isArray(it) &&
    typeof it.id === 'string' &&
    typeof it.src === 'string' &&
    (it.type === undefined || typeof it.type === 'string') &&
    (it.aspect === undefined || typeof it.aspect === 'number') &&
    (it.caption === undefined || typeof it.caption === 'string')
  );
}

const atlas = JSON.parse(readFileSync(ATLAS_JSON, 'utf8')) as AtlasEntry[];
// Country dropdown options. Storage value is the ISO-3 code (so all
// data layers agree); the visible label is the display name. Pulled
// from the shared locations table so the dropdown stays in sync with
// the merger's allowlist + the manifest builder's continent map.
import { countryNameForCode, LOCATIONS, normalizeCountryCode } from '../src/utils/locations';
import {
  CATEGORY_TREE,
  allCategoryIds,
  walkCategoryTree,
  LEGACY_THEME_REWRITES,
  type CategoryNode,
} from '../src/photography/categories';

// Canonical theme ids ordered exactly the way the dropdown should
// present them: top-level bucket first, then its children, then the
// next top-level. Built once at module load from the same tree the
// classifier prompt and the manifest builder use, so the review
// tool, classify, merge, and the public site never disagree on
// which tags are "current."
const CANONICAL_THEMES: string[] = [];
walkCategoryTree((node) => {
  CANONICAL_THEMES.push(node.id);
});
const CANONICAL_THEME_SET = allCategoryIds();
const LEGACY_REWRITE_SET = new Set(Object.keys(LEGACY_THEME_REWRITES));

// Wildlife subtree ids — used by the "wildlife with other categories"
// filter to detect photos cross-tagged into landscape/culture. Built
// from CATEGORY_TREE so it stays in sync if the taxonomy shifts.
const WILDLIFE_SUBTREE: Set<string> = (() => {
  const out = new Set<string>();
  const wl = CATEGORY_TREE.find((n) => n.id === 'wildlife');
  if (wl) {
    out.add(wl.id);
    for (const ch of wl.children ?? []) out.add(ch.id);
  }
  return out;
})();
const COUNTRIES = LOCATIONS
  .map((row) => ({ code: row.code, name: row.name }))
  .sort((a, b) => a.name.localeCompare(b.name));

// Walk me.json's nested structure for sabbatical-travel items.
function loadSabbaticalItems(me: JsonObject): MeItem[] {
  const out: MeItem[] = [];
  const visit = (node: JsonValue): void => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (typeof node !== 'object' || node === null) return;
    const items = node.items;
    if (Array.isArray(items)) {
      const isSabbatical = items.every(
        (it) =>
          typeof it === 'object' &&
          it !== null &&
          !Array.isArray(it) &&
          typeof it.src === 'string' &&
          it.src.includes('sabbatical-travel/'),
      );
      if (isSabbatical) {
        const parsed = items.filter(isMeItem);
        if (parsed.length !== items.length) {
          console.warn(
            `review-photos: skipped ${items.length - parsed.length} sabbatical-travel item(s) missing id/src`,
          );
        }
        out.push(...parsed);
        return;
      }
    }
    Object.values(node).forEach(visit);
  };
  visit(me);
  return out;
}

interface HumanOverlay {
  // Latest-wins per non-note field (featured, graphic, dupeOf, structured
  // overrides). Used to project the on-disk merged state forward so the
  // UI reflects pending edits before merge runs.
  fields: Map<string, Record<string, unknown>>;
  // FULL chronological list of curator_notes events per id. Each save
  // appends a new event; the UI shows them as separate prior notes and
  // doesn't pre-populate the new-note textarea with them. The merger
  // already concatenates them for refinement input.
  notes: Map<string, PriorNote[]>;
}

// Walk every human/*.jsonl event and build the overlay used by the
// review UI:
//   - latest-wins per field for everything except curator_notes
//   - full chronological list of curator_notes events per photo
//
// Empty values follow the same human-tier "clear" semantic the merger
// uses — an empty input means "remove this field" (or, for notes, a
// retroactive blank doesn't get listed as a prior note).
function loadHumanOverlay(): HumanOverlay {
  const fields = new Map<string, Record<string, unknown>>();
  const notes = new Map<string, PriorNote[]>();
  if (!existsSync(HUMAN_DIR)) return { fields, notes };
  const files = readdirSync(HUMAN_DIR).filter((f) => f.endsWith('.jsonl')).sort();
  const events: Array<{ ts: string; sessionFile: string; id: string; fields: Record<string, unknown> }> = [];
  for (const f of files) {
    const sessionFile = f.replace(/\.jsonl$/, '');
    const text = readFileSync(join(HUMAN_DIR, f), 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const o = JSON.parse(trimmed) as Record<string, unknown>;
        if (typeof o.id !== 'string') continue;
        const eventFields = o.fields as Record<string, unknown> | undefined;
        if (!eventFields || typeof eventFields !== 'object') continue;
        const ts = typeof o.timestamp === 'string' ? o.timestamp : '';
        events.push({ ts, sessionFile, id: o.id, fields: eventFields });
      } catch { /* skip malformed */ }
    }
  }
  events.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  for (const ev of events) {
    let bucket = fields.get(ev.id);
    if (!bucket) { bucket = {}; fields.set(ev.id, bucket); }
    for (const [k, v] of Object.entries(ev.fields)) {
      if (!HUMAN_FIELDS.has(k)) continue;
      const isEmpty =
        v == null || v === '' || (Array.isArray(v) && v.length === 0);
      if (k === 'curator_notes') {
        // Append non-empty notes to the per-id chronology. Empty notes
        // are a "clear" gesture and don't show up as a prior entry.
        if (typeof v === 'string' && v.trim()) {
          let chrono = notes.get(ev.id);
          if (!chrono) { chrono = []; notes.set(ev.id, chrono); }
          chrono.push({ ts: ev.ts, sessionFile: ev.sessionFile, text: v.trim() });
        }
        continue;
      }
      if (isEmpty) delete bucket[k];
      else bucket[k] = v;
    }
  }
  return { fields, notes };
}

// Build the unified review-entry list from all three sources, attaching
// merged labels from the output files + curator notes from JSONL.
function loadEntries(): ReviewEntry[] {
  const photoArr = JSON.parse(readFileSync(PHOTOGRAPHY_JSON, 'utf8')) as Array<Record<string, unknown>>;
  const me = JSON.parse(readFileSync(ME_JSON, 'utf8')) as JsonObject;
  const classifications = existsSync(PHOTO_CLASSIFICATIONS_JSON)
    ? JSON.parse(readFileSync(PHOTO_CLASSIFICATIONS_JSON, 'utf8')) as Record<string, Record<string, unknown>>
    : {};
  const humanOverlay = loadHumanOverlay();

  // Apply pending human-tier fields on top of the disk state so the
  // review UI reflects what the curator has saved in this session
  // (even though merge hasn't been run yet to flush to photography.json
  // / photo-classifications.json). The notes array stays separate so
  // the UI can render prior notes as a read-only history without
  // pre-populating the new-note textarea.
  const overlay = (id: string, base: Partial<ReviewEntry>): ReviewEntry => {
    const patch = humanOverlay.fields.get(id) ?? {};
    const priorNotes = humanOverlay.notes.get(id) ?? [];
    return {
      ...base,
      ...patch,
      prior_notes: priorNotes,
      has_notes: priorNotes.length > 0,
    } as ReviewEntry;
  };

  const out: ReviewEntry[] = [];

  // photo-* — fields live inline on photography.json after merge.
  for (const e of photoArr) {
    const bareId = e.id as string;
    if (!bareId) continue;
    const id = `photo-${bareId}`;
    out.push(overlay(id, {
      id,
      src: e.src as string,
      source: 'photography',
      aspect: typeof e.aspect === 'number' ? e.aspect : undefined,
      caption: typeof e.caption === 'string' ? e.caption : undefined,
      alt: typeof e.alt === 'string' ? e.alt : undefined,
      country: typeof e.country === 'string' ? e.country : undefined,
      city: typeof e.city === 'string' ? e.city : undefined,
      state: typeof e.state === 'string' ? e.state : undefined,
      theme: Array.isArray(e.theme) ? e.theme as string[] : undefined,
      species: typeof e.species === 'string' ? e.species : undefined,
      story: typeof e.story === 'string' ? e.story : undefined,
      entities: Array.isArray(e.entities) ? e.entities as string[] : undefined,
      album_url: typeof e.album_url === 'string' ? e.album_url : undefined,
      featured: e.featured === true,
      graphic: e.graphic === true,
      dupeOf: typeof e.dupeOf === 'string' ? e.dupeOf : undefined,
      sort_order: typeof e.sort_order === 'number' ? e.sort_order : undefined,
    }));
  }

  // me-* — fields live src-keyed in photo-classifications.json.
  for (const item of loadSabbaticalItems(me)) {
    if (item.type && item.type !== 'image') continue;
    const id = `me-${item.id}`;
    const c = classifications[item.src] ?? {};
    out.push(overlay(id, {
      id,
      src: item.src,
      source: 'me',
      aspect: item.aspect,
      caption: typeof c.caption === 'string' ? c.caption : item.caption,
      alt: typeof c.alt === 'string' ? c.alt : undefined,
      country: typeof c.country === 'string' ? c.country : undefined,
      city: typeof c.city === 'string' ? c.city : undefined,
      state: typeof c.state === 'string' ? c.state : undefined,
      theme: Array.isArray(c.theme) ? c.theme as string[] : undefined,
      species: typeof c.species === 'string' ? c.species : undefined,
      story: typeof c.story === 'string' ? c.story : undefined,
      entities: Array.isArray(c.entities) ? c.entities as string[] : undefined,
      sort_order: typeof c.sort_order === 'number' ? c.sort_order : undefined,
      // Sabbatical photos default to featured=true in the manifest
      // builder; mirror that here so the review UI's featured checkbox
      // matches what ships. Explicit false in the side table wins.
      featured: typeof c.featured === 'boolean' ? c.featured : true,
    }));
  }

  // atlas-* — fields live src-keyed in photo-classifications.json.
  for (const a of atlas) {
    if (!a.image) continue;
    const id = `atlas-${a.country_slug}`;
    const c = classifications[a.image] ?? {};
    out.push(overlay(id, {
      id,
      src: a.image,
      source: 'atlas',
      caption: typeof c.caption === 'string' ? c.caption : undefined,
      alt: typeof c.alt === 'string' ? c.alt : undefined,
      country: typeof c.country === 'string'
        ? c.country
        : (normalizeCountryCode(a.country_slug) ?? a.country_slug),
      city: typeof c.city === 'string' ? c.city : undefined,
      state: typeof c.state === 'string' ? c.state : undefined,
      theme: Array.isArray(c.theme) ? c.theme as string[] : undefined,
      species: typeof c.species === 'string' ? c.species : undefined,
      story: typeof c.story === 'string' ? c.story : undefined,
      entities: Array.isArray(c.entities) ? c.entities as string[] : undefined,
      sort_order: typeof c.sort_order === 'number' ? c.sort_order : undefined,
      featured: typeof c.featured === 'boolean' ? c.featured : false,
    }));
  }

  return out;
}

function collectExistingThemes(entries: ReviewEntry[]): string[] {
  const set = new Set<string>();
  for (const e of entries) for (const t of e.theme ?? []) set.add(t);
  return [...set].sort();
}

// ─────────────────────────────────────────────────────────────────────
// dHash + dupe suggestions (unchanged from prior version — already
// works across photo-/me-/atlas- with namespaced ids).
// ─────────────────────────────────────────────────────────────────────

interface HashedPhoto {
  id: string;
  src: string;
  source: 'photography' | 'me' | 'atlas';
  hash: bigint;
  shootDate: string | null;
  // Pixel dimensions + on-disk file size, populated by precomputeHashes
  // so the dupe-mark modal can surface "how big is this file" alongside
  // the metadata. Undefined when the source is unreadable.
  width?: number;
  height?: number;
  bytes?: number;
}

async function computeDHash(srcAbs: string): Promise<bigint> {
  const { data } = await sharp(srcAbs)
    .rotate()
    .grayscale()
    .resize({ width: 9, height: 8, fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let h = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = data[y * 9 + x];
      const right = data[y * 9 + x + 1];
      h = (h << 1n) | (right > left ? 1n : 0n);
    }
  }
  return h;
}

function hamming64(a: bigint, b: bigint): number {
  let x = a ^ b;
  let c = 0;
  while (x) { c += Number(x & 1n); x >>= 1n; }
  return c;
}

const HASHED: HashedPhoto[] = [];

async function precomputeHashes(allEntries: ReviewEntry[]): Promise<void> {
  const targets: HashedPhoto[] = allEntries.map((e) => ({
    id: e.id, src: e.src, source: e.source, hash: 0n, shootDate: null,
  }));
  console.log(`  precomputing dHash + shoot dates for ${targets.length} photos...`);
  const start = Date.now();
  let done = 0;
  await Promise.all(
    targets.map(async (t) => {
      const abs = join(ROOT, t.src);
      if (!existsSync(abs)) return;
      try {
        const [hash, shootDate, meta] = await Promise.all([
          computeDHash(abs),
          getShootDate(t.src),
          sharp(abs).metadata(),
        ]);
        t.hash = hash;
        t.shootDate = shootDate;
        if (meta.width) t.width = meta.width;
        if (meta.height) t.height = meta.height;
        try { t.bytes = statSync(abs).size; } catch {/* ignore stat errors */}
        HASHED.push(t);
      } catch {/* skip unreadable */}
      done += 1;
      if (done % 40 === 0) console.log(`    ${done}/${targets.length}`);
    }),
  );
  const withDate = HASHED.filter((h) => h.shootDate).length;
  console.log(
    `  hashed ${HASHED.length} photos in ${((Date.now() - start) / 1000).toFixed(1)}s ` +
    `(${withDate} with shoot date)`,
  );
}

export type DupeReason = 'same-date' | 'visual-strict' | 'visual-loose';

interface DupeCandidate {
  id: string;
  src: string;
  source: HashedPhoto['source'];
  distance: number;
  shootDate: string | null;
  reason: DupeReason;
  tier: 1 | 2 | 3;
}

function nearestDupes(id: string, n: number): DupeCandidate[] {
  const target = HASHED.find((x) => x.id === id);
  if (!target) return [];
  const candidates: DupeCandidate[] = [];
  for (const x of HASHED) {
    if (x.id === id) continue;
    const distance = hamming64(target.hash, x.hash);
    const bothDated = target.shootDate && x.shootDate;
    if (bothDated && target.shootDate !== x.shootDate) continue;
    if (bothDated && target.shootDate === x.shootDate && distance <= 12) {
      candidates.push({ id: x.id, src: x.src, source: x.source, distance, shootDate: x.shootDate, reason: 'same-date', tier: 1 });
      continue;
    }
    if (!bothDated && distance <= 4) {
      candidates.push({ id: x.id, src: x.src, source: x.source, distance, shootDate: x.shootDate, reason: 'visual-strict', tier: 2 });
      continue;
    }
    if (!bothDated && distance <= 8) {
      candidates.push({ id: x.id, src: x.src, source: x.source, distance, shootDate: x.shootDate, reason: 'visual-loose', tier: 3 });
      continue;
    }
  }
  candidates.sort((a, b) => a.tier - b.tier || a.distance - b.distance);
  return candidates.slice(0, n);
}

// Return the top-N photos by pure dHash distance to the target,
// regardless of tier or shoot-date constraints. Used by the
// "show all candidates" modal — the strip's tiered list only shows
// strong matches, but when the curator knows there's a dupe and none
// of the strip candidates fit, this surface lets them scroll deeper.
function rankByDistance(id: string, n: number): DupeCandidate[] {
  const target = HASHED.find((x) => x.id === id);
  if (!target) return [];
  const all: DupeCandidate[] = [];
  for (const x of HASHED) {
    if (x.id === id) continue;
    const distance = hamming64(target.hash, x.hash);
    // Pick the most informative reason/tier for display; this is purely
    // a hint, the modal doesn't filter on it.
    let reason: DupeReason = 'visual-loose';
    let tier: 1 | 2 | 3 = 3;
    const bothDated = target.shootDate && x.shootDate;
    if (bothDated && target.shootDate === x.shootDate && distance <= 12) {
      reason = 'same-date'; tier = 1;
    } else if (!bothDated && distance <= 4) {
      reason = 'visual-strict'; tier = 2;
    }
    all.push({ id: x.id, src: x.src, source: x.source, distance, shootDate: x.shootDate, reason, tier });
  }
  all.sort((a, b) => a.distance - b.distance);
  return all.slice(0, n);
}

// Spawn the merge-labels script in --only / --emit-progress mode and
// pipe its structured progress events out as Server-Sent-Events.
// Used by the all-notes view's per-card Refine button so the UI shows
// running / done / failed states + the actual refined field values
// without having to poll.
function mergeStream(opts: { ids: string[]; skipRefine?: boolean }): Response {
  const startedAt = Date.now();
  const encoder = new TextEncoder();
  const args = [
    'run', 'scripts/merge-labels.ts',
    '--only', opts.ids.join(','),
    '--emit-progress',
  ];
  if (opts.skipRefine) args.push('--skip-refine');

  let child: ReturnType<typeof spawn>;
  const stream = new ReadableStream({
    start(controller) {
      const send = (evt: Record<string, unknown>): void => {
        try {
          controller.enqueue(encoder.encode('data: ' + JSON.stringify(evt) + '\n\n'));
        } catch { /* client may have disconnected */ }
      };
      send({ type: 'started', ids: opts.ids, skipRefine: !!opts.skipRefine });

      child = spawn('bun', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
      let buf = '';
      const flushLine = (line: string): void => {
        if (line.startsWith('PROGRESS ')) {
          try {
            const parsed = JSON.parse(line.slice('PROGRESS '.length));
            send({ type: 'progress', ...parsed });
          } catch {
            send({ type: 'log', stream: 'stdout', line });
          }
          return;
        }
        if (line.trim()) send({ type: 'log', stream: 'stdout', line });
      };
      child.stdout?.on('data', (data: Buffer) => {
        buf += data.toString();
        let i = buf.indexOf('\n');
        while (i >= 0) {
          flushLine(buf.slice(0, i));
          buf = buf.slice(i + 1);
          i = buf.indexOf('\n');
        }
      });
      child.stderr?.on('data', (data: Buffer) => {
        send({ type: 'log', stream: 'stderr', line: data.toString() });
      });
      child.on('error', (err) => {
        send({ type: 'error', message: err.message });
      });
      child.on('close', (code) => {
        if (buf.trim()) flushLine(buf);
        send({ type: 'exit', code: code ?? -1, elapsedMs: Date.now() - startedAt });
        try { controller.close(); } catch { /* already closed */ }
      });
    },
    cancel() {
      // Client disconnected — kill the subprocess so we don't keep
      // burning Claude tokens after the curator closes the tab.
      try { child?.kill('SIGTERM'); } catch {/* */}
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

interface DupeIndexEntry {
  topTier: 1 | 2 | 3;
  count: number;
  likelyCount: number;
}
const DUPE_INDEX = new Map<string, DupeIndexEntry>();

function buildDupeIndex(): void {
  for (const h of HASHED) {
    const dupes = nearestDupes(h.id, 8);
    if (dupes.length === 0) continue;
    const topTier = dupes[0].tier;
    const likelyCount = dupes.filter((d) => d.tier <= 2).length;
    DUPE_INDEX.set(h.id, { topTier, count: dupes.length, likelyCount });
  }
  const likely = [...DUPE_INDEX.values()].filter((d) => d.likelyCount > 0).length;
  console.log(
    `  dupe index: ${DUPE_INDEX.size} entries have ≥1 candidate ` +
    `(${likely} with tier 1-2 / likely matches)`,
  );
}

const dateCache = new Map<string, string | null>();
async function getShootDate(src: string): Promise<string | null> {
  if (dateCache.has(src)) return dateCache.get(src)!;
  const abs = join(ROOT, src);
  let date: string | null = null;
  if (existsSync(abs)) {
    try {
      const exifr = (await import('exifr')).default;
      const ex = await exifr.parse(abs, ['DateTimeOriginal']);
      if (ex?.DateTimeOriginal instanceof Date) {
        date = ex.DateTimeOriginal.toISOString().slice(0, 10);
      }
    } catch {/* fall through */}
  }
  if (!date) {
    const m = src.split('/').pop()?.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) date = `${m[1]}-${m[2]}-${m[3]}`;
  }
  dateCache.set(src, date);
  return date;
}

// ─────────────────────────────────────────────────────────────────────
// UI template
// ─────────────────────────────────────────────────────────────────────

function html(themes: string[]): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Photo Review · all sources</title>
  <style>
    :root {
      --canvas: #1c1f1a;
      --canvas-fg-strong: #ece9e2;
      --canvas-fg: #b8b5ad;
      --canvas-fg-muted: #7a7770;
      --canvas-rule: rgba(236, 233, 226, 0.18);
      --canvas-rule-strong: rgba(236, 233, 226, 0.32);
      --accent: #3a6b4a;
      --accent-soft: rgba(58, 107, 74, 0.20);
      --danger: #b03a2e;
      --mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      --serif: Georgia, 'Times New Roman', Times, serif;
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0;
      background: var(--canvas); color: var(--canvas-fg);
      font-family: var(--serif); font-size: 15px;
      min-height: 100vh;
    }
    a { color: var(--canvas-fg-strong); text-decoration: none; border-bottom: 1px dotted var(--canvas-rule); }
    /* Chrome buttons + inputs share one register, mirroring the main-site
       TreeDropdown / SearchBox trigger so the review tool reads as part
       of the same family: mono, eyebrow size, 800-weight, 0.18em tracking,
       uppercase, 1px rule, no radius, padding 8px 10px. */
    button {
      appearance: none; background: transparent;
      border: 1px solid var(--canvas-rule); color: var(--canvas-fg);
      font-family: var(--mono); font-size: 10.5px;
      font-weight: 800;
      letter-spacing: 0.18em; text-transform: uppercase;
      padding: 8px 10px; cursor: pointer; border-radius: 0;
      line-height: 1;
      transition: all 120ms ease;
    }
    button:hover, button:focus-visible { color: var(--canvas-fg-strong); border-color: var(--canvas-fg-strong); outline: none; }
    button.primary { background: var(--canvas-fg-strong); color: var(--canvas); border-color: var(--canvas-fg-strong); }
    button.primary:hover { background: #fff; border-color: #fff; }
    button.danger { color: #c97b6e; border-color: rgba(176,58,46,0.4); }
    button.danger:hover { color: #fff; background: var(--danger); border-color: var(--danger); }

    header.bar {
      display: flex; align-items: center; gap: 14px;
      padding: 14px 24px; border-bottom: 1px solid var(--canvas-rule);
      font-family: var(--mono); font-size: 12px;
      letter-spacing: 0.12em; text-transform: uppercase;
      flex-wrap: wrap;
    }
    .bar-divider { width: 1px; height: 24px; background: var(--canvas-rule); margin: 0 6px; }
    .mic-explainer {
      font-family: var(--mono); font-size: 10px;
      letter-spacing: 0.04em; text-transform: none;
      color: var(--canvas-fg-muted);
      max-height: 1.4em; line-height: 1.4; white-space: nowrap;
    }
    .bar select, .bar input {
      background: transparent; color: var(--canvas-fg-strong);
      border: 1px solid var(--canvas-rule); border-radius: 0;
      font-family: var(--mono); font-size: 10.5px;
      font-weight: 800;
      letter-spacing: 0.18em; text-transform: uppercase;
      padding: 8px 10px; line-height: 1;
    }
    .progress { margin-left: auto; color: var(--canvas-fg-muted); font-variant-numeric: tabular-nums; font-size: 12px; }
    .progress strong { color: var(--canvas-fg-strong); }

    main {
      display: grid;
      grid-template-columns: minmax(0, 1fr) clamp(560px, 36vw, 760px);
      gap: 24px;
      padding: 24px;
      height: calc(100vh - 62px);
      box-sizing: border-box;
    }

    .left { display: flex; flex-direction: column; gap: 16px; min-width: 0; min-height: 0; height: 100%; }
    .photo-pane {
      display: flex; align-items: center; justify-content: center;
      background: #0a0c0a;
      border: 1px solid var(--canvas-rule);
      overflow: hidden; position: relative;
      flex: 1 1 0; min-height: 0;
    }
    .photo-pane img {
      max-width: 100%; max-height: 100%;
      object-fit: contain; display: block;
      user-select: none;
    }
    .meta-overlay {
      position: absolute; top: 10px; left: 10px;
      font-family: var(--mono); font-size: 11px;
      letter-spacing: 0.12em; text-transform: uppercase;
      color: var(--canvas-fg-strong);
      background: rgba(0,0,0,0.55); backdrop-filter: blur(6px);
      padding: 8px 12px; border-radius: 2px;
    }
    .source-pill {
      display: inline-block; margin-left: 8px;
      padding: 2px 6px; font-size: 9px; letter-spacing: 0.08em;
      border: 1px solid var(--canvas-rule-strong); border-radius: 2px;
      color: var(--canvas-fg-strong);
    }

    .dupe-strip {
      display: flex; flex-direction: column; gap: 8px;
      padding: 12px 14px;
      border: 1px solid var(--canvas-rule);
      background: rgba(255,255,255,0.015);
      flex: 0 0 auto; max-height: 220px;
    }
    .dupe-strip-header {
      display: flex; align-items: center; justify-content: space-between;
      font-family: var(--mono); font-size: 10px;
      letter-spacing: 0.18em; text-transform: uppercase;
      color: var(--canvas-fg-muted);
    }
    .dupe-strip-list { display: flex; gap: 10px; overflow-x: auto; }
    .dupe-card {
      flex: 0 0 auto;
      display: flex; flex-direction: column; gap: 4px;
      width: 132px;
      cursor: pointer;
      border: 1px solid var(--canvas-rule);
      background: transparent;
      padding: 4px;
      transition: border-color 140ms ease;
    }
    .dupe-card:hover, .dupe-card:focus-visible { border-color: var(--canvas-fg-strong); outline: none; }
    .dupe-card.tier-1 { border-color: var(--accent); }
    .dupe-card.tier-2 { border-color: rgba(58,107,74,0.55); }
    .dupe-card img { width: 100%; height: 70px; object-fit: cover; display: block; }
    .dupe-card .reason {
      font-family: var(--mono); font-size: 9px; font-weight: 800;
      letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--canvas-fg-strong); padding: 2px 0;
    }
    .dupe-card.tier-1 .reason { color: var(--accent); }
    .dupe-card.tier-2 .reason { color: var(--canvas-fg-strong); }
    .dupe-card.tier-3 .reason { color: var(--canvas-fg-muted); }
    .dupe-card .meta {
      font-family: var(--mono); font-size: 9px;
      letter-spacing: 0.06em;
      color: var(--canvas-fg);
      display: flex; justify-content: space-between;
    }
    .dupe-card .meta .dist { color: var(--canvas-fg-strong); }
    .dupe-card .id-label {
      font-family: var(--mono); font-size: 9px;
      letter-spacing: 0.04em;
      color: var(--canvas-fg-muted);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .dupe-card-actions { display: flex; gap: 4px; }
    .dupe-card-actions button {
      flex: 1; padding: 4px 6px; font-size: 9px; letter-spacing: 0.04em; border-radius: 2px;
    }
    .no-dupes {
      font-family: var(--mono); font-size: 11px;
      color: var(--canvas-fg-muted); letter-spacing: 0.06em; padding: 8px 0;
    }

    .form-pane { display: flex; flex-direction: column; gap: 18px; overflow-y: auto; height: 100%; min-height: 0; padding-right: 6px; }
    .ai-summary {
      border: 1px solid var(--canvas-rule);
      background: rgba(255,255,255,0.015);
      padding: 16px 18px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .ai-summary h3 {
      margin: 0 0 4px;
      font-family: var(--mono); font-size: 10px;
      letter-spacing: 0.22em; text-transform: uppercase;
      color: var(--canvas-fg-muted); font-weight: 800;
    }
    .ai-field { display: grid; grid-template-columns: 110px 1fr; gap: 12px; font-size: 14px; line-height: 1.55; }
    .ai-field .ai-label {
      font-family: var(--mono); font-size: 10px;
      letter-spacing: 0.18em; text-transform: uppercase;
      color: var(--canvas-fg-muted); padding-top: 3px;
    }
    .ai-field .ai-value { color: var(--canvas-fg-strong); font-style: italic; }
    .ai-field .ai-value.mono { font-family: var(--mono); font-style: normal; font-size: 12px; letter-spacing: 0.06em; }
    .ai-field .ai-value.empty { color: var(--canvas-fg-muted); font-style: normal; }

    /* Prior notes block — read-only history of every saved
       curator_notes event for the current photo. Rendered separately
       from the new-note input so the curator never edits or overwrites
       previously-saved text. */
    .prior-notes {
      border: 1px solid var(--canvas-rule);
      background: rgba(255,255,255,0.015);
      padding: 14px 16px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .prior-notes-header {
      display: flex; justify-content: space-between; align-items: baseline;
      font-family: var(--mono); font-size: 10px;
      letter-spacing: 0.22em; text-transform: uppercase;
      color: var(--canvas-fg-muted); font-weight: 800;
    }
    .prior-notes-header .count {
      letter-spacing: 0.08em; color: var(--canvas-fg);
    }
    .prior-notes-list { display: flex; flex-direction: column; gap: 8px; }
    .prior-note {
      padding: 8px 0;
      border-top: 1px dashed var(--canvas-rule);
      font-family: var(--serif); font-size: 14px; line-height: 1.55;
      color: var(--canvas-fg-strong);
      white-space: pre-wrap;
    }
    .prior-note:first-child { border-top: none; padding-top: 0; }
    .prior-note .meta {
      display: block;
      font-family: var(--mono); font-size: 9px;
      letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--canvas-fg-muted);
      margin-bottom: 4px;
    }
    .notes-block { display: flex; flex-direction: column; gap: 10px; }
    .notes-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .notes-block label {
      font-family: var(--mono); font-size: 11px;
      letter-spacing: 0.22em; text-transform: uppercase;
      color: var(--canvas-fg-strong);
    }
    .mic-btn {
      display: inline-flex; align-items: center; gap: 8px;
      font-family: var(--mono); font-size: 10.5px;
      font-weight: 800;
      letter-spacing: 0.18em; text-transform: uppercase;
      padding: 8px 10px;
      border: 1px solid var(--canvas-rule);
      background: transparent; color: var(--canvas-fg);
      border-radius: 0; cursor: pointer;
      line-height: 1;
      transition: all 120ms ease;
    }
    .mic-btn:hover, .mic-btn:focus-visible { color: var(--canvas-fg-strong); border-color: var(--canvas-fg-strong); outline: none; }
    .mic-btn.recording { color: #fff; border-color: var(--danger); background: rgba(176, 58, 46, 0.15); }
    .mic-btn .mic-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--canvas-fg-muted); display: inline-block; }
    .mic-btn.recording .mic-dot { background: var(--danger); animation: mic-pulse 1.2s ease-in-out infinite; }
    @keyframes mic-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%      { opacity: 0.35; transform: scale(1.4); }
    }
    .mic-status {
      font-family: var(--mono); font-size: 10px;
      letter-spacing: 0.18em; text-transform: uppercase;
      color: var(--canvas-fg-muted);
    }
    .interim-preview {
      font-family: var(--serif); font-style: italic;
      font-size: 13px; color: var(--canvas-fg-muted);
      padding: 6px 0 0; min-height: 1.5em;
    }
    .notes-block .hint {
      font-family: var(--mono); font-size: 10px;
      color: var(--canvas-fg-muted); letter-spacing: 0.06em; line-height: 1.5;
    }
    .notes-block .hint code { font-family: var(--mono); color: var(--canvas-fg-strong); letter-spacing: 0.08em; font-size: 10px; }
    .notes-block textarea {
      background: transparent; color: var(--canvas-fg-strong);
      border: 1px solid var(--canvas-rule-strong);
      border-radius: 0;
      font-family: var(--serif); font-size: 16px; line-height: 1.6;
      padding: 14px 16px;
      width: 100%; min-height: 280px;
      resize: vertical;
    }
    .notes-block textarea:focus { outline: none; border-color: var(--accent); }

    .toggles {
      border: 1px solid var(--canvas-rule);
      padding: 14px 16px;
      display: flex; gap: 22px; align-items: center; flex-wrap: wrap;
      font-family: var(--mono); font-size: 11px;
      letter-spacing: 0.12em; text-transform: uppercase;
    }
    .toggles label { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
    .toggles input { accent-color: var(--accent); width: 16px; height: 16px; }
    /* Triage toggles tint themselves only when checked, so the
       presence of a curator flag is visible at a glance without making
       the off state shouty. */
    .triage-toggle:has(input:checked) { color: var(--canvas-fg-strong); }
    .triage-edit:has(input:checked) { color: #d9b14a; }
    .triage-edit input { accent-color: #d9b14a; }
    .triage-omit:has(input:checked) { color: #c97b6e; }
    .triage-omit input { accent-color: var(--danger); }
    .toggles .dupe-input { display: flex; flex-direction: column; gap: 4px; font-size: 10px; letter-spacing: 0.18em; color: var(--canvas-fg-muted); }
    .toggles .dupe-input input[type=text],
    .toggles .dupe-input input[type=number] {
      background: transparent; color: var(--canvas-fg-strong);
      border: 1px solid var(--canvas-rule); border-radius: 0;
      font-family: var(--mono); font-size: 10.5px;
      font-weight: 800;
      letter-spacing: 0.18em; text-transform: uppercase;
      padding: 8px 10px; line-height: 1; width: 240px;
    }

    /* Structured-override panel — collapsed by default. Lets the curator
       set a specific field value without going through the LLM
       refinement step. Human-tier values win over refined per field. */
    .structured {
      border: 1px solid var(--canvas-rule);
      padding: 14px 16px;
      display: flex; flex-direction: column; gap: 12px;
    }
    .structured-header {
      display: flex; justify-content: space-between; align-items: center;
      cursor: pointer;
    }
    .structured-header h3 {
      margin: 0;
      font-family: var(--mono); font-size: 10px;
      letter-spacing: 0.22em; text-transform: uppercase;
      color: var(--canvas-fg-muted); font-weight: 800;
    }
    .structured-body { display: flex; flex-direction: column; gap: 12px; }
    .structured.collapsed .structured-body { display: none; }
    .structured .field { display: flex; flex-direction: column; gap: 4px; }
    .structured .field label {
      font-family: var(--mono); font-size: 10px;
      letter-spacing: 0.18em; text-transform: uppercase;
      color: var(--canvas-fg-muted);
    }
    .structured .field.dirty label::after {
      content: ' · edited'; color: var(--accent); letter-spacing: 0.18em;
    }
    .structured input[type=text],
    .structured textarea,
    .structured select {
      background: transparent; color: var(--canvas-fg-strong);
      border: 1px solid var(--canvas-rule); border-radius: 0;
      font-family: var(--serif); font-size: 15px; padding: 10px 12px;
      width: 100%; resize: vertical;
    }
    .structured input[type=text]:focus,
    .structured textarea:focus,
    .structured select:focus { outline: none; border-color: var(--accent); }
    .structured .field-row { display: flex; gap: 12px; }
    .structured .field-row .field { flex: 1; }

    .id-strip {
      font-family: var(--mono); font-size: 11px;
      color: var(--canvas-fg-muted);
      letter-spacing: 0.06em; line-height: 1.7;
      padding: 6px 10px;
      background: rgba(0,0,0,0.25);
      border: 1px solid var(--canvas-rule);
      border-radius: 2px;
    }
    .id-strip code { color: var(--canvas-fg-strong); }
    .id-strip .sep { color: var(--canvas-rule-strong); margin: 0 6px; }

    .action-row {
      position: sticky; bottom: 0;
      display: flex; gap: 8px; padding: 12px 0;
      background: var(--canvas);
      border-top: 1px solid var(--canvas-rule);
      margin-top: auto;
    }
    .action-row button { flex: 1; }
    .saved-flash {
      position: fixed; bottom: 24px; right: 24px;
      font-family: var(--mono); font-size: 12px;
      letter-spacing: 0.16em; text-transform: uppercase;
      background: var(--accent); color: #fff;
      padding: 12px 20px; border-radius: 2px;
      opacity: 0; transition: opacity 240ms ease;
      pointer-events: none;
    }
    .saved-flash.show { opacity: 1; }
    .saved-flash.merging { background: var(--canvas-fg-muted); }

    /* ── Dupe-mark modal ─────────────────────────────────────────── */
    .dupe-modal {
      position: fixed; inset: 0;
      display: none;
      z-index: 100;
      align-items: center; justify-content: center;
    }
    .dupe-modal[open] { display: flex; }
    .dupe-modal-backdrop {
      position: absolute; inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
    }
    .dupe-modal-card {
      position: relative; z-index: 1;
      background: var(--canvas);
      border: 1px solid var(--canvas-rule-strong);
      padding: 24px;
      width: min(1100px, 96vw);
      max-height: 92vh;
      overflow-y: auto;
      display: flex; flex-direction: column; gap: 18px;
    }
    .dupe-modal-card h2 {
      margin: 0;
      font-family: var(--mono); font-size: 12px; font-weight: 800;
      letter-spacing: 0.22em; text-transform: uppercase;
      color: var(--canvas-fg-strong);
    }
    .dupe-modal-explain {
      font-family: var(--mono); font-size: 10px;
      letter-spacing: 0.06em; color: var(--canvas-fg-muted);
      line-height: 1.6;
    }
    .dupe-modal-side-by-side {
      display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
    }
    .dupe-choice {
      display: flex; flex-direction: column; gap: 10px;
      padding: 14px;
      border: 1px solid var(--canvas-rule);
      cursor: pointer;
      background: rgba(255,255,255,0.015);
      transition: border-color 140ms ease, background 140ms ease;
    }
    .dupe-choice:hover { border-color: var(--canvas-rule-strong); }
    .dupe-choice.selected {
      border-color: var(--accent);
      background: rgba(58, 107, 74, 0.10);
    }
    .dupe-choice-header {
      display: flex; align-items: center; gap: 10px;
      font-family: var(--mono); font-size: 11px;
      letter-spacing: 0.12em; text-transform: uppercase;
      color: var(--canvas-fg-strong);
    }
    .dupe-choice-header input { accent-color: var(--accent); width: 18px; height: 18px; }
    .dupe-choice-header .role {
      font-size: 9px; letter-spacing: 0.18em;
      color: var(--canvas-fg-muted);
    }
    .dupe-choice.selected .dupe-choice-header .role { color: var(--accent); }
    .dupe-choice img {
      width: 100%; height: 240px; object-fit: contain;
      background: #0a0c0a;
      display: block;
    }
    .dupe-choice-meta {
      display: flex; flex-direction: column; gap: 6px;
      font-family: var(--mono); font-size: 11px;
      letter-spacing: 0.04em; color: var(--canvas-fg);
    }
    .dupe-choice-meta .row {
      display: grid; grid-template-columns: 78px 1fr; gap: 8px;
      line-height: 1.45;
    }
    .dupe-choice-meta .row .k {
      color: var(--canvas-fg-muted);
      font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase;
      padding-top: 1px;
    }
    .dupe-choice-meta .row .v { color: var(--canvas-fg-strong); }
    .dupe-choice-meta .row .v.empty { color: var(--canvas-fg-muted); }
    .dupe-modal-actions {
      display: flex; gap: 8px; justify-content: flex-end;
      padding-top: 4px;
    }

    /* All-candidates modal grid. Big enough that the curator can scan
       30-60 photos at a glance, click one to open the canonical-chooser
       modal pre-populated. */
    .dupes-all-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 12px;
      max-height: 70vh; overflow-y: auto;
      padding: 4px 2px;
    }
    .dupes-all-card {
      display: flex; flex-direction: column; gap: 4px;
      cursor: pointer;
      border: 1px solid var(--canvas-rule);
      background: transparent;
      padding: 6px;
      transition: border-color 140ms ease, background 140ms ease;
    }
    .dupes-all-card:hover {
      border-color: var(--canvas-fg-strong);
      background: rgba(255,255,255,0.025);
    }
    .dupes-all-card.tier-1 { border-color: var(--accent); }
    .dupes-all-card.tier-2 { border-color: rgba(58,107,74,0.55); }
    .dupes-all-card img {
      width: 100%; height: 110px;
      object-fit: cover; display: block;
      background: #0a0c0a;
    }
    .dupes-all-card .meta {
      display: flex; justify-content: space-between;
      font-family: var(--mono); font-size: 9px;
      letter-spacing: 0.08em; color: var(--canvas-fg);
    }
    .dupes-all-card .meta .dist { color: var(--canvas-fg-strong); }
    .dupes-all-card .id-label {
      font-family: var(--mono); font-size: 9px;
      letter-spacing: 0.04em; color: var(--canvas-fg-muted);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }

    .all-notes { height: calc(100vh - 62px); overflow-y: auto; padding: 24px clamp(20px, 4vw, 56px); box-sizing: border-box; }
    .all-notes-header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 24px; }
    .all-notes-header h1 {
      margin: 0;
      font-family: var(--mono); font-size: 14px;
      font-weight: 800; letter-spacing: 0.22em; text-transform: uppercase;
      color: var(--canvas-fg-strong);
    }
    .all-notes-header .count { font-family: var(--mono); font-size: 11px; letter-spacing: 0.08em; color: var(--canvas-fg-muted); }
    .all-notes-empty { padding: 80px 0; text-align: center; font-family: var(--mono); font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--canvas-fg-muted); }
    .notes-card { display: grid; grid-template-columns: 240px 1fr; gap: 20px; padding: 16px; border: 1px solid var(--canvas-rule); margin-bottom: 12px; align-items: start; }
    .notes-card img { width: 240px; height: 180px; object-fit: cover; display: block; background: #0a0c0a; border: 1px solid var(--canvas-rule); }
    .notes-card .nc-body { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .notes-card .nc-meta { display: flex; gap: 12px; align-items: center; font-family: var(--mono); font-size: 11px; letter-spacing: 0.06em; color: var(--canvas-fg-muted); }
    .notes-card .nc-meta code { color: var(--canvas-fg-strong); }
    .notes-card .nc-meta .country { color: var(--canvas-fg-strong); text-transform: uppercase; letter-spacing: 0.18em; font-size: 10px; }
    .notes-card .nc-notes { font-family: var(--serif); font-size: 15px; line-height: 1.55; color: var(--canvas-fg-strong); white-space: pre-wrap; margin: 0; }
    .notes-card .nc-actions { margin-top: 4px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .notes-card .nc-status {
      font-family: var(--mono); font-size: 10px;
      letter-spacing: 0.14em; text-transform: uppercase;
      padding: 4px 8px; border-radius: 2px;
      border: 1px solid var(--canvas-rule);
      color: var(--canvas-fg-muted);
    }
    .notes-card .nc-status.running { color: var(--canvas-fg-strong); border-color: var(--canvas-fg-strong); animation: nc-pulse 1.2s ease-in-out infinite; }
    .notes-card .nc-status.done    { color: #fff; background: var(--accent); border-color: var(--accent); }
    .notes-card .nc-status.cached  { color: var(--canvas-fg); border-color: var(--canvas-rule-strong); }
    .notes-card .nc-status.failed  { color: #fff; background: var(--danger); border-color: var(--danger); }
    @keyframes nc-pulse {
      0%, 100% { opacity: 1; }
      50%      { opacity: 0.55; }
    }
    .nc-diff {
      margin-top: 10px;
      border: 1px dashed var(--canvas-rule-strong);
      padding: 12px 14px;
      display: flex; flex-direction: column; gap: 10px;
      font-family: var(--mono); font-size: 12px;
      letter-spacing: 0.04em;
      color: var(--canvas-fg);
    }
    .nc-diff-header {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase;
      color: var(--canvas-fg-muted);
    }
    .nc-diff-row {
      display: grid; grid-template-columns: 80px 1fr; gap: 12px;
      line-height: 1.5;
    }
    .nc-diff-row .k {
      color: var(--canvas-fg-muted);
      font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase;
    }
    .nc-diff-row .v { display: flex; flex-direction: column; gap: 2px; }
    .nc-diff-row .old { color: var(--canvas-fg-muted); text-decoration: line-through; text-decoration-color: rgba(176,58,46,0.5); }
    .nc-diff-row .new { color: var(--canvas-fg-strong); }
    .nc-diff-row .added   { color: var(--accent); }
    .nc-diff-row .removed { color: #c97b6e; text-decoration: line-through; text-decoration-color: rgba(176,58,46,0.5); }
    .nc-diff-row .kept    { color: var(--canvas-fg-muted); }
    .nc-diff-unchanged {
      font-size: 10px; letter-spacing: 0.08em;
      color: var(--canvas-fg-muted);
      padding-top: 4px; border-top: 1px dotted var(--canvas-rule);
    }
    .nc-diff-error {
      color: #c97b6e; font-family: var(--serif); font-style: italic;
    }
    .nc-diff-actions {
      display: flex; gap: 6px; padding-top: 6px;
    }

    /* List view — grid of filtered photos with checkboxes, paired with
       a sticky bulk-action bar at the top. Bulk operations run the same
       PUT /api/photo/:id flow per selected id, so saves are append-only
       human events just like single-photo edits. */
    .list-view {
      height: calc(100vh - 62px);
      display: flex; flex-direction: column;
      box-sizing: border-box;
    }
    .list-actions {
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
      padding: 12px 24px;
      border-bottom: 1px solid var(--canvas-rule);
      background: var(--canvas);
      position: sticky; top: 0; z-index: 5;
    }
    .list-actions .bar-divider { width: 1px; height: 22px; background: var(--canvas-rule); margin: 0 4px; }
    .list-selected-count {
      font-family: var(--mono); font-size: 11px;
      letter-spacing: 0.12em; text-transform: uppercase;
      color: var(--canvas-fg);
    }
    .list-selected-count strong { color: var(--canvas-fg-strong); }
    .bulk-control { display: flex; align-items: center; gap: 6px; }
    .bulk-control .bulk-label {
      font-family: var(--mono); font-size: 10px;
      letter-spacing: 0.14em; text-transform: uppercase;
      color: var(--canvas-fg-muted);
    }
    .bulk-control select,
    .bulk-control input {
      background: transparent; color: var(--canvas-fg-strong);
      border: 1px solid var(--canvas-rule); border-radius: 0;
      font-family: var(--mono); font-size: 10.5px;
      font-weight: 800;
      letter-spacing: 0.18em; text-transform: uppercase;
      padding: 8px 10px; line-height: 1;
    }
    .bulk-control input { width: 220px; }

    .list-grid {
      flex: 1; overflow-y: auto;
      padding: 16px 24px;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 12px;
      align-content: start;
    }
    .list-empty {
      grid-column: 1 / -1;
      padding: 80px 0;
      text-align: center;
      font-family: var(--mono); font-size: 12px;
      letter-spacing: 0.12em; text-transform: uppercase;
      color: var(--canvas-fg-muted);
    }
    .list-card {
      position: relative;
      display: flex; flex-direction: column;
      border: 1px solid var(--canvas-rule);
      background: rgba(255,255,255,0.015);
      cursor: pointer;
      transition: border-color 140ms ease, background 140ms ease;
    }
    .list-card:hover { border-color: var(--canvas-rule-strong); }
    .list-card.selected {
      border-color: var(--accent);
      background: rgba(58,107,74,0.10);
    }
    /* Photos already marked as duplicates render at reduced opacity
       and desaturated so they recede visually. Still selectable —
       bulk actions intentionally still work on them, since a curator
       may want to bulk-clear themes on a whole dupe cluster — they
       just shouldn't be the curator's primary attention. */
    .list-card.is-dupe { opacity: 0.45; }
    .list-card.is-dupe .list-card-img { filter: grayscale(1); }
    .list-card.is-dupe:hover { opacity: 0.85; }
    .list-card.is-dupe.selected { opacity: 1; }
    .list-card-dupe-badge {
      position: absolute; top: 6px; right: 6px;
      font-family: var(--mono); font-size: 9px;
      letter-spacing: 0.14em; text-transform: uppercase;
      background: rgba(0,0,0,0.65); color: var(--canvas-fg-strong);
      padding: 2px 6px; border-radius: 2px;
      pointer-events: none;
    }
    .list-card-img {
      width: 100%; aspect-ratio: 4/3; object-fit: cover;
      display: block; background: #0a0c0a;
    }
    .list-card-meta {
      padding: 8px 10px;
      display: flex; flex-direction: column; gap: 3px;
      font-family: var(--mono); font-size: 10px;
      letter-spacing: 0.06em; color: var(--canvas-fg);
      min-height: 48px;
    }
    .list-card-meta .country {
      color: var(--canvas-fg-strong);
      text-transform: uppercase; letter-spacing: 0.14em;
    }
    .list-card-meta .themes {
      color: var(--canvas-fg-muted); font-size: 9px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .list-card-meta .id-line {
      color: var(--canvas-fg-muted); font-size: 9px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .list-card-check {
      position: absolute; top: 6px; left: 6px;
      width: 22px; height: 22px;
      accent-color: var(--accent);
      cursor: pointer;
    }

    /* Drag-and-drop reordering. The card is the drag target; a 2px
       accent rule renders at the leading or trailing edge of the
       hovered card during a drag to indicate the insertion point.
       Cards stay normally draggable; the curator drops onto an adjacent
       card and the JS splices the dragged card into that slot. */
    .list-card[draggable="true"] { cursor: grab; }
    .list-card[draggable="true"]:active { cursor: grabbing; }
    .list-card.dragging { opacity: 0.35; }
    .list-card.drop-before {
      box-shadow: inset 3px 0 0 0 var(--accent);
    }
    .list-card.drop-after {
      box-shadow: inset -3px 0 0 0 var(--accent);
    }
    .list-card.drop-before.drop-after {
      box-shadow: inset 3px 0 0 0 var(--accent),
                  inset -3px 0 0 0 var(--accent);
    }
    /* When any filter is active, reordering is disabled — the cards
       fall back to normal pointers and we suppress the cursor change.
       The reorder-status label explains why. */
    .list-view.filters-active .list-card { cursor: pointer; }
    .reorder-status {
      font-family: var(--mono); font-size: 10px;
      letter-spacing: 0.10em; text-transform: uppercase;
      color: var(--canvas-fg-muted);
    }
    .reorder-status.disabled { color: #c97b6e; }
    .reorder-status.dirty { color: var(--accent); color: var(--canvas-fg-strong); }
    .list-card-rank {
      position: absolute; top: 6px; right: 6px;
      font-family: var(--mono); font-size: 10px; font-weight: 800;
      letter-spacing: 0.08em;
      background: rgba(0,0,0,0.65); color: var(--canvas-fg-strong);
      padding: 2px 6px; border-radius: 2px;
      pointer-events: none;
    }
    /* Rank badge collides with the dupe badge in the same corner;
       when both apply we stack the rank below the dupe badge. */
    .list-card.is-dupe .list-card-rank { top: 30px; }

    /* ── Sort mode ─────────────────────────────────────────────────
       A focused mode for drag-and-drop reordering. Bulk theme/country
       controls collapse out of the way so the action bar reads as
       "this is a sorting workspace". Sort mode reuses the existing
       checkbox selection model: any selected cards travel together
       when one of them is dragged (multi-move). Selection itself is
       click-toggle as before, with shift+click for range select. */
    .list-view:not(.sort-mode) .sort-only { display: none; }
    .list-view.sort-mode .bulk-control,
    .list-view.sort-mode .bulk-only { display: none; }
    .list-view.sort-mode #sort-mode-btn {
      background: var(--canvas-fg-strong); color: var(--canvas);
      border-color: var(--canvas-fg-strong);
    }
    /* Selected cards in sort mode get a clearer "this is travelling
       with the drag" affordance — accent-colored corner triangle so the
       curator can see at a glance which cards will move together. */
    .list-view.sort-mode .list-card.selected::before {
      content: '';
      position: absolute; top: 0; left: 0;
      border: 14px solid transparent;
      border-top-color: var(--accent);
      border-left-color: var(--accent);
      pointer-events: none;
    }
    /* During an active drag, "+N" badge on the dragged card indicating
       how many additional photos are coming along. */
    .list-card-multi-badge {
      position: absolute; bottom: 6px; right: 6px;
      font-family: var(--mono); font-size: 10px; font-weight: 800;
      letter-spacing: 0.06em;
      background: var(--accent); color: #fff;
      padding: 3px 7px; border-radius: 2px;
      pointer-events: none;
    }
  </style>
</head>
<body>
  <header class="bar">
    <strong style="color:var(--canvas-fg-strong)">Photo Review</strong>
    <select id="filter">
      <option value="all">All</option>
      <option value="no-country">Missing country</option>
      <option value="no-caption">Missing caption</option>
      <option value="no-theme">Missing theme</option>
      <option value="no-subcategory">No sub-category (only top-level theme)</option>
      <option value="wildlife-no-species">Wildlife without species</option>
      <option value="wildlife-mixed">Wildlife with other top-level categories</option>
      <option value="legacy-themes">Legacy categories only (has non-canonical tag)</option>
      <option value="no-alt">Missing alt</option>
      <option value="no-notes">No curator notes</option>
      <option value="has-notes">Has curator notes</option>
      <option value="potential-dupes">Has potential dupes</option>
      <option value="likely-dupes">Has likely dupes (T1+T2)</option>
      <option value="no-dupes">No dupe candidates</option>
      <option value="dupes">Marked as dupe</option>
      <option value="featured">Featured</option>
      <option value="graphic">Graphic</option>
      <option value="needs-edit">Needs edit</option>
      <option value="omitted">Marked omit</option>
    </select>
    <select id="source-filter">
      <option value="all">All sources</option>
      <option value="photography">photography</option>
      <option value="me">me / sabbatical</option>
      <option value="atlas">atlas</option>
    </select>
    <select id="country-filter">
      <option value="">All countries</option>
      ${COUNTRIES.map((c) => `<option value="${c.code}">${c.name}</option>`).join('')}
    </select>
    <select id="theme-filter">
      <option value="">All categories</option>
      <optgroup label="Canonical">
        ${CANONICAL_THEMES.map((t) => `<option value="${t}">${t}</option>`).join('')}
      </optgroup>
      ${(() => {
        // Tags that exist on at least one photo but aren't in the
        // canonical tree. Surfaced so curators can find legacy-tagged
        // photos and re-tag them; not offered in the bulk-edit widgets
        // (those only let you add/remove canonical ids).
        const legacy = themes.filter((t) => !CANONICAL_THEME_SET.has(t));
        if (legacy.length === 0) return '';
        return `<optgroup label="Legacy / orphan">${legacy.map((t) => `<option value="${t}">${t}</option>`).join('')}</optgroup>`;
      })()}
    </select>
    <button id="prev-btn">← Prev (k)</button>
    <button id="next-btn">Next (j) →</button>
    <span class="progress">
      <strong id="cursor">0</strong> / <strong id="total">0</strong>
      <span style="margin-left:14px">edited <strong id="edited-count">0</strong></span>
    </span>
    <span class="bar-divider"></span>
    <button class="mic-btn" id="mic-btn" type="button" title="Toggle voice dictation (browser Web Speech API)">
      <span class="mic-dot"></span>
      <span id="mic-label">Record</span>
    </button>
    <span class="mic-status" id="mic-status"></span>
    <span class="mic-explainer">saves to current photo · auto-commits on nav</span>
    <span class="bar-divider"></span>
    <button id="list-view-btn" type="button">List view</button>
    <button id="all-notes-btn" type="button">All notes</button>
  </header>
  <main>
    <div class="left">
      <div class="photo-pane">
        <div class="meta-overlay" id="meta-overlay">—</div>
        <img id="photo" src="" alt="" />
      </div>
      <div class="dupe-strip">
        <div class="dupe-strip-header">
          <span>Possible duplicates</span>
          <span style="display:flex; gap:14px; align-items:center;">
            <button id="show-all-dupes-btn" class="ghost" type="button"
              title="Open every photo sorted by visual similarity">Show all →</button>
            <span id="dupe-count" style="color:var(--canvas-fg)">—</span>
          </span>
        </div>
        <div class="dupe-strip-list" id="dupe-list">
          <div class="no-dupes">scanning…</div>
        </div>
      </div>
    </div>

    <div class="form-pane">
      <div class="id-strip" id="id-strip">—</div>

      <div class="ai-summary">
        <h3>Merged labels (AI + refined + ingest)</h3>
        <div class="ai-field"><span class="ai-label">Caption</span><span class="ai-value" id="ai-caption">—</span></div>
        <div class="ai-field"><span class="ai-label">Alt</span><span class="ai-value" id="ai-alt">—</span></div>
        <div class="ai-field"><span class="ai-label">Country</span><span class="ai-value mono" id="ai-country">—</span></div>
        <div class="ai-field"><span class="ai-label">Theme</span><span class="ai-value mono" id="ai-theme">—</span></div>
        <div class="ai-field"><span class="ai-label">Species</span><span class="ai-value mono" id="ai-species">—</span></div>
        <div class="ai-field"><span class="ai-label">Entities</span><span class="ai-value mono" id="ai-entities">—</span></div>
        <div class="ai-field"><span class="ai-label">Story</span><span class="ai-value" id="ai-story">—</span></div>
      </div>

      <div class="prior-notes" id="prior-notes-block" style="display:none">
        <div class="prior-notes-header">
          <span>Prior notes</span>
          <span id="prior-notes-count" class="count">—</span>
        </div>
        <div class="prior-notes-list" id="prior-notes-list"></div>
      </div>

      <div class="notes-block">
        <label for="curator-notes">New note (this session)</label>
        <div class="hint">
          Write freeform — or hit <code>Record</code> in the top bar and
          talk. Corrections, context, what really happened, names,
          locations, mood, why this shot matters. Each save creates a
          new JSONL event; the merger concatenates every prior note
          before feeding it to the refinement prompt.
        </div>
        <textarea id="curator-notes" rows="10" placeholder="e.g. This is actually Antarctica, not Argentina — taken on the cruise from Ushuaia, Nov 28 2024. The penguin in foreground is an emperor; the others are gentoos."></textarea>
        <div class="interim-preview" id="interim-preview"></div>
      </div>

      <div class="toggles">
        <label><input id="featured" type="checkbox" /> Featured</label>
        <label><input id="graphic" type="checkbox" /> Graphic</label>
        <label class="triage-toggle triage-edit"><input id="needs_edit" type="checkbox" /> Needs edit</label>
        <label class="triage-toggle triage-omit"><input id="omit" type="checkbox" /> Omit</label>
        <!-- Global ranking. Lower wins (top of list = best). Empty
             clears it (merger drops the field). Bulk reordering still
             lives in the list view's drag-and-drop sort mode, but this
             input lets the curator nudge a single photo's rank from
             the main editor without leaving the photo. -->
        <div class="dupe-input">
          <span>Sort order (lower = better)</span>
          <input id="sort_order" type="number" step="1" placeholder="∅ unranked" style="width:120px" />
        </div>
        <div class="dupe-input">
          <span>Dupe of (namespaced id)</span>
          <input id="dupeOf" type="text" placeholder="e.g. me-travel-09 or atlas-india" />
        </div>
      </div>

      <div class="structured collapsed" id="structured">
        <div class="structured-header" id="structured-toggle">
          <h3>Structured overrides <span style="color:var(--canvas-fg);font-weight:400;letter-spacing:0.06em">(click to expand — these win over the LLM-refined values for the same field)</span></h3>
          <button class="ghost" type="button" id="structured-arrow">expand</button>
        </div>
        <div class="structured-body">
          <div class="field-row">
            <div class="field" id="field-country">
              <label for="ov-country">Country slug</label>
              <select id="ov-country">
                <option value="">— none —</option>
                ${COUNTRIES.map((c) => `<option value="${c.code}">${c.name}</option>`).join('')}
              </select>
            </div>
            <div class="field" id="field-species">
              <label for="ov-species">Species</label>
              <input id="ov-species" type="text" placeholder="e.g. king penguin" />
            </div>
          </div>
          <div class="field-row">
            <div class="field" id="field-city">
              <label for="ov-city">City</label>
              <input id="ov-city" type="text" placeholder="e.g. Munich" />
            </div>
            <div class="field" id="field-state">
              <label for="ov-state">State / region</label>
              <input id="ov-state" type="text" placeholder="e.g. Bavaria" />
            </div>
          </div>
          <div class="field" id="field-caption">
            <label for="ov-caption">Caption (editorial)</label>
            <input id="ov-caption" type="text" />
          </div>
          <div class="field" id="field-alt">
            <label for="ov-alt">Alt (a11y descriptive)</label>
            <textarea id="ov-alt" rows="2"></textarea>
          </div>
          <div class="field" id="field-theme">
            <label for="ov-theme">Theme tags (comma-separated)</label>
            <input id="ov-theme" type="text" placeholder="wildlife, mammals, landscape, water, culture, people, …" />
          </div>
          <div class="field" id="field-story">
            <label for="ov-story">Story (longer narrative)</label>
            <textarea id="ov-story" rows="3"></textarea>
          </div>
          <div class="field" id="field-album_url">
            <label for="ov-album_url">Album URL</label>
            <input id="ov-album_url" type="text" placeholder="https://milesmccrocklin.myportfolio.com/…" />
          </div>
        </div>
      </div>

      <div class="action-row">
        <button id="save-btn" class="primary">Save (s)</button>
        <button id="save-next-btn">Save & Next (Enter)</button>
        <button id="skip-btn">Skip</button>
      </div>
    </div>
  </main>
  <section class="all-notes" id="all-notes-view" style="display:none">
    <div class="all-notes-header">
      <h1>All curator notes</h1>
      <span class="count" id="all-notes-count">—</span>
    </div>
    <div id="all-notes-list"></div>
  </section>

  <!-- List view. Grid of filtered photos with per-card checkboxes,
       paired with a bulk-action bar for setting country / adding /
       removing themes across the selection. Reuses the existing
       filter set above, so the curator can drill down with the
       source/country/category dropdowns first, then bulk-edit. -->
  <section class="list-view" id="list-view" style="display:none">
    <div class="list-actions">
      <label class="list-select-all" style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-family:var(--mono);font-size:10.5px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;color:var(--canvas-fg);">
        <input id="list-select-all" type="checkbox" />
        Select all visible
      </label>
      <span class="list-selected-count"><strong id="list-selected-count">0</strong> selected / <strong id="list-visible-count">0</strong> visible</span>
      <span class="bar-divider"></span>

      <div class="bulk-control">
        <span class="bulk-label">Set country</span>
        <select id="bulk-country">
          <option value="">— pick —</option>
          ${COUNTRIES.map((c) => `<option value="${c.code}">${c.name}</option>`).join('')}
        </select>
        <button id="bulk-country-apply" type="button">Apply</button>
        <button id="bulk-country-clear" class="ghost" type="button" title="Clear country on selected">Clear</button>
      </div>

      <div class="bulk-control">
        <span class="bulk-label">Add theme</span>
        <!-- Datalist is the CANONICAL tree only — bulk-edit shouldn't
             let the curator accidentally add a legacy/orphan tag. The
             merger's LEGACY_THEME_REWRITES still translates anything
             the LLM emits, but human-driven bulk writes should match
             the current taxonomy out of the box. -->
        <input id="bulk-theme-add" type="text" list="bulk-themes-datalist" placeholder="wildlife, mammals, landscape, water, culture, …" />
        <datalist id="bulk-themes-datalist">
          ${CANONICAL_THEMES.map((t) => `<option value="${t}"></option>`).join('')}
        </datalist>
        <button id="bulk-theme-add-apply" type="button">Add</button>
      </div>

      <div class="bulk-control">
        <span class="bulk-label">Remove theme</span>
        <select id="bulk-theme-remove">
          <option value="">— pick —</option>
          <optgroup label="Canonical">
            ${CANONICAL_THEMES.map((t) => `<option value="${t}">${t}</option>`).join('')}
          </optgroup>
          ${(() => {
            // Surface legacy tags here too — the curator can't ADD them
            // any more, but they may still want to REMOVE stragglers
            // from individual photos by hand-picking them in bulk.
            const legacy = themes.filter((t) => !CANONICAL_THEME_SET.has(t));
            if (legacy.length === 0) return '';
            return `<optgroup label="Legacy / orphan">${legacy.map((t) => `<option value="${t}">${t}</option>`).join('')}</optgroup>`;
          })()}
        </select>
        <button id="bulk-theme-remove-apply" type="button">Remove</button>
      </div>

      <span class="bar-divider bulk-only"></span>
      <div class="bulk-control bulk-only">
        <span class="bulk-label">Featured</span>
        <button id="bulk-featured-mark" type="button" title="Mark selected as featured (eligible to rank in sort mode)">Mark</button>
        <button id="bulk-featured-unmark" class="ghost" type="button" title="Unmark selected as featured">Unmark</button>
      </div>

      <span class="bar-divider bulk-only"></span>
      <div class="bulk-control bulk-only">
        <span class="bulk-label">Omit</span>
        <button id="bulk-omit-mark" class="danger" type="button" title="Mark selected as omitted (dropped from merged output)">Mark</button>
        <button id="bulk-omit-unmark" class="ghost" type="button" title="Unmark omit on selected">Unmark</button>
      </div>

      <span class="bar-divider bulk-only"></span>
      <button id="bulk-themes-clear" class="ghost bulk-only" type="button" title="Clear ALL themes on selected">Clear all themes</button>

      <span class="bar-divider"></span>
      <button id="sort-mode-btn" type="button" title="Toggle drag-and-drop sort mode for featured photos">Sort mode</button>
      <span class="reorder-status" id="reorder-status">Sort mode off</span>
      <button id="reorder-save" class="sort-only" type="button" disabled>Save order</button>
      <button id="reorder-reset" class="ghost sort-only" type="button" disabled>Reset</button>
    </div>
    <div class="list-grid" id="list-grid"></div>
  </section>
  <div class="saved-flash" id="saved-flash">saved</div>

  <!-- Dupe-mark modal. Opened by the "mark dupe" button on any dupe-
       strip card. Curator picks which photo is canonical; on confirm
       we PUT dupeOf=<canonical> on the OTHER photo. The merger's
       dupe-merge pass folds metadata across both sides on the next
       merge run. -->
  <div class="dupe-modal" id="dupe-modal">
    <div class="dupe-modal-backdrop" id="dupe-modal-backdrop"></div>
    <div class="dupe-modal-card">
      <h2>Mark duplicate · pick the canonical</h2>
      <div class="dupe-modal-side-by-side">
        <label class="dupe-choice selected" id="dupe-choice-left">
          <div class="dupe-choice-header">
            <input type="radio" name="dupe-canonical" value="left" checked />
            <span id="dupe-left-id">—</span>
            <span class="role" id="dupe-left-role">canonical</span>
          </div>
          <img id="dupe-left-img" src="" alt="" />
          <div class="dupe-choice-meta" id="dupe-left-meta"></div>
        </label>
        <label class="dupe-choice" id="dupe-choice-right">
          <div class="dupe-choice-header">
            <input type="radio" name="dupe-canonical" value="right" />
            <span id="dupe-right-id">—</span>
            <span class="role" id="dupe-right-role">duplicate</span>
          </div>
          <img id="dupe-right-img" src="" alt="" />
          <div class="dupe-choice-meta" id="dupe-right-meta"></div>
        </label>
      </div>
      <div class="dupe-modal-explain">
        Selected becomes the canonical (stays visible).
        The other is hidden in the manifest; its metadata is folded into
        the canonical at the next <code>bun run scripts/merge-labels.ts</code>.
      </div>
      <div class="dupe-modal-actions">
        <button type="button" id="dupe-modal-cancel">Cancel</button>
        <button type="button" id="dupe-modal-confirm" class="primary">Mark dupe</button>
      </div>
    </div>
  </div>

  <!-- All-candidates modal. Opened by the "Show all →" button on the
       dupe strip. Renders every photo sorted by visual similarity to
       the current one, so the curator can scroll past the top-5 strip
       and pick from the wider set when no obvious match is visible. -->
  <div class="dupe-modal" id="dupes-all-modal">
    <div class="dupe-modal-backdrop" id="dupes-all-backdrop"></div>
    <div class="dupe-modal-card" style="max-width: 1400px">
      <h2>All candidates · sorted by visual similarity</h2>
      <div class="dupes-all-explain dupe-modal-explain">
        Every photo ranked by perceptual-hash distance to the current
        one. Closest matches appear first. Click any tile to open the
        canonical-chooser modal pre-populated with that pair.
      </div>
      <div class="dupes-all-grid" id="dupes-all-grid">
        <div class="no-dupes">scanning…</div>
      </div>
      <div class="dupe-modal-actions">
        <button type="button" id="dupes-all-close">Close</button>
      </div>
    </div>
  </div>

  <script>
    // ISO-3 code → display name map, server-rendered from the shared
    // locations table. Keeps the storage layer all-codes while the UI
    // shows the readable country name (filter chips, dropdown labels,
    // AI-summary row, etc).
    const COUNTRY_NAME_BY_CODE = ${JSON.stringify(Object.fromEntries(COUNTRIES.map((c) => [c.code, c.name])))};
    function countryDisplay(code) {
      if (!code) return '';
      return COUNTRY_NAME_BY_CODE[code] || code;
    }
    // Canonical theme ids + legacy rewrites — server-rendered from
    // src/photography/categories.ts so the client-side filters and
    // bulk-edit widgets share the same source of truth as the merger.
    // Without this injection, references to CANONICAL_THEME_SET /
    // LEGACY_THEME_REWRITES below would be ReferenceErrors in the
    // browser and every "Add theme" click would silently no-op.
    const CANONICAL_THEME_SET = new Set(${JSON.stringify([...CANONICAL_THEME_SET])});
    const LEGACY_THEME_REWRITES = ${JSON.stringify(LEGACY_THEME_REWRITES)};
    let entries = [];
    let filtered = [];
    let cursor = 0;
    let edited = 0;
    let currentDirty = false;

    function $(id) { return document.getElementById(id); }
    function flashSaved(text, merging) {
      const f = $('saved-flash');
      f.textContent = text || 'saved';
      f.classList.toggle('merging', !!merging);
      f.classList.add('show');
      setTimeout(() => f.classList.remove('show'), 800);
    }

    async function loadAll() {
      const res = await fetch('/api/list');
      entries = await res.json();
      applyFilter();
    }

    // Optional opts lets callers (the dupe-confirm flow, in-place
    // save flows that refetch /api/list) keep the user's place across
    // a filter rebuild. Without preserveId we reset to 0 — the
    // existing behavior for plain filter-changes (user switches
    // dropdown), which intentionally jumps to the top of the new list.
    //   preserveId  — try to land cursor on this entry id in the new
    //                 filtered list. Falls through to fallbackPos if
    //                 the id was filtered out.
    //   fallbackPos — clamp-to-length fallback when preserveId misses.
    //                 Lets the user stay "near where they were" even
    //                 when the entry they just edited drops out of the
    //                 current filter (e.g. they marked the current
    //                 photo as a dupe while viewing the No-Dupes filter).
    function applyFilter(opts) {
      const f = $('filter').value;
      const sourceFilter = $('source-filter').value;
      // Country / category dropdowns. Empty value ("") means "no
      // filter on this dimension". Country matches against the ISO-3
      // code stored on the entry; category matches against any theme
      // tag on the entry (case-sensitive — themes are normalized at
      // ingest, so casing is consistent).
      const countryFilter = $('country-filter').value;
      const themeFilter = $('theme-filter').value;
      filtered = entries.filter((e) => {
        if (sourceFilter !== 'all' && e.source !== sourceFilter) return false;
        if (countryFilter && e.country !== countryFilter) return false;
        if (themeFilter && !(e.theme ?? []).includes(themeFilter)) return false;
        if (f === 'no-country') return !e.country;
        if (f === 'no-caption') return !e.caption;
        if (f === 'no-theme') return !e.theme || e.theme.length === 0;
        if (f === 'no-subcategory') {
          // Surfaces photos the curator should drill in on. The
          // classifier tagged a top-level bucket (wildlife/landscape/
          // culture) but produced no CANONICAL leaf — so the photo
          // lands in the top-level filter without ever appearing
          // under a sub-cat chip.
          //
          // Legacy / non-canonical tags don't count as a sub-category
          // (they'll be cleaned out of the data eventually; treating
          // them as "leaves" would hide photos that actually need a
          // curator pass). Only canonical sub-cat ids satisfy the
          // "has leaf" check.
          const themes = e.theme ?? [];
          if (themes.length === 0) return false;
          const TOP_LEVEL = new Set(['wildlife', 'landscape', 'culture']);
          const hasTop = themes.some((t) => TOP_LEVEL.has(t));
          const hasCanonicalLeaf = themes.some((t) =>
            CANONICAL_THEME_SET.has(t) && !TOP_LEVEL.has(t));
          return hasTop && !hasCanonicalLeaf;
        }
        if (f === 'wildlife-no-species') {
          // Wildlife shot the classifier didn't bind to a species
          // name. Often means it could only get to a class
          // (mammals/birds/...) — worth a curator pass to drop the
          // common-English name in.
          const themes = e.theme ?? [];
          return themes.includes('wildlife')
            && (!e.species || !String(e.species).trim());
        }
        if (f === 'wildlife-mixed') {
          // Photos in the wildlife subtree that ALSO carry a canonical
          // tag from another top-level branch (landscape/culture). The
          // classifier sometimes double-buckets a shot — e.g. a bird
          // perched on architecture lands as wildlife + culture +
          // architecture. Curator can decide whether to drop one tag
          // or keep the cross-categorization.
          const themes = e.theme ?? [];
          if (themes.length === 0) return false;
          const hasWildlife = themes.some((t) => WILDLIFE_SUBTREE.has(t));
          if (!hasWildlife) return false;
          return themes.some((t) =>
            CANONICAL_THEME_SET.has(t) && !WILDLIFE_SUBTREE.has(t));
        }
        if (f === 'legacy-themes') {
          // Surfaces photos still carrying tags that aren't in the
          // current canonical taxonomy — anything the LLM hallucinated
          // ("travel", "safari", "conservation", "polar", …) plus
          // retired treatment tags ("monochrome", "minimalist",
          // "reflection", …) and any pre-migration sub-cats that
          // didn't get rewritten ("astrophotography", "wetlands", …).
          // Catch-all for "this photo needs a tag pass."
          const themes = e.theme ?? [];
          if (themes.length === 0) return false;
          return themes.some((t) => !CANONICAL_THEME_SET.has(t));
        }
        if (f === 'no-alt') return !e.alt;
        if (f === 'no-notes') return !e.has_notes;
        if (f === 'has-notes') return !!e.has_notes;
        if (f === 'potential-dupes') return !!e._dupes && e._dupes.count > 0;
        if (f === 'likely-dupes') return !!e._dupes && e._dupes.likelyCount > 0;
        if (f === 'no-dupes') return !e._dupes || e._dupes.count === 0;
        if (f === 'dupes') return !!e.dupeOf;
        if (f === 'featured') return !!e.featured;
        if (f === 'graphic') return !!e.graphic;
        if (f === 'needs-edit') return !!e.needs_edit;
        if (f === 'omitted') return !!e.omit;
        return true;
      });
      // Apply the curator's ranking — same logic the manifest builder
      // uses, so what the review tool surfaces matches what'll ship:
      //   1. featured first, sorted by sort_order ascending (lower =
      //      better, top of list = best photo)
      //   2. non-featured after, keeping their insertion order
      filtered.sort((a, b) => {
        const af = a.featured ? 1 : 0;
        const bf = b.featured ? 1 : 0;
        if (af !== bf) return bf - af;
        if (af) {
          const ao = (typeof a.sort_order === 'number') ? a.sort_order : Infinity;
          const bo = (typeof b.sort_order === 'number') ? b.sort_order : Infinity;
          return ao - bo;
        }
        return 0;
      });
      const preserveId = opts && opts.preserveId;
      const fallbackPos = opts && typeof opts.fallbackPos === 'number'
        ? opts.fallbackPos : 0;
      if (preserveId) {
        const idx = filtered.findIndex((e) => e.id === preserveId);
        cursor = idx >= 0
          ? idx
          : Math.max(0, Math.min(fallbackPos, filtered.length - 1));
      } else {
        cursor = 0;
      }
      $('total').textContent = filtered.length;
      render();
      // List view shows the filtered array as a grid — keep it in
      // sync when the filter dropdowns change while the curator is in
      // list mode. The typeof check guards the initial loadAll() call,
      // which fires before the viewMode let-binding is initialized.
      if (typeof viewMode !== 'undefined' && viewMode === 'list') {
        renderList();
      }
    }

    function fmtArr(a) { return a && a.length ? a.join(', ') : ''; }
    function fmtPriorTs(iso) {
      try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return iso;
        const pad = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
          + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      } catch { return iso; }
    }
    function renderPriorNotes(priors) {
      const block = $('prior-notes-block');
      const list = $('prior-notes-list');
      const count = $('prior-notes-count');
      list.innerHTML = '';
      if (!priors || priors.length === 0) {
        block.style.display = 'none';
        return;
      }
      block.style.display = 'flex';
      count.textContent = priors.length + (priors.length === 1 ? ' note' : ' notes');
      for (const p of priors) {
        const el = document.createElement('div');
        el.className = 'prior-note';
        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = fmtPriorTs(p.ts);
        const body = document.createTextNode(p.text);
        el.appendChild(meta);
        el.appendChild(body);
        list.appendChild(el);
      }
    }
    function fillAiField(elId, value) {
      const el = $(elId);
      if (value == null || value === '') { el.textContent = '—'; el.classList.add('empty'); }
      else { el.textContent = value; el.classList.remove('empty'); }
    }

    async function render() {
      if (filtered.length === 0) {
        $('cursor').textContent = '0'; $('total').textContent = '0';
        $('meta-overlay').textContent = 'no photos match the current filter';
        $('photo').src = '';
        $('dupe-list').innerHTML = '<div class="no-dupes">—</div>';
        return;
      }
      const e = filtered[cursor];
      $('cursor').textContent = (cursor + 1);
      $('total').textContent = filtered.length;
      $('id-strip').innerHTML =
        '<code>' + e.id + '</code>' +
        '<span class="sep">·</span>' +
        '<code>' + e.src + '</code>' +
        '<span class="sep">·</span>' +
        'aspect <code>' + (e.aspect ?? '—') + '</code>' +
        '<span class="sep">·</span>' +
        'date <code id="date-hint">…</code>';
      $('photo').src = '/media/' + e.src;
      $('photo').alt = e.alt || e.caption || e.id;
      $('meta-overlay').innerHTML =
        e.id + (e.country ? ' · ' + countryDisplay(e.country) : '') +
        ' <span class="source-pill">' + e.source + '</span>';
      fillAiField('ai-caption', e.caption);
      fillAiField('ai-alt', e.alt);
      // Show the readable country name in the read-only AI summary;
      // storage is still the ISO-3 code. The override dropdown below
      // works in codes (option values), so what saves to the labels
      // pipeline remains canonical.
      fillAiField('ai-country', e.country ? countryDisplay(e.country) : null);
      fillAiField('ai-theme', fmtArr(e.theme));
      fillAiField('ai-species', e.species);
      fillAiField('ai-entities', fmtArr(e.entities));
      fillAiField('ai-story', e.story);
      // New-note textarea always starts empty. Prior notes (every
      // saved curator_notes event for this photo) render in their own
      // read-only block above, with timestamps, so the curator can
      // see what they wrote before without it polluting the input.
      $('curator-notes').value = '';
      renderPriorNotes(e.prior_notes ?? []);
      $('dupeOf').value = e.dupeOf ?? '';
      $('featured').checked = !!e.featured;
      $('graphic').checked = !!e.graphic;
      $('needs_edit').checked = !!e.needs_edit;
      $('omit').checked = !!e.omit;
      $('sort_order').value =
        (typeof e.sort_order === 'number') ? String(e.sort_order) : '';
      // Pre-populate structured-override inputs with the current merged
      // value. The dirty set tracks which inputs the curator has actually
      // touched so we only send changed fields. A field shows "edited"
      // next to its label when dirty.
      $('ov-caption').value = e.caption ?? '';
      $('ov-alt').value = e.alt ?? '';
      $('ov-country').value = e.country ?? '';
      $('ov-city').value = e.city ?? '';
      $('ov-state').value = e.state ?? '';
      $('ov-species').value = e.species ?? '';
      $('ov-theme').value = (e.theme ?? []).join(', ');
      $('ov-story').value = e.story ?? '';
      $('ov-album_url').value = e.album_url ?? '';
      dirtyOverrides.clear();
      for (const f of OVERRIDE_FIELDS) {
        document.getElementById('field-' + f)?.classList.remove('dirty');
      }
      fetch('/api/hint/' + encodeURIComponent(e.id))
        .then((r) => r.json())
        .then((h) => { const d = document.getElementById('date-hint'); if (d) d.textContent = h.shootDate || '(none)'; })
        .catch(() => { const d = document.getElementById('date-hint'); if (d) d.textContent = '(error)'; });
      renderDupes(e.id);
      const ip = document.getElementById('interim-preview');
      if (ip) ip.textContent = '';
      currentDirty = false;
    }

    async function renderDupes(id) {
      const listEl = $('dupe-list');
      listEl.innerHTML = '<div class="no-dupes">scanning…</div>';
      $('dupe-count').textContent = '—';
      try {
        const res = await fetch('/api/dupes/' + encodeURIComponent(id));
        const data = await res.json();
        const dupes = data.dupes || [];
        $('dupe-count').textContent = dupes.length + ' shown';
        if (dupes.length === 0) { listEl.innerHTML = '<div class="no-dupes">No similar photos.</div>'; return; }
        listEl.innerHTML = '';
        const REASON_LABEL = {
          'same-date': 'Same date',
          'visual-strict': 'Visual ≤4',
          'visual-loose': 'Visual ≤8',
        };
        for (const d of dupes) {
          const card = document.createElement('div');
          card.className = 'dupe-card tier-' + d.tier;
          const dateBadge = d.shootDate ? ' · ' + d.shootDate : '';
          card.title = d.id + dateBadge + ' · dHash ' + d.distance;
          const img = document.createElement('img');
          img.src = '/media/' + d.src; img.alt = d.id; img.loading = 'lazy';
          const reason = document.createElement('div');
          reason.className = 'reason';
          reason.textContent = REASON_LABEL[d.reason] || d.reason;
          const meta = document.createElement('div');
          meta.className = 'meta';
          const dateLabel = d.shootDate || 'no date';
          meta.innerHTML = '<span>' + d.source + ' · ' + dateLabel + '</span><span class="dist">d=' + d.distance + '</span>';
          const idLabel = document.createElement('div');
          idLabel.className = 'id-label'; idLabel.textContent = d.id;
          const actions = document.createElement('div');
          actions.className = 'dupe-card-actions';
          const goBtn = document.createElement('button');
          goBtn.textContent = 'open';
          goBtn.onclick = (ev) => {
            ev.stopPropagation();
            const idx = filtered.findIndex((x) => x.id === d.id);
            if (idx >= 0) { cursor = idx; render(); }
            else alert(d.id + ' not in current filter view');
          };
          const dupeBtn = document.createElement('button');
          dupeBtn.textContent = 'mark dupe';
          dupeBtn.onclick = (ev) => {
            ev.stopPropagation();
            // Open the canonical-chooser modal. Curator picks which
            // side is canonical; on confirm we PUT dupeOf on the other.
            openDupeModal(filtered[cursor], d.id);
          };
          actions.appendChild(goBtn); actions.appendChild(dupeBtn);
          card.appendChild(img); card.appendChild(reason); card.appendChild(meta);
          card.appendChild(idLabel); card.appendChild(actions);
          listEl.appendChild(card);
        }
      } catch (err) {
        listEl.innerHTML = '<div class="no-dupes">dupe lookup failed</div>';
      }
    }

    // Structured-override fields the curator can set explicitly via the
    // collapsed override panel. Tracked separately from notes/toggles —
    // we only send fields the curator has actually edited in this
    // session, otherwise opening + saving a photo would re-assert every
    // existing value as a new human event for no reason.
    const OVERRIDE_FIELDS = ['caption','alt','country','city','state','species','theme','story','album_url'];
    const dirtyOverrides = new Set();
    function collectForm() {
      const e = filtered[cursor];
      const out = {
        curator_notes: $('curator-notes').value.trim() || undefined,
        dupeOf: $('dupeOf').value.trim() || undefined,
        featured: $('featured').checked || undefined,
        graphic: $('graphic').checked || undefined,
      };
      if (e) {
        const rawOrder = $('sort_order').value.trim();
        const curOrder = (typeof e.sort_order === 'number') ? String(e.sort_order) : '';
        if (rawOrder !== curOrder) {
          if (rawOrder === '') {
            out.sort_order = '';
          } else {
            const n = Number(rawOrder);
            if (Number.isFinite(n)) out.sort_order = n;
          }
        }
      }
      // Triage flags (needs_edit / omit) support unmarking — the
      // featured/graphic pattern above only ever sends "true", so the
      // curator can't unset those via the UI. For triage we explicitly
      // send '' on toggle-off so the merger's human-tier clear semantic
      // removes the field, and only when the state actually differs
      // from the loaded entry so we don't append noisy noop events.
      if (e) {
        if (!!e.needs_edit !== $('needs_edit').checked) {
          out.needs_edit = $('needs_edit').checked ? true : '';
        }
        if (!!e.omit !== $('omit').checked) {
          out.omit = $('omit').checked ? true : '';
        }
      }
      // Only include override fields the curator actually touched. An
      // edited-then-emptied input sends '' so the merger's human-tier
      // empty-clear semantic kicks in (curator gesture: "clear this").
      for (const f of OVERRIDE_FIELDS) {
        if (!dirtyOverrides.has(f)) continue;
        const el = $('ov-' + f);
        const raw = el ? el.value : '';
        if (f === 'theme') {
          const arr = raw.trim() ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
          out[f] = arr.length ? arr : '';
        } else {
          out[f] = raw.trim();
        }
      }
      return out;
    }

    async function save() {
      if (filtered.length === 0) return false;
      const e = filtered[cursor];
      const patch = collectForm();
      flashSaved('saving…', true);
      const res = await fetch('/api/photo/' + encodeURIComponent(e.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        alert('save failed: ' + res.status + ' ' + (await res.text()));
        return false;
      }
      Object.assign(e, patch);
      const masterIdx = entries.findIndex((m) => m.id === e.id);
      if (masterIdx >= 0) entries[masterIdx] = Object.assign({}, entries[masterIdx], patch);
      // Featured + sort_order drive the applyFilter sort. Reapply when
      // either changes so the just-saved photo jumps to its new slot
      // (and the list view re-orders to match). Anchor on the saved id
      // so the cursor follows the photo to wherever it landed.
      if ('featured' in patch || 'sort_order' in patch) {
        applyFilter({ preserveId: e.id, fallbackPos: cursor });
      }
      edited += 1;
      $('edited-count').textContent = edited;
      currentDirty = false;
      flashSaved();
      return true;
    }

    async function rebaseRecorderToCurrentPhoto() {
      if (!isRecording) return;
      const cur = $('curator-notes').value;
      recordingBase = cur + (cur && !/[\\s\\n]$/.test(cur) ? ' ' : '');
    }
    // Nav-save gate. The currentDirty flag drifts (Speech Recognition
    // writes textarea.value programmatically, which doesn't fire the
    // 'input' event; the mic's onresult does set currentDirty, but
    // edge cases — user opens the page, dictates, stops, clicks next
    // without focusing the textarea — sometimes leave it stale).
    // hasFormChanges compares the form directly against the loaded
    // entry, so "if there's text in notes, clicking next saves it" is
    // unconditionally true.
    function hasFormChanges() {
      if (filtered.length === 0) return false;
      const e = filtered[cursor];
      // Notes are append-only — the textarea starts empty per photo.
      // Any non-empty content is a new note worth saving.
      if ($('curator-notes').value.trim().length > 0) return true;
      const dupe = $('dupeOf').value.trim();
      if (dupe !== (e.dupeOf || '')) return true;
      if ($('featured').checked !== !!e.featured) return true;
      if ($('graphic').checked !== !!e.graphic) return true;
      if ($('needs_edit').checked !== !!e.needs_edit) return true;
      if ($('omit').checked !== !!e.omit) return true;
      const rawOrder = $('sort_order').value.trim();
      const curOrder = (typeof e.sort_order === 'number') ? String(e.sort_order) : '';
      if (rawOrder !== curOrder) return true;
      if (dirtyOverrides.size > 0) return true;
      return false;
    }
    async function next() {
      if (hasFormChanges()) await save();
      if (cursor < filtered.length - 1) { cursor += 1; render(); }
      await rebaseRecorderToCurrentPhoto();
    }
    async function prev() {
      if (hasFormChanges()) await save();
      if (cursor > 0) { cursor -= 1; render(); }
      await rebaseRecorderToCurrentPhoto();
    }
    async function saveAndNext() { if (await save()) await next(); }

    ['curator-notes','dupeOf','featured','graphic','needs_edit','omit']
      .forEach((id) => $(id).addEventListener('input', () => { currentDirty = true; }));

    // Structured-override inputs: mark dirty per field so collectForm
    // only sends the ones the curator actually touched. The .dirty
    // class on the field wrapper surfaces an "edited" badge next to
    // the label so the curator can see what they've changed at a glance.
    for (const f of OVERRIDE_FIELDS) {
      const el = $('ov-' + f);
      if (!el) continue;
      const evt = el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(evt, () => {
        dirtyOverrides.add(f);
        document.getElementById('field-' + f)?.classList.add('dirty');
        currentDirty = true;
      });
    }

    // Expand/collapse the structured-override section.
    $('structured-toggle').addEventListener('click', () => {
      const block = $('structured');
      block.classList.toggle('collapsed');
      $('structured-arrow').textContent =
        block.classList.contains('collapsed') ? 'expand' : 'collapse';
    });

    // ─── All-candidates modal ────────────────────────────────────
    // The strip below the photo only shows up to 5 tiered candidates.
    // When the curator knows there's a duplicate but it isn't in that
    // strip, this modal opens the full ranked list (~60 photos sorted
    // by dHash distance). Click any thumbnail → opens the canonical-
    // chooser modal pre-populated with that pair.
    async function openAllDupesModal() {
      if (filtered.length === 0) return;
      const current = filtered[cursor];
      if (!current) return;
      const grid = $('dupes-all-grid');
      grid.innerHTML = '<div class="no-dupes">scanning…</div>';
      $('dupes-all-modal').setAttribute('open', '');
      try {
        const res = await fetch('/api/dupes-all/' + encodeURIComponent(current.id));
        const data = await res.json();
        const dupes = data.dupes || [];
        if (dupes.length === 0) {
          grid.innerHTML = '<div class="no-dupes">No other photos to compare against.</div>';
          return;
        }
        grid.innerHTML = '';
        for (const d of dupes) {
          const card = document.createElement('div');
          card.className = 'dupes-all-card tier-' + d.tier;
          const dateLabel = d.shootDate || 'no date';
          card.title = d.id + ' · dHash ' + d.distance + ' · ' + dateLabel;
          const img = document.createElement('img');
          img.src = '/media/' + d.src; img.alt = d.id; img.loading = 'lazy';
          const meta = document.createElement('div');
          meta.className = 'meta';
          meta.innerHTML = '<span>' + d.source + '</span><span class="dist">d=' + d.distance + '</span>';
          const idLabel = document.createElement('div');
          idLabel.className = 'id-label'; idLabel.textContent = d.id;
          card.appendChild(img);
          card.appendChild(meta);
          card.appendChild(idLabel);
          card.onclick = () => {
            closeAllDupesModal();
            openDupeModal(filtered[cursor], d.id);
          };
          grid.appendChild(card);
        }
      } catch (err) {
        grid.innerHTML = '<div class="no-dupes">lookup failed</div>';
      }
    }
    function closeAllDupesModal() {
      $('dupes-all-modal').removeAttribute('open');
    }
    $('show-all-dupes-btn').addEventListener('click', openAllDupesModal);
    $('dupes-all-close').addEventListener('click', closeAllDupesModal);
    $('dupes-all-backdrop').addEventListener('click', closeAllDupesModal);

    // ─── Dupe-mark modal ──────────────────────────────────────────
    // Pops up when the curator hits "mark dupe" on a dupe-strip card.
    // Shows both photos side-by-side, the curator picks which is
    // canonical, the confirm button writes one PUT setting dupeOf on
    // the loser. The merger's dupe-merge pass folds the loser's
    // metadata into the canonical at the next merge run.
    const dupeModalState = { left: null, right: null };

    function countFilled(e) {
      if (!e) return 0;
      let n = 0;
      const isFilled = (v) =>
        v != null && v !== '' && !(Array.isArray(v) && v.length === 0);
      for (const k of ['caption','alt','country','theme','species','story','entities','album_url']) {
        if (isFilled(e[k])) n += 1;
      }
      if (e.has_notes) n += 1;
      return n;
    }
    function sourceRank(s) {
      // Default canonical heuristic. photography first because it's
      // the curator's main themed corpus; me next; atlas (one-photo-
      // per-country slots) last.
      if (s === 'photography') return 3;
      if (s === 'me') return 2;
      if (s === 'atlas') return 1;
      return 0;
    }
    function pixelArea(e) {
      const s = e && e._size;
      if (!s || !s.width || !s.height) return 0;
      return s.width * s.height;
    }
    function pickDefaultCanonical(left, right) {
      // Source rank first — the curator's photography-* corpus is the
      // primary themed gallery, me/atlas are secondary slots.
      if (sourceRank(left.source) !== sourceRank(right.source)) {
        return sourceRank(left.source) > sourceRank(right.source) ? 'left' : 'right';
      }
      // Then prefer the higher-resolution image (raw quality signal).
      const la = pixelArea(left), ra = pixelArea(right);
      if (la !== ra) return la > ra ? 'left' : 'right';
      // Then prefer the side with more populated metadata.
      const lf = countFilled(left), rf = countFilled(right);
      if (lf !== rf) return lf > rf ? 'left' : 'right';
      return 'left';
    }
    function fmtBytes(n) {
      if (!Number.isFinite(n) || n <= 0) return null;
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
      return (n / (1024 * 1024)).toFixed(1) + ' MB';
    }
    function fmtSize(size) {
      if (!size) return null;
      const dims = (size.width && size.height) ? (size.width + '×' + size.height) : null;
      const bytes = fmtBytes(size.bytes);
      if (dims && bytes) return dims + ' · ' + bytes;
      return dims || bytes || null;
    }
    function renderDupeMeta(elId, e) {
      const el = $(elId);
      const rows = [];
      const add = (k, v) => {
        if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) {
          rows.push('<div class="row"><span class="k">' + k + '</span><span class="v empty">—</span></div>');
        } else {
          const text = Array.isArray(v) ? v.join(', ') : String(v);
          rows.push('<div class="row"><span class="k">' + k + '</span><span class="v">' + text + '</span></div>');
        }
      };
      add('source', e.source);
      add('size', fmtSize(e._size));
      add('caption', e.caption);
      add('alt', e.alt);
      add('country', e.country ? countryDisplay(e.country) : null);
      add('city', e.city);
      add('state', e.state);
      add('theme', e.theme);
      add('species', e.species);
      add('story', e.story);
      add('entities', e.entities);
      // Roll up all prior notes (latest first) so the curator can
      // skim the photographer's accumulated context while picking
      // canonical. Joined with " · " — concise, not the full prose.
      const notesSummary = (e.prior_notes ?? [])
        .slice().reverse()
        .map((n) => n.text)
        .join(' · ');
      add('notes', notesSummary || null);
      el.innerHTML = rows.join('');
    }
    function updateChoiceUi(side) {
      $('dupe-choice-left').classList.toggle('selected', side === 'left');
      $('dupe-choice-right').classList.toggle('selected', side === 'right');
      $('dupe-left-role').textContent  = side === 'left'  ? 'canonical' : 'duplicate';
      $('dupe-right-role').textContent = side === 'right' ? 'canonical' : 'duplicate';
      const leftRadio  = document.querySelector('input[name="dupe-canonical"][value="left"]');
      const rightRadio = document.querySelector('input[name="dupe-canonical"][value="right"]');
      if (leftRadio)  leftRadio.checked  = (side === 'left');
      if (rightRadio) rightRadio.checked = (side === 'right');
    }
    function openDupeModal(currentEntry, otherId) {
      const otherEntry = entries.find((x) => x.id === otherId);
      if (!otherEntry) {
        alert('Could not load other entry: ' + otherId);
        return;
      }
      dupeModalState.left = currentEntry;
      dupeModalState.right = otherEntry;
      $('dupe-left-id').textContent = currentEntry.id;
      $('dupe-right-id').textContent = otherEntry.id;
      $('dupe-left-img').src = '/media/' + currentEntry.src;
      $('dupe-left-img').alt = currentEntry.id;
      $('dupe-right-img').src = '/media/' + otherEntry.src;
      $('dupe-right-img').alt = otherEntry.id;
      renderDupeMeta('dupe-left-meta', currentEntry);
      renderDupeMeta('dupe-right-meta', otherEntry);
      const def = pickDefaultCanonical(currentEntry, otherEntry);
      updateChoiceUi(def);
      $('dupe-modal').setAttribute('open', '');
    }
    function closeDupeModal() {
      $('dupe-modal').removeAttribute('open');
      dupeModalState.left = null;
      dupeModalState.right = null;
    }
    $('dupe-choice-left').addEventListener('click', () => updateChoiceUi('left'));
    $('dupe-choice-right').addEventListener('click', () => updateChoiceUi('right'));
    $('dupe-modal-cancel').addEventListener('click', closeDupeModal);
    $('dupe-modal-backdrop').addEventListener('click', closeDupeModal);
    $('dupe-modal-confirm').addEventListener('click', async () => {
      const left = dupeModalState.left;
      const right = dupeModalState.right;
      if (!left || !right) { closeDupeModal(); return; }
      const checked = document.querySelector('input[name="dupe-canonical"]:checked');
      const canonicalSide = checked ? checked.value : 'left';
      const canonical = canonicalSide === 'left' ? left : right;
      const dupe      = canonicalSide === 'left' ? right : left;
      // Snapshot the user's place BEFORE the refetch + applyFilter, so
      // we can land cursor back on the same entry afterward. Without
      // this, applyFilter resets cursor to 0 and the curator loses
      // their position in the review queue.
      const prevId = filtered[cursor] ? filtered[cursor].id : null;
      const prevPos = cursor;
      flashSaved('saving…', true);
      // If the chosen canonical was itself previously marked as a dupe
      // (most often pointing back at this same loser — a 2-cycle), we
      // explicitly clear its dupeOf so the cluster is self-consistent
      // and the merger's resolveCanonical() doesn't bail on the cycle.
      // Empty string fires the merger's human-tier clear semantic.
      if (canonical.dupeOf) {
        const clear = await fetch('/api/photo/' + encodeURIComponent(canonical.id), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dupeOf: '' }),
        });
        if (!clear.ok) {
          alert('clear canonical dupeOf failed: ' + clear.status + ' ' + (await clear.text()));
          return;
        }
      }
      const res = await fetch('/api/photo/' + encodeURIComponent(dupe.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dupeOf: canonical.id }),
      });
      if (!res.ok) {
        alert('save failed: ' + res.status + ' ' + (await res.text()));
        return;
      }
      // Refresh from server so the overlay reflects the new dupeOf.
      const listRes = await fetch('/api/list');
      entries = await listRes.json();
      applyFilter({ preserveId: prevId, fallbackPos: prevPos });
      closeDupeModal();
      flashSaved('dupe marked');
    });

    // ─── Voice dictation (browser Web Speech API) ─────────────────
    let recognition = null;
    let isRecording = false;
    let recordingBase = '';
    function setupMic() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        $('mic-btn').style.display = 'none';
        $('mic-status').textContent = 'voice unavailable';
        return;
      }
      recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.onstart = () => {
        isRecording = true;
        $('mic-btn').classList.add('recording');
        $('mic-label').textContent = 'Stop';
        $('mic-status').textContent = 'listening…';
        recordingBase = $('curator-notes').value;
        if (recordingBase && !/[\\s\\n]$/.test(recordingBase)) recordingBase += ' ';
      };
      recognition.onresult = (e) => {
        let interim = '', final = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const text = r[0].transcript;
          if (r.isFinal) final += text;
          else interim += text;
        }
        if (final) {
          recordingBase += final.replace(/^\\s+/, '');
          if (!/[\\s\\n]$/.test(recordingBase)) recordingBase += ' ';
          $('interim-preview').textContent = '';
        } else {
          $('interim-preview').textContent = interim;
        }
        $('curator-notes').value = recordingBase + interim;
        currentDirty = true;
      };
      recognition.onerror = (e) => {
        $('mic-status').textContent = 'error: ' + (e.error || 'unknown');
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          $('mic-status').textContent = 'mic permission denied';
        }
      };
      recognition.onend = () => {
        isRecording = false;
        $('mic-btn').classList.remove('recording');
        $('mic-label').textContent = 'Record';
        $('mic-status').textContent = '';
        $('interim-preview').textContent = '';
      };
    }
    function toggleMic() {
      if (!recognition) return;
      if (isRecording) { recognition.stop(); }
      else { try { recognition.start(); } catch (e) { console.warn(e); } }
    }
    setupMic();
    $('mic-btn').addEventListener('click', toggleMic);

    let viewMode = 'single';
    function hideAllViews() {
      document.querySelector('main').style.display = 'none';
      $('all-notes-view').style.display = 'none';
      $('list-view').style.display = 'none';
    }
    function switchToAllNotes() {
      viewMode = 'all-notes';
      hideAllViews();
      $('all-notes-view').style.display = 'block';
      $('all-notes-btn').textContent = 'Back to review';
      $('list-view-btn').textContent = 'List view';
      renderAllNotes();
    }
    function switchToSingle() {
      viewMode = 'single';
      hideAllViews();
      document.querySelector('main').style.display = '';
      $('all-notes-btn').textContent = 'All notes';
      $('list-view-btn').textContent = 'List view';
    }
    function switchToListView() {
      viewMode = 'list';
      hideAllViews();
      $('list-view').style.display = 'flex';
      $('list-view-btn').textContent = 'Back to review';
      $('all-notes-btn').textContent = 'All notes';
      // Re-run filter so the filtered array is in sync with the
      // dropdowns at this moment (the user may have changed them while
      // in single mode), then paint the grid.
      applyFilter();
      renderList();
    }
    function toggleAllNotes() { viewMode === 'all-notes' ? switchToSingle() : switchToAllNotes(); }
    function toggleListView() { viewMode === 'list' ? switchToSingle() : switchToListView(); }
    function renderAllNotes() {
      const withNotes = entries.filter((e) => e.has_notes && (e.prior_notes ?? []).length > 0);
      $('all-notes-count').textContent = withNotes.length + ' / ' + entries.length + ' photos have notes';
      const list = $('all-notes-list');
      list.innerHTML = '';
      if (withNotes.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'all-notes-empty';
        empty.textContent = 'No curator notes yet. Hit Record and start talking.';
        list.appendChild(empty);
        return;
      }
      for (const e of withNotes) {
        const card = document.createElement('div');
        card.className = 'notes-card';
        const img = document.createElement('img');
        img.src = '/media/' + e.src; img.alt = e.alt || e.caption || e.id; img.loading = 'lazy';
        const body = document.createElement('div');
        body.className = 'nc-body';
        const meta = document.createElement('div');
        meta.className = 'nc-meta';
        meta.innerHTML =
          '<code>' + e.id + '</code>' +
          (e.country ? '<span class="country">' + e.country + '</span>' : '') +
          (e.caption ? '<span style="font-style:italic">' + e.caption + '</span>' : '');
        // Render every prior note in chronological order, each labelled
        // with its save timestamp. Older notes have visible history
        // without merging into one wall of text.
        const notes = document.createElement('div');
        notes.className = 'nc-notes';
        for (const p of (e.prior_notes ?? [])) {
          const block = document.createElement('p');
          block.style.margin = '0 0 8px';
          const ts = document.createElement('span');
          ts.style.fontFamily = 'var(--mono)';
          ts.style.fontSize = '10px';
          ts.style.letterSpacing = '0.12em';
          ts.style.color = 'var(--canvas-fg-muted)';
          ts.style.marginRight = '8px';
          ts.textContent = fmtPriorTs(p.ts);
          block.appendChild(ts);
          block.appendChild(document.createTextNode(p.text));
          notes.appendChild(block);
        }
        const actions = document.createElement('div');
        actions.className = 'nc-actions';
        const editBtn = document.createElement('button');
        editBtn.textContent = 'open in editor →';
        editBtn.onclick = () => {
          const idx = filtered.findIndex((x) => x.id === e.id);
          if (idx >= 0) { cursor = idx; switchToSingle(); render(); }
          else {
            // Open-in-editor from the all-notes view — clear every
            // filter so the target entry is guaranteed to be in the
            // current filtered list, then look it up fresh.
            $('filter').value = 'all';
            $('source-filter').value = 'all';
            $('country-filter').value = '';
            $('theme-filter').value = '';
            applyFilter();
            const fresh = filtered.findIndex((x) => x.id === e.id);
            if (fresh >= 0) { cursor = fresh; switchToSingle(); render(); }
          }
        };
        const refineBtn = document.createElement('button');
        refineBtn.textContent = 'refine →';
        refineBtn.dataset.action = 'refine';
        refineBtn.onclick = () => kickoffRefine(e, card);
        const status = document.createElement('span');
        status.className = 'nc-status';
        status.dataset.role = 'status';
        status.textContent = 'idle';
        actions.appendChild(refineBtn);
        actions.appendChild(status);
        actions.appendChild(editBtn);
        const diffSlot = document.createElement('div');
        diffSlot.dataset.role = 'diff-slot';
        body.appendChild(meta);
        body.appendChild(notes);
        body.appendChild(actions);
        body.appendChild(diffSlot);
        card.appendChild(img); card.appendChild(body);
        list.appendChild(card);
      }
    }

    // ─── Refinement orchestration (all-notes view) ────────────────
    // Per-card "refine" buttons open an EventSource against the
    // /api/merge/photo/:id endpoint, which spawns the merger in
    // --only mode and streams { type, status, fields } back. We
    // render a status badge on the card and an inline before/after
    // diff once the refined event lands.
    function setCardStatus(card, status, text) {
      const el = card.querySelector('[data-role="status"]');
      if (!el) return;
      el.className = 'nc-status' + (status ? ' ' + status : '');
      el.textContent = text || status || 'idle';
    }
    function fmtVal(v) {
      if (v == null || v === '') return '∅';
      if (Array.isArray(v)) return v.join(', ');
      return String(v);
    }
    function renderDiff(card, entry, fields, snapshot) {
      const slot = card.querySelector('[data-role="diff-slot"]');
      if (!slot) return;
      const COMPARED = ['caption','alt','country','city','state','theme','species','story','entities'];
      const changedRows = [];
      const unchangedKeys = [];
      for (const k of COMPARED) {
        const after = fields[k];
        const before = entry[k];
        const has = Object.prototype.hasOwnProperty.call(fields, k);
        if (!has) continue;
        const sameScalar =
          (typeof before === typeof after) && (before === after);
        const sameArray = Array.isArray(before) && Array.isArray(after)
          && before.length === after.length
          && before.every((x, i) => x === after[i]);
        if (sameScalar || sameArray) {
          unchangedKeys.push(k);
          continue;
        }
        if (Array.isArray(before) || Array.isArray(after)) {
          const oldSet = new Set(Array.isArray(before) ? before : []);
          const newSet = new Set(Array.isArray(after) ? after : []);
          const added = [...newSet].filter((x) => !oldSet.has(x));
          const removed = [...oldSet].filter((x) => !newSet.has(x));
          const kept = [...oldSet].filter((x) => newSet.has(x));
          const parts = [];
          if (added.length) parts.push('<span class="added">+ ' + added.join(', ') + '</span>');
          if (removed.length) parts.push('<span class="removed">− ' + removed.join(', ') + '</span>');
          if (kept.length) parts.push('<span class="kept">kept: ' + kept.join(', ') + '</span>');
          changedRows.push(
            '<div class="nc-diff-row"><span class="k">' + k + '</span>' +
            '<span class="v">' + parts.join('<br>') + '</span></div>'
          );
        } else {
          changedRows.push(
            '<div class="nc-diff-row"><span class="k">' + k + '</span>' +
            '<span class="v">' +
            '<span class="old">' + escapeHtml(fmtVal(before)) + '</span>' +
            '<span class="new">' + escapeHtml(fmtVal(after)) + '</span>' +
            '</span></div>'
          );
        }
        // Optimistic local update so subsequent re-renders show the new value.
        entry[k] = after;
      }
      const html =
        '<div class="nc-diff">' +
          '<div class="nc-diff-header"><span>Refined labels</span><span>' + (changedRows.length || 'no changes') + (changedRows.length === 1 ? ' field changed' : changedRows.length ? ' fields changed' : '') + '</span></div>' +
          changedRows.join('') +
          (unchangedKeys.length ? '<div class="nc-diff-unchanged">' + unchangedKeys.length + ' unchanged: ' + unchangedKeys.join(', ') + '</div>' : '') +
          '<div class="nc-diff-actions">' +
            '<button data-act="accept">Accept</button>' +
            '<button data-act="reject">Reject</button>' +
            '<button data-act="rerefine">Re-refine</button>' +
          '</div>' +
        '</div>';
      slot.innerHTML = html;
      slot.querySelector('[data-act="accept"]').onclick = () => { slot.innerHTML = ''; };
      slot.querySelector('[data-act="reject"]').onclick = () => rejectRefinement(entry, card, snapshot, fields);
      slot.querySelector('[data-act="rerefine"]').onclick = () => kickoffRefine(entry, card, { force: true });
    }
    function renderDiffError(card, message) {
      const slot = card.querySelector('[data-role="diff-slot"]');
      if (!slot) return;
      slot.innerHTML = '<div class="nc-diff"><div class="nc-diff-error">' + escapeHtml(message) + '</div></div>';
    }
    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    async function rejectRefinement(entry, card, snapshot, refinedFields) {
      // Re-assert the pre-refinement value (captured in the snapshot
      // before the refined SSE arrived) as a fresh human-tier event.
      // human > refined per field, so this wins. We send '' for any
      // field that was empty in the snapshot — the merger's
      // human-tier clear semantic removes it from the merged state,
      // which is the closest analog to "this field shouldn't exist."
      const patch = {};
      for (const k of Object.keys(refinedFields)) {
        const prev = snapshot[k];
        if (prev == null || prev === '' || (Array.isArray(prev) && prev.length === 0)) {
          patch[k] = '';
        } else {
          patch[k] = prev;
        }
        // Roll the in-memory entry back too, so subsequent renders
        // show the pre-refinement state.
        entry[k] = prev;
      }
      await fetch('/api/photo/' + encodeURIComponent(entry.id), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      // Flush via skip-refine merge.
      await new Promise((resolve) => {
        const es = new EventSource('/api/merge/photo/' + encodeURIComponent(entry.id) + '?skipRefine=1');
        es.onmessage = (ev) => {
          try {
            const o = JSON.parse(ev.data);
            if (o.type === 'exit') { es.close(); resolve(null); }
          } catch { /* */ }
        };
        es.onerror = () => { es.close(); resolve(null); };
      });
      const slot = card.querySelector('[data-role="diff-slot"]');
      if (slot) slot.innerHTML = '';
      setCardStatus(card, '', 'rejected');
      // Refresh entry from server so the diff snapshot updates next time.
      try {
        const res = await fetch('/api/list');
        entries = await res.json();
      } catch { /* */ }
    }
    function kickoffRefine(entry, card, opts) {
      setCardStatus(card, 'running', 'running…');
      const slot = card.querySelector('[data-role="diff-slot"]');
      if (slot) slot.innerHTML = '';
      // Snapshot the entry's "before" fields BEFORE the SSE arrives,
      // so the diff renders against the pre-refinement state even
      // after we optimistically mutate the entry object on done.
      const snapshot = {};
      for (const k of ['caption','alt','country','city','state','theme','species','story','entities']) {
        snapshot[k] = entry[k];
      }
      const url = '/api/merge/photo/' + encodeURIComponent(entry.id);
      const es = new EventSource(url);
      es.onmessage = (ev) => {
        try {
          const o = JSON.parse(ev.data);
          if (o.type === 'progress') {
            if (o.id !== entry.id && o.kind !== 'dupe-merge') return;
            if (o.status === 'running') setCardStatus(card, 'running', 'running…');
            else if (o.status === 'cached') {
              setCardStatus(card, 'cached', 'cached');
            } else if (o.status === 'done') {
              setCardStatus(card, 'done', 'refined ✓');
              if (o.id === entry.id && o.fields) {
                renderDiff(card, entry, o.fields, snapshot);
              }
            } else if (o.status === 'failed') {
              setCardStatus(card, 'failed', 'failed');
              renderDiffError(card, o.reason || 'refinement failed');
            }
          } else if (o.type === 'error') {
            setCardStatus(card, 'failed', 'error');
            renderDiffError(card, o.message || 'stream error');
          } else if (o.type === 'exit') {
            es.close();
            if (o.code !== 0) {
              setCardStatus(card, 'failed', 'exit ' + o.code);
            }
          }
        } catch { /* */ }
      };
      es.onerror = () => {
        setCardStatus(card, 'failed', 'connection lost');
        es.close();
      };
    }
    $('all-notes-btn').addEventListener('click', toggleAllNotes);
    $('list-view-btn').addEventListener('click', toggleListView);

    // ─── List view ────────────────────────────────────────────────
    // Grid of currently-filtered photos with per-card checkboxes.
    // Selection persists across filter changes (handy: filter to one
    // country, select some, filter to another, select more, then bulk
    // apply theme to the combined set). Selections that fall outside
    // the current entries list are pruned at apply time.
    const selectedIds = new Set();

    // Drag-and-drop reordering state.
    //   listOrder        — ids in the curator's current visual order.
    //                      When reorderDirty=false, this is rebuilt from
    //                      filtered on every renderList. When dirty,
    //                      we preserve it across renders so the pending
    //                      drag isn't lost.
    //   reorderDirty     — true after a drop, before save/reset.
    //   dragId           — the id currently being dragged (null when idle).
    // Reordering is disabled when any filter is active (filtersActive())
    // so the global sort_order ranking stays unambiguous in v1.
    let listOrder = [];
    let reorderDirty = false;
    let dragId = null;
    // Sort mode = focused drag-and-drop workspace. Bulk theme/country
    // controls hide; the existing checkbox selection drives multi-move
    // (drag any selected card → all selected cards travel together as
    // a contiguous block, preserving their relative listOrder positions).
    let sortMode = false;
    // Shift-click range-select anchor. Set on every plain click;
    // shift+click then selects the contiguous span between this anchor
    // and the clicked card in listOrder.
    let selectionAnchorId = null;

    function filtersActive() {
      return $('filter').value !== 'all'
        || $('source-filter').value !== 'all'
        || $('country-filter').value !== ''
        || $('theme-filter').value !== '';
    }

    function updateReorderStatus() {
      const status = $('reorder-status');
      const view = $('list-view');
      const saveBtn = $('reorder-save');
      const resetBtn = $('reorder-reset');
      view.classList.toggle('sort-mode', sortMode);
      // Filter dropdowns disable in sort mode — sort mode's scope is
      // "the featured set", so country/category/source filters would
      // create ambiguous sort_order semantics. The dropdowns are reset
      // when entering sort mode; we just gray them out here.
      ['filter','source-filter','country-filter','theme-filter'].forEach((id) => {
        const el = $(id);
        if (el) el.disabled = sortMode;
      });
      status.classList.remove('disabled', 'dirty');
      if (!sortMode) {
        status.textContent = 'sort mode off';
        saveBtn.disabled = true;
        resetBtn.disabled = true;
        return;
      }
      if (reorderDirty) {
        const selN = selectedIds.size;
        status.textContent = 'unsaved reorder · top = best'
          + (selN > 1 ? ' · ' + selN + ' selected' : '');
        status.classList.add('dirty');
        saveBtn.disabled = false;
        resetBtn.disabled = false;
      } else {
        const selN = selectedIds.size;
        status.textContent = selN > 1
          ? 'ranking ' + featuredOnly().length + ' featured · drag any selected to move all '
            + selN + ' together'
          : 'ranking ' + featuredOnly().length + ' featured · drag to reorder · shift+click for range';
        saveBtn.disabled = true;
        resetBtn.disabled = true;
      }
    }

    // Featured-only subset of the filtered list. The sort-mode list
    // view renders this instead of the full filtered set — sort_order
    // is only meaningful within the featured corpus.
    function featuredOnly() {
      return filtered.filter((e) => !!e.featured);
    }

    function updateSelectedCount() {
      $('list-selected-count').textContent = selectedIds.size;
      $('list-visible-count').textContent = filtered.length;
      const allBox = $('list-select-all');
      const allVisibleSelected = filtered.length > 0
        && filtered.every((e) => selectedIds.has(e.id));
      allBox.checked = allVisibleSelected;
      allBox.indeterminate = !allVisibleSelected
        && filtered.some((e) => selectedIds.has(e.id));
      // Sort-mode hint depends on the selection count ("drag any
      // selected card to move all N together"), so refresh it here too.
      updateReorderStatus();
    }

    function renderList() {
      const grid = $('list-grid');
      grid.innerHTML = '';
      updateSelectedCount();
      updateReorderStatus();
      // In sort mode, the grid shows ONLY featured photos — sort_order
      // is a ranking within the featured set, so non-featured photos
      // would be noise. Outside sort mode, the full filtered set
      // renders (so the curator can mark/unmark featured via bulk).
      const visible = sortMode ? featuredOnly() : filtered;
      if (visible.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'list-empty';
        empty.textContent = sortMode
          ? 'No featured photos yet. Exit sort mode, select photos, and click "Mark featured".'
          : 'No photos match the current filters.';
        grid.appendChild(empty);
        return;
      }
      // Resolve the visual order. If the curator has an unsaved drag
      // pending (reorderDirty), preserve listOrder across renders so the
      // pending order survives /api/list refreshes. Otherwise sync to
      // the current visible array (which is already sort_order-sorted
      // by applyFilter, so the initial paint reflects the saved ranking).
      const filteredById = new Map(visible.map((e) => [e.id, e]));
      if (!reorderDirty) {
        listOrder = visible.map((e) => e.id);
      } else {
        // Drop any pending-order ids that no longer pass the filter,
        // append any new ones that came in via /api/list refresh.
        listOrder = listOrder.filter((id) => filteredById.has(id));
        for (const e of visible) {
          if (!listOrder.includes(e.id)) listOrder.push(e.id);
        }
      }
      // Drag is only available in sort mode. Outside sort mode the
      // curator's primary action on a card is checkbox-select for bulk
      // theme/country edits, and accidental drags would be a footgun.
      // Filters are force-disabled in sort mode (see updateReorderStatus)
      // so the featured-set scope stays unambiguous.
      const dragEnabled = sortMode;
      const frag = document.createDocumentFragment();
      for (let i = 0; i < listOrder.length; i++) {
        const id = listOrder[i];
        const e = filteredById.get(id);
        if (!e) continue;
        const card = document.createElement('div');
        const isDupe = !!e.dupeOf;
        card.className = 'list-card'
          + (selectedIds.has(e.id) ? ' selected' : '')
          + (isDupe ? ' is-dupe' : '');
        card.dataset.id = e.id;
        if (dragEnabled) card.draggable = true;
        if (isDupe) {
          const badge = document.createElement('span');
          badge.className = 'list-card-dupe-badge';
          badge.textContent = 'dupe';
          badge.title = 'duplicate of ' + e.dupeOf;
          card.appendChild(badge);
        }
        // Rank badge — shows the photo's existing sort_order if set,
        // OR its position in the current pending order when dirty.
        // Helps the curator see "is this photo ranked at all" before
        // they drag, and confirm relative positions after a drop.
        const rankBadge = document.createElement('span');
        rankBadge.className = 'list-card-rank';
        if (reorderDirty) {
          rankBadge.textContent = '#' + (i + 1);
          rankBadge.title = 'new rank (unsaved)';
        } else if (typeof e.sort_order === 'number') {
          rankBadge.textContent = '#' + (i + 1);
          rankBadge.title = 'rank · sort_order=' + e.sort_order;
        } else {
          rankBadge.textContent = '—';
          rankBadge.title = 'unranked';
        }
        card.appendChild(rankBadge);

        const check = document.createElement('input');
        check.type = 'checkbox';
        check.className = 'list-card-check';
        check.checked = selectedIds.has(e.id);
        check.addEventListener('click', (ev) => ev.stopPropagation());
        check.addEventListener('change', () => {
          if (check.checked) selectedIds.add(e.id);
          else selectedIds.delete(e.id);
          card.classList.toggle('selected', check.checked);
          updateSelectedCount();
        });

        const img = document.createElement('img');
        img.className = 'list-card-img';
        img.src = '/media/' + e.src;
        img.alt = e.alt || e.caption || e.id;
        img.loading = 'lazy';

        // Clicking the photo (not the checkbox) toggles selection.
        // Shift+click extends the selection across the contiguous span
        // in listOrder between the anchor (last plain-click target) and
        // this card — same model as macOS Finder. Anchor updates on
        // every plain click; cleared after a range-select.
        card.addEventListener('click', (ev) => {
          if (ev.shiftKey && selectionAnchorId && selectionAnchorId !== e.id) {
            const a = listOrder.indexOf(selectionAnchorId);
            const b = listOrder.indexOf(e.id);
            if (a >= 0 && b >= 0) {
              const [lo, hi] = a < b ? [a, b] : [b, a];
              for (let k = lo; k <= hi; k++) selectedIds.add(listOrder[k]);
              renderList();
              return;
            }
          }
          check.checked = !check.checked;
          check.dispatchEvent(new Event('change'));
          selectionAnchorId = check.checked ? e.id : null;
        });

        const meta = document.createElement('div');
        meta.className = 'list-card-meta';
        const country = document.createElement('div');
        country.className = 'country';
        country.textContent = e.country ? countryDisplay(e.country) : '— no country —';
        const themesEl = document.createElement('div');
        themesEl.className = 'themes';
        themesEl.textContent = (e.theme && e.theme.length) ? e.theme.join(' · ') : '— no themes —';
        const idLine = document.createElement('div');
        idLine.className = 'id-line';
        idLine.textContent = e.id;
        meta.appendChild(country);
        meta.appendChild(themesEl);
        meta.appendChild(idLine);

        card.appendChild(check);
        card.appendChild(img);
        card.appendChild(meta);

        if (dragEnabled) attachDragHandlers(card, e.id);

        frag.appendChild(card);
      }
      grid.appendChild(frag);
    }

    // Per-card drag handlers. Wired only when filters are off — when
    // filters are on, cards are not draggable and these handlers don't
    // attach. The drop indicator is a left/right inset shadow on the
    // hovered card (.drop-before / .drop-after); the JS computes which
    // side based on the cursor's X position within the card.
    function clearDropIndicators() {
      document
        .querySelectorAll('.list-card.drop-before, .list-card.drop-after')
        .forEach((c) => c.classList.remove('drop-before', 'drop-after'));
    }
    function attachDragHandlers(card, id) {
      card.addEventListener('dragstart', (ev) => {
        dragId = id;
        card.classList.add('dragging');
        if (ev.dataTransfer) {
          ev.dataTransfer.effectAllowed = 'move';
          // setData required for Firefox to fire drop events.
          try { ev.dataTransfer.setData('text/plain', id); } catch {}
        }
        // Multi-move affordance: when the dragged card is part of the
        // current selection, all selected cards travel together. Pop a
        // "+N" badge on the dragged card so the curator sees the count
        // mid-drag (the native drag image is just the card itself).
        if (selectedIds.has(id) && selectedIds.size > 1) {
          const badge = document.createElement('span');
          badge.className = 'list-card-multi-badge';
          badge.dataset.transient = '1';
          badge.textContent = '+' + (selectedIds.size - 1);
          card.appendChild(badge);
        }
      });
      card.addEventListener('dragend', () => {
        dragId = null;
        card.classList.remove('dragging');
        clearDropIndicators();
        // Remove any transient +N badges left after the drag finished
        // (drop or escape). Re-render would also fix this but we may
        // not always re-render on dragend.
        document.querySelectorAll('.list-card-multi-badge[data-transient="1"]')
          .forEach((b) => b.remove());
      });
      card.addEventListener('dragover', (ev) => {
        if (!dragId || dragId === id) return;
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
        const rect = card.getBoundingClientRect();
        const before = (ev.clientX - rect.left) < rect.width / 2;
        card.classList.toggle('drop-before', before);
        card.classList.toggle('drop-after', !before);
      });
      card.addEventListener('dragleave', (ev) => {
        // Only clear if the pointer actually left the card bounds —
        // dragleave fires on children too, which would flicker the
        // indicator.
        const r = card.getBoundingClientRect();
        if (ev.clientX < r.left || ev.clientX > r.right
          || ev.clientY < r.top || ev.clientY > r.bottom) {
          card.classList.remove('drop-before', 'drop-after');
        }
      });
      card.addEventListener('drop', (ev) => {
        ev.preventDefault();
        const src = dragId;
        dragId = null;
        clearDropIndicators();
        if (!src) return;
        // Determine the set of ids that travel together. When the
        // dragged card is part of the selection, the entire selection
        // moves as one contiguous block, preserving each card's relative
        // position in listOrder. Otherwise just the dragged card moves
        // (selection isn't disturbed). Dropping onto a card that's part
        // of the moving block is a no-op — there's nowhere meaningful
        // to land.
        const moving = (selectedIds.has(src) && selectedIds.size > 1)
          ? listOrder.filter((x) => selectedIds.has(x))
          : [src];
        if (moving.includes(id)) return;
        const before = (ev.clientX - card.getBoundingClientRect().left)
          < card.getBoundingClientRect().width / 2;
        // Pull every moving id out of listOrder, then re-locate the
        // target's index in the remaining array (it may have shifted
        // left if any moving items preceded it), then splice the block
        // in at the chosen side.
        const movingSet = new Set(moving);
        const remaining = listOrder.filter((x) => !movingSet.has(x));
        let to = remaining.indexOf(id);
        if (to < 0) to = remaining.length;
        if (!before) to += 1;
        remaining.splice(to, 0, ...moving);
        listOrder = remaining;
        reorderDirty = true;
        renderList();
      });
    }

    $('list-select-all').addEventListener('change', () => {
      const want = $('list-select-all').checked;
      for (const e of filtered) {
        if (want) selectedIds.add(e.id);
        else selectedIds.delete(e.id);
      }
      renderList();
    });

    // Apply a patch to every selected id. buildPatch(entry) returns
    // either the patch object or null to skip that entry (e.g. removing
    // a theme that the photo doesn't have). Refreshes /api/list once
    // at the end so the UI reflects the latest disk state.
    async function bulkApply(buildPatch, label) {
      const ids = [...selectedIds].filter((id) => entries.some((e) => e.id === id));
      if (ids.length === 0) {
        alert('Nothing selected.');
        return;
      }
      flashSaved('applying to ' + ids.length + '…', true);
      let applied = 0, failed = 0, skipped = 0;
      for (const id of ids) {
        const e = entries.find((x) => x.id === id);
        if (!e) { skipped += 1; continue; }
        const patch = buildPatch(e);
        if (!patch) { skipped += 1; continue; }
        try {
          const res = await fetch('/api/photo/' + encodeURIComponent(id), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          });
          if (!res.ok) { failed += 1; continue; }
          applied += 1;
        } catch { failed += 1; }
      }
      // Refresh entries from the server so the on-screen labels reflect
      // the overlay state after these appends.
      try {
        const listRes = await fetch('/api/list');
        entries = await listRes.json();
      } catch {/* keep the stale set if refresh fails */}
      // Clear the selection and the per-action inputs after every
      // Apply. Without this, picking more photos and hitting Apply
      // again would silently re-target every previously-selected
      // photo — overwriting ones the curator thought they were done
      // with. "Done with this batch" should be unambiguous; the
      // selection state resets so the next Apply only affects the
      // next selection.
      selectedIds.clear();
      const _bulkCountry = $('bulk-country');
      if (_bulkCountry) _bulkCountry.value = '';
      const _bulkThemeAdd = $('bulk-theme-add');
      if (_bulkThemeAdd) _bulkThemeAdd.value = '';
      const _bulkThemeRemove = $('bulk-theme-remove');
      if (_bulkThemeRemove) _bulkThemeRemove.value = '';
      const _selectAll = $('list-select-all');
      if (_selectAll) _selectAll.checked = false;
      applyFilter();
      if (viewMode === 'list') renderList();
      flashSaved((label || 'bulk') + ' · ' + applied + ' ok' +
        (failed ? ' / ' + failed + ' failed' : '') +
        (skipped ? ' / ' + skipped + ' skipped' : ''));
    }

    $('bulk-country-apply').addEventListener('click', () => {
      const code = $('bulk-country').value;
      if (!code) { alert('Pick a country first.'); return; }
      bulkApply(() => ({ country: code }), 'set country');
    });
    $('bulk-country-clear').addEventListener('click', () => {
      if (!confirm('Clear country on ' + selectedIds.size + ' photo(s)?')) return;
      // Empty string fires the merger's human-tier clear semantic.
      bulkApply((e) => (e.country ? { country: '' } : null), 'clear country');
    });
    $('bulk-theme-add-apply').addEventListener('click', () => {
      const raw = $('bulk-theme-add').value.trim();
      if (!raw) { alert('Type a theme tag first.'); return; }
      // Accept comma-separated list — "wildlife, landscape" adds both.
      // Each tag is run through the legacy-rewrite map (portrait →
      // people, sky-weather → sky, etc.) AND validated against the
      // canonical tree, mirroring what the merger does. Unknown tags
      // get rejected with a warning so curator typos don't quietly
      // pollute the dataset.
      const inputs = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      const adds = [];
      const rejected = [];
      for (const tag of inputs) {
        const rewrite = LEGACY_THEME_REWRITES[tag];
        const canonical = rewrite === undefined ? tag : rewrite;
        if (canonical === null) continue;          // explicit drop (e.g. documentary)
        if (!CANONICAL_THEME_SET.has(canonical)) { rejected.push(tag); continue; }
        if (!adds.includes(canonical)) adds.push(canonical);
      }
      if (rejected.length > 0) {
        // Newline escape doubled so the outer html() template literal
        // emits a single backslash-n into the served JS (alert renders
        // it as a real line break).
        alert(
          'Unknown theme tag(s): ' + rejected.join(', ') +
          '\\nValid: ' + [...CANONICAL_THEME_SET].sort().join(', '),
        );
        return;
      }
      if (!adds.length) return;
      bulkApply((e) => {
        const cur = new Set(e.theme ?? []);
        let changed = false;
        for (const t of adds) {
          if (!cur.has(t)) { cur.add(t); changed = true; }
        }
        if (!changed) return null;
        return { theme: [...cur] };
      }, 'add theme');
    });
    $('bulk-theme-remove-apply').addEventListener('click', () => {
      const t = $('bulk-theme-remove').value;
      if (!t) { alert('Pick a theme first.'); return; }
      bulkApply((e) => {
        const cur = new Set(e.theme ?? []);
        if (!cur.has(t)) return null;
        cur.delete(t);
        // Empty array fires the human-tier clear semantic (drops the
        // theme field entirely), which is what we want when the last
        // theme is removed.
        return { theme: cur.size ? [...cur] : '' };
      }, 'remove theme');
    });
    $('bulk-themes-clear').addEventListener('click', () => {
      if (!confirm('Clear ALL themes on ' + selectedIds.size + ' photo(s)?')) return;
      bulkApply((e) => ((e.theme ?? []).length ? { theme: '' } : null), 'clear themes');
    });
    // Featured = "eligible to be ranked in sort mode." Marking a photo
    // featured adds it to the corpus the sort-mode drag-and-drop
    // reorders. Unmarking removes it (and drops its sort_order from
    // the visible manifest order). Skip noop transitions to avoid
    // appending events that don't change state.
    $('bulk-featured-mark').addEventListener('click', () => {
      bulkApply((e) => (e.featured ? null : { featured: true }), 'mark featured');
    });
    $('bulk-featured-unmark').addEventListener('click', () => {
      // Send explicit false rather than '' (clear) because sabbatical
      // photos default to featured: true in the manifest builder. A
      // clear gesture there would un-clear back to the default. The
      // merger writes false on the entry, which the builder then ships
      // verbatim (and the sort path treats falsy as not-featured).
      bulkApply((e) => (e.featured ? { featured: false } : null), 'unmark featured');
    });

    // Omit = drop from the merged output entirely. Destructive enough to
    // warrant a confirm before marking, but unmark stays one-click since
    // it just restores normal visibility.
    $('bulk-omit-mark').addEventListener('click', () => {
      if (!confirm('Mark ' + selectedIds.size + ' photo(s) as omitted? They will be dropped from the merged output.')) return;
      bulkApply((e) => (e.omit ? null : { omit: true }), 'mark omit');
    });
    $('bulk-omit-unmark').addEventListener('click', () => {
      bulkApply((e) => (e.omit ? { omit: '' } : null), 'unmark omit');
    });

    // Toggle sort mode. Entering sort mode resets the filter dropdowns
    // (sort mode's scope is the featured set — country/theme/source
    // filters would be ambiguous on top of that), narrows the grid to
    // featured-only photos, and enables drag-and-drop. Existing checkbox
    // selection is preserved so the curator can flip mode mid-flow.
    // Exiting with unsaved drag changes prompts to confirm.
    $('sort-mode-btn').addEventListener('click', () => {
      if (sortMode && reorderDirty) {
        const ok = confirm('Discard unsaved reorder and exit sort mode?');
        if (!ok) return;
        reorderDirty = false;
      }
      sortMode = !sortMode;
      $('sort-mode-btn').textContent = sortMode ? 'Exit sort mode' : 'Sort mode';
      if (sortMode) {
        // Reset filters so the featured set is fully visible. The
        // dropdowns are grayed out (updateReorderStatus disables them)
        // but we explicitly clear the values too so re-applyFilter
        // doesn't keep a hidden filter active.
        $('filter').value = 'all';
        $('source-filter').value = 'all';
        $('country-filter').value = '';
        $('theme-filter').value = '';
        applyFilter();
      }
      renderList();
    });

    // Reset the pending drag order back to the saved sort_order on disk.
    $('reorder-reset').addEventListener('click', () => {
      reorderDirty = false;
      renderList();
    });

    // Commit the pending order. Each photo in the new visual order
    // gets sort_order = i * 10 (the *10 spacing leaves room to insert
    // single photos via interpolation in a future v2 without rewriting
    // the whole list). One PUT per photo — same path as every other
    // human-tier edit, so the events are auditable per id in the JSONL.
    $('reorder-save').addEventListener('click', async () => {
      if (!reorderDirty) return;
      if (filtersActive()) {
        alert('Clear filters before saving the order.');
        return;
      }
      const updates = listOrder.map((id, i) => ({ id, sort_order: i * 10 }));
      flashSaved('saving order…', true);
      let applied = 0, failed = 0;
      for (const { id, sort_order } of updates) {
        try {
          const res = await fetch('/api/photo/' + encodeURIComponent(id), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sort_order }),
          });
          if (!res.ok) { failed += 1; continue; }
          applied += 1;
        } catch { failed += 1; }
      }
      try {
        const listRes = await fetch('/api/list');
        entries = await listRes.json();
      } catch {/* keep stale */}
      reorderDirty = false;
      applyFilter();
      flashSaved('saved order · ' + applied + ' ok'
        + (failed ? ' / ' + failed + ' failed' : ''));
    });

    $('prev-btn').addEventListener('click', prev);
    $('next-btn').addEventListener('click', next);
    $('save-btn').addEventListener('click', save);
    $('save-next-btn').addEventListener('click', saveAndNext);
    $('skip-btn').addEventListener('click', next);
    $('filter').addEventListener('change', applyFilter);
    $('source-filter').addEventListener('change', applyFilter);
    $('country-filter').addEventListener('change', applyFilter);
    $('theme-filter').addEventListener('change', applyFilter);

    window.addEventListener('keydown', (e) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      const inField = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (inField && e.key !== 'Enter') return;
      if (e.key === 'j' || e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'k' || e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === 's' && !inField) { e.preventDefault(); save(); }
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault(); saveAndNext();
      }
    });

    window.addEventListener('beforeunload', (e) => {
      if (hasFormChanges()) { e.preventDefault(); e.returnValue = ''; }
    });

    loadAll();
  </script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────
// Server
// ─────────────────────────────────────────────────────────────────────

let cachedEntries = loadEntries();
await precomputeHashes(cachedEntries);
buildDupeIndex();

const themes = collectExistingThemes(cachedEntries);
const indexHtml = html(themes);

const server = serve({
  port: PORT,
  hostname: '127.0.0.1',
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === '/' || p === '/index.html') {
      return new Response(indexHtml, { headers: { 'Content-Type': 'text/html' } });
    }
    if (p === '/api/list' && req.method === 'GET') {
      // Always reload from disk so saves done by another process or by
      // the inline-merge step show up here. Attach the precomputed
      // pixel dims + file size from HASHED so the dupe-mark modal can
      // surface "how big is this file" alongside the metadata.
      cachedEntries = loadEntries();
      const sizeById = new Map<string, { width?: number; height?: number; bytes?: number }>();
      for (const h of HASHED) {
        sizeById.set(h.id, { width: h.width, height: h.height, bytes: h.bytes });
      }
      const fresh = cachedEntries.map((e) => {
        const idx = DUPE_INDEX.get(e.id);
        const size = sizeById.get(e.id) ?? {};
        return { ...e, _dupes: idx ?? null, _size: size };
      });
      return Response.json(fresh);
    }
    if (p.startsWith('/api/hint/') && req.method === 'GET') {
      const id = decodeURIComponent(p.slice('/api/hint/'.length));
      const entry = cachedEntries.find((x) => x.id === id);
      if (!entry) return new Response('not found', { status: 404 });
      const shootDate = await getShootDate(entry.src);
      return Response.json({ shootDate });
    }
    if (p.startsWith('/api/dupes-all/') && req.method === 'GET') {
      // Full ranked list of nearest photos by dHash distance, without
      // tier filtering. Backs the "show all candidates" modal — when
      // the curator knows a duplicate exists but it's not in the
      // top-5 strip, they can scroll the wider list.
      const id = decodeURIComponent(p.slice('/api/dupes-all/'.length));
      // No cap — return every other photo in the dataset, sorted by
      // visual distance to the current one. The curator needs the full
      // ranked list to find dupes that fall outside the top-tier
      // cutoff. ~246 entries is small enough to render in one shot.
      const dupes = rankByDistance(id, Number.MAX_SAFE_INTEGER);
      return Response.json({ dupes });
    }
    if (p.startsWith('/api/dupes/') && req.method === 'GET') {
      const id = decodeURIComponent(p.slice('/api/dupes/'.length));
      const dupes = nearestDupes(id, 5);
      return Response.json({ dupes });
    }
    if (p.startsWith('/api/merge/photo/') && req.method === 'GET') {
      // Per-photo merge as a server-sent-events stream. The client
      // opens an EventSource and receives:
      //   data: {"type":"started",   "id":"photo-..."}
      //   data: {"type":"progress",  "kind":"refine"|"dupe-merge", "status":"running"|"done"|"cached"|"failed", "id":..., "fields":..., "reason":...}
      //   data: {"type":"exit",      "code":0, "elapsedMs":...}
      //
      // Under the hood we just spawn `bun run scripts/merge-labels.ts
      // --only <id> --emit-progress`, parse the PROGRESS lines from
      // its stdout, and forward them as SSE messages. The merger
      // writes its own JSONL events to disk; this stream is purely a
      // UI signaling channel.
      const id = decodeURIComponent(p.slice('/api/merge/photo/'.length));
      const skipRefine = new URL(req.url).searchParams.get('skipRefine') === '1';
      return mergeStream({ ids: [id], skipRefine });
    }
    if (p.startsWith('/api/photo/') && req.method === 'PUT') {
      const id = decodeURIComponent(p.slice('/api/photo/'.length));
      const patch = await req.json() as Record<string, unknown>;

      // Keep only known human-tier fields. Empty values pass through —
      // the merger treats empty in the human tier as "clear".
      const fields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (!HUMAN_FIELDS.has(k)) continue;
        fields[k] = v;
      }
      if (Object.keys(fields).length === 0) {
        return Response.json({ ok: true, noop: true });
      }

      const event = {
        v: 1,
        id,
        timestamp: new Date().toISOString(),
        fields,
      };
      try {
        appendFileSync(SESSION_LOG, JSON.stringify(event) + '\n');
      } catch (e) {
        return new Response(`label log append failed: ${(e as Error).message}`, { status: 500 });
      }

      // Merge is manual-only — the curator runs
      //   bun run scripts/merge-labels.ts
      // when they're ready to flush events to photography.json /
      // photo-classifications.json. Until then, loadEntries() overlays
      // pending human events from the JSONL on top of the on-disk
      // state so the UI still reflects the latest edits.
      cachedEntries = loadEntries();
      const updated = cachedEntries.find((x) => x.id === id);
      return Response.json({ ok: true, entry: updated });
    }
    if (p.startsWith('/media/') && req.method === 'GET') {
      const rel = decodeURIComponent(p.slice('/media/'.length));
      if (!rel.startsWith('media/')) return new Response('forbidden', { status: 403 });
      const abs = join(ROOT, rel);
      if (!existsSync(abs)) return new Response('not found', { status: 404 });
      return new Response(Bun.file(abs));
    }
    return new Response('not found', { status: 404 });
  },
});

console.log(`\n  photo review UI → ${server.url}`);
console.log(`  session log:    ${SESSION_LOG}`);
console.log(
  `  ${cachedEntries.length} editable photos · ${themes.length} themes in merged state · ` +
  `${HASHED.length} hashed`,
);
console.log(`  shortcuts: j=next, k=prev, s=save, ⌘/Ctrl+Enter=save+next, ←/→ also nav\n`);
