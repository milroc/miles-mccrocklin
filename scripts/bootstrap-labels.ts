// One-shot migration to the versioned-labels pipeline.
//
// Reads the current snapshot of structured fields out of photography.json
// and photo-classifications.json, writes them as a single AI event into
// data/photography-labels/ai/bootstrap-{ts}.jsonl, then strips those
// fields from photography.json (leaving structural-only) and deletes
// photo-classifications.json.
//
// After this runs, every writer (ingest, classify, review) goes through
// the labels pipeline. The bootstrap event is just another AI event —
// future runs of classify-photography.ts append later AI events that
// can override it per field.
//
// The curator_notes: "Test" entry was a test of the flow; it is dropped
// rather than carried forward.
//
// Idempotent guard: refuses to run if any `ai/bootstrap-*.jsonl` file
// already exists. Migration is one-time.
//
// Run:
//   bun run scripts/bootstrap-labels.ts            # write + strip
//   bun run scripts/bootstrap-labels.ts --dry-run  # print summary, no writes

import {
  existsSync, mkdirSync, readFileSync, readdirSync, renameSync,
  unlinkSync, writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { ensureLabelsDir, sessionStamp } from './merge-labels';

const ROOT = resolve(import.meta.dir, '..');
const PHOTOGRAPHY_JSON = join(ROOT, 'data', 'photography.json');
const PHOTO_CLASSIFICATIONS_JSON = join(ROOT, 'data', 'photo-classifications.json');
const ME_JSON = join(ROOT, 'data', 'me.json');
const ATLAS_JSON = join(ROOT, 'data', 'photo-atlas.json');

// Fields the labels pipeline owns. Anything in this set on an entry is
// captured into the bootstrap event and removed from the source file.
// Mirrors LABEL_FIELDS in merge-labels.ts. dupeOf is a label (curator-
// authored identity assertion), not structural.
const LABEL_FIELDS = [
  'caption', 'alt', 'country', 'theme', 'species', 'story',
  'entities', 'album_url', 'featured', 'graphic', 'dupeOf',
] as const;

// Fields that stay in photography.json after the strip. Everything else
// gets pulled into the bootstrap event.
const STRUCTURAL_FIELDS = ['id', 'src', 'aspect'] as const;

interface PhotographyEntry {
  id: string;
  src: string;
  aspect?: number;
  dupeOf?: string;
  // Plus arbitrary LABEL_FIELDS-shaped extras at runtime.
  [k: string]: unknown;
}

interface AtlasEntry {
  country: string;
  country_slug: string;
  image?: string;
}

interface MeItem {
  id: string;
  type?: string;
  src: string;
}

// Walk me.json's nested structure to extract every sabbatical-travel
// item (id + src). Mirrors loadSabbaticalTravel from
// classify-photography.ts so the two scripts agree on what counts.
function loadSabbaticalItems(me: Record<string, unknown>): MeItem[] {
  const out: MeItem[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (typeof node !== 'object' || node === null) return;
    const obj = node as Record<string, unknown>;
    const items = obj.items;
    if (Array.isArray(items)) {
      const isSabbatical = items.every(
        (it) =>
          typeof it === 'object' &&
          it !== null &&
          typeof (it as Record<string, unknown>).src === 'string' &&
          ((it as Record<string, unknown>).src as string).includes('sabbatical-travel/'),
      );
      if (isSabbatical) {
        items.forEach((it) => out.push(it as MeItem));
        return;
      }
    }
    Object.values(obj).forEach(visit);
  };
  visit(me);
  return out;
}

// Build a src-path → namespaced-id map for me-* and atlas-* sources.
// photo-classifications.json is keyed by src path; the labels pipeline
// is keyed by namespaced id, so we need this translation.
function buildSrcToIdMap(): Map<string, string> {
  const map = new Map<string, string>();
  const me = JSON.parse(readFileSync(ME_JSON, 'utf8')) as Record<string, unknown>;
  for (const item of loadSabbaticalItems(me)) {
    if (item.type && item.type !== 'image') continue;
    map.set(item.src, `me-${item.id}`);
  }
  const atlas = JSON.parse(readFileSync(ATLAS_JSON, 'utf8')) as AtlasEntry[];
  for (const a of atlas) {
    if (!a.image) continue;
    map.set(a.image, `atlas-${a.country_slug}`);
  }
  return map;
}

interface BootstrapEvent {
  v: 1;
  id: string;
  timestamp: string;
  fields: Record<string, unknown>;
}

// Pull every label-pipeline-owned field off an entry. Empty values and
// curator_notes are intentionally dropped (curator_notes was test data,
// and the labels pipeline treats empties as "no opinion" anyway).
function extractLabelFields(entry: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of LABEL_FIELDS) {
    const v = entry[f];
    if (v == null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[f] = v;
  }
  return out;
}

function existingBootstrapFiles(aiDir: string): string[] {
  if (!existsSync(aiDir)) return [];
  return readdirSync(aiDir).filter((f) => /^bootstrap-.*\.jsonl$/.test(f));
}

async function bootstrap(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');

  const aiDir = ensureLabelsDir('ai');
  const existing = existingBootstrapFiles(aiDir);
  if (existing.length > 0) {
    console.error(
      `bootstrap-labels: refusing to run — a bootstrap file already exists: ${existing[0]}\n` +
      `  Migration is one-time. Delete the existing bootstrap file(s) first if you ` +
      `really want to redo this.`,
    );
    process.exit(1);
  }

  if (!existsSync(PHOTOGRAPHY_JSON)) {
    console.error(`bootstrap-labels: photography.json not found at ${PHOTOGRAPHY_JSON}`);
    process.exit(1);
  }

  const photoEntries = JSON.parse(
    readFileSync(PHOTOGRAPHY_JSON, 'utf8'),
  ) as PhotographyEntry[];

  // Use a single timestamp for the bootstrap event and the filename so
  // they line up. Events inside the file all share this timestamp —
  // we're treating the whole pre-pipeline state as one synchronous
  // backfill, which is accurate enough for provenance lookups.
  const stamp = sessionStamp();
  const isoTimestamp = new Date().toISOString();
  const events: BootstrapEvent[] = [];

  // photo-* entries from photography.json.
  let photoEvents = 0;
  for (const e of photoEntries) {
    const fields = extractLabelFields(e);
    if (Object.keys(fields).length === 0) continue;
    events.push({
      v: 1,
      id: `photo-${e.id}`,
      timestamp: isoTimestamp,
      fields,
    });
    photoEvents += 1;
  }

  // me-* + atlas-* entries from photo-classifications.json.
  let meEvents = 0;
  let atlasEvents = 0;
  let orphans = 0;
  if (existsSync(PHOTO_CLASSIFICATIONS_JSON)) {
    const sideTable = JSON.parse(
      readFileSync(PHOTO_CLASSIFICATIONS_JSON, 'utf8'),
    ) as Record<string, Record<string, unknown>>;
    const srcToId = buildSrcToIdMap();
    for (const [src, fields] of Object.entries(sideTable)) {
      const id = srcToId.get(src);
      if (!id) {
        console.warn(`  orphan classification: ${src} (no matching me/atlas entry)`);
        orphans += 1;
        continue;
      }
      const cleaned = extractLabelFields(fields);
      if (Object.keys(cleaned).length === 0) continue;
      events.push({
        v: 1,
        id,
        timestamp: isoTimestamp,
        fields: cleaned,
      });
      if (id.startsWith('me-')) meEvents += 1;
      else if (id.startsWith('atlas-')) atlasEvents += 1;
    }
  }

  console.log(
    `bootstrap-labels: captured ${events.length} events ` +
    `(${photoEvents} photo, ${meEvents} me, ${atlasEvents} atlas, ${orphans} orphans skipped)`,
  );

  if (dryRun) {
    console.log('bootstrap-labels: --dry-run set, not writing.');
    return;
  }

  // 1. Write the bootstrap JSONL.
  const bootstrapPath = join(aiDir, `bootstrap-${stamp}.jsonl`);
  const jsonlBody = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(bootstrapPath, jsonlBody);
  console.log(`bootstrap-labels: wrote ${bootstrapPath}`);

  // 2. Strip photography.json down to structural-only fields. Preserve
  //    entry order so the merger reproduces the same on-disk shape.
  const strippedPhoto = photoEntries.map((e) => {
    const out: Record<string, unknown> = {};
    for (const f of STRUCTURAL_FIELDS) {
      if (e[f] != null) out[f] = e[f];
    }
    return out;
  });
  const tmp = PHOTOGRAPHY_JSON + '.tmp';
  writeFileSync(tmp, JSON.stringify(strippedPhoto, null, 2) + '\n');
  renameSync(tmp, PHOTOGRAPHY_JSON);
  console.log(
    `bootstrap-labels: stripped photography.json to ${strippedPhoto.length} entries ` +
    `(structural-only)`,
  );

  // 3. Delete photo-classifications.json — fully regenerated by merge.
  if (existsSync(PHOTO_CLASSIFICATIONS_JSON)) {
    unlinkSync(PHOTO_CLASSIFICATIONS_JSON);
    console.log(`bootstrap-labels: deleted ${PHOTO_CLASSIFICATIONS_JSON}`);
  }

  console.log(
    `bootstrap-labels: done. Next: run \`bun run scripts/merge-labels.ts --skip-refine\` ` +
    `to regenerate the output files from labels.`,
  );
}

if (import.meta.main) {
  await bootstrap();
}
