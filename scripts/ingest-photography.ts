// Ingest curator-authored photos into the project.
//
// Reads JPEGs from a source folder (default ~/Downloads/images/), resizes
// each to max 1280w at JPEG q92 with EXIF orientation honored, writes to
// media/photography/<slug>.jpg, and updates data/photography.json with
// each photo's structural fields (id, src, aspect). Ingest is the
// structural authority — no other writer touches these fields.
//
// Country auto-inference: reads EXIF DateTimeOriginal from each source
// photo and looks it up in data/timeline.json. If exactly one trip
// contains the photo's date, the photo gets that trip's country slug.
// Overlapping trips (sub-trips inside larger ones, e.g. Vatican inside
// Italy) prefer the shortest range — usually the most specific. Photos
// with no EXIF date, no matching trip, or ambiguous matches contribute
// no country label.
//
// Output: per-photo country inferences are appended to
// data/photography-labels/ingest/{sessionStamp}.jsonl as label events.
// The merger picks them up at the lowest precedence tier — any later
// AI/human/refined event overrides them per field. Re-running ingest
// produces a fresh event; the merger keeps the LATEST ingest value.
//
// Why pre-resize at ingest: the served full-size variant tops out at
// 1280w (see scripts/build-photography-manifest.ts VARIANTS), so the
// "original" committed to the repo never needs to exceed that width.
// 1280w is deliberately sub-print-grade. A scraped JPEG at this size
// makes a soft 8x10 print and a bad 11x14, which is the protection
// against unauthorized prints. Print fulfillment is handled out-of-band
// from the master archive, never from anything served here. Originals
// stay pristine in the source folder for future archival.
//
// Idempotent: re-running skips files whose committed copy is newer than
// the source (mtime cache), but always re-runs the country inference
// step so timeline edits propagate.
//
// Run:
//   bun run scripts/ingest-photography.ts                  # default ~/Downloads/images
//   bun run scripts/ingest-photography.ts /path/to/folder  # custom source

import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import sharp from 'sharp';
import exifr from 'exifr';
import { ensureLabelsDir, sessionStamp } from './merge-labels';

const ROOT = resolve(import.meta.dir, '..');
const DEFAULT_SOURCE = join(homedir(), 'Downloads', 'images');
const DEST_DIR = join(ROOT, 'media', 'photography');
const JSON_PATH = join(ROOT, 'data', 'photography.json');
const TIMELINE_PATH = join(ROOT, 'data', 'timeline.json');
const ATLAS_PATH = join(ROOT, 'data', 'photo-atlas.json');

const MAX_WIDTH = 1280;
const JPEG_QUALITY = 92;

// Structural fields ingest writes (and only ingest writes). Everything
// else (caption/alt/country/theme/...) flows through the labels
// pipeline. dupeOf is curator-authored but lives on the structural row
// because it identifies the photo's identity within the source file.
const STRUCTURAL_FIELDS = ['id', 'src', 'aspect', 'dupeOf'] as const;

interface PhotographyEntryJson {
  id: string;
  src: string;
  aspect?: number;
  dupeOf?: string;
}

interface TimelineEntry {
  country: string;
  startMonth?: string;
  startYear?: number;
  endMonth?: string;
  endYear?: number;
  kind?: string;
}

interface AtlasEntry {
  country: string;
  country_slug: string;
}

const MONTH_INDEX: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function buildCountryNameToSlug(atlas: AtlasEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of atlas) map.set(a.country.toLowerCase(), a.country_slug);
  return map;
}
function nameToSlug(name: string, atlasMap: Map<string, string>): string {
  const hit = atlasMap.get(name.toLowerCase());
  if (hit) return hit;
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

interface TripRange {
  countrySlug: string;
  start: number;
  end: number;
  span: number;
}

function buildTripRanges(
  timeline: TimelineEntry[],
  atlasMap: Map<string, string>,
): TripRange[] {
  const ranges: TripRange[] = [];
  for (const t of timeline) {
    if (
      !t.startMonth || t.startYear == null ||
      !t.endMonth   || t.endYear == null
    ) continue;
    const sm = MONTH_INDEX[t.startMonth];
    const em = MONTH_INDEX[t.endMonth];
    if (sm == null || em == null) continue;
    const start = Date.UTC(t.startYear, sm, 1, 0, 0, 0);
    const lastDay = new Date(Date.UTC(t.endYear, em + 1, 0)).getUTCDate();
    const end = Date.UTC(t.endYear, em, lastDay, 23, 59, 59, 999);
    if (end < start) continue;
    ranges.push({
      countrySlug: nameToSlug(t.country, atlasMap),
      start, end, span: end - start,
    });
  }
  return ranges;
}

function inferCountry(date: Date | null, ranges: TripRange[]): string | undefined {
  if (!date) return undefined;
  const t = date.getTime();
  const matches = ranges.filter((r) => t >= r.start && t <= r.end);
  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0].countrySlug;
  matches.sort((a, b) => a.span - b.span);
  const tightest = matches[0];
  const next = matches[1];
  if (next.span < tightest.span * 1.5 && next.countrySlug !== tightest.countrySlug) {
    return undefined;
  }
  return tightest.countrySlug;
}

async function readExifDate(srcAbs: string): Promise<Date | null> {
  try {
    const exif = await exifr.parse(srcAbs, ['DateTimeOriginal']);
    if (exif?.DateTimeOriginal instanceof Date) return exif.DateTimeOriginal;
    return null;
  } catch {
    return null;
  }
}

async function ingest(): Promise<void> {
  const source = process.argv[2] ?? DEFAULT_SOURCE;
  if (!existsSync(source)) {
    console.error(`ingest-photography: source folder not found: ${source}`);
    process.exit(1);
  }
  mkdirSync(DEST_DIR, { recursive: true });

  // Read structural state from photography.json. After bootstrap this
  // file only carries structural fields; anything that looks like a
  // label on it is ignored here (the merger owns labels).
  const existingRaw: PhotographyEntryJson[] = JSON.parse(
    await Bun.file(JSON_PATH).text(),
  );
  const byId = new Map<string, PhotographyEntryJson>();
  for (const e of existingRaw) byId.set(e.id, stripToStructural(e));

  const timeline: TimelineEntry[] = JSON.parse(await Bun.file(TIMELINE_PATH).text());
  const atlas: AtlasEntry[] = JSON.parse(await Bun.file(ATLAS_PATH).text());
  const atlasMap = buildCountryNameToSlug(atlas);
  const tripRanges = buildTripRanges(timeline, atlasMap);
  console.log(
    `ingest-photography: timeline → ${tripRanges.length} dated trip ranges across ` +
    `${new Set(tripRanges.map((r) => r.countrySlug)).size} countries`,
  );

  const sources = readdirSync(source)
    .filter((f) => /\.(jpe?g|JPE?G)$/.test(f))
    .sort();
  console.log(`ingest-photography: ${sources.length} source files in ${source}`);

  // Open the ingest session file lazily — only created if we produce
  // at least one country event.
  const ingestStamp = sessionStamp();
  const ingestFile = join(ensureLabelsDir('ingest'), `${ingestStamp}.jsonl`);
  let countryEvents = 0;

  let ingested = 0;
  let skipped = 0;
  let inferredCountry = 0;
  let noExifDate = 0;
  let exifNoMatch = 0;
  for (const file of sources) {
    const id = slugify(file);
    const destRel = `media/photography/${id}.jpg`;
    const destAbs = join(ROOT, destRel);
    const srcAbs = join(source, file);
    const srcMtime = statSync(srcAbs).mtimeMs;

    let resized = false;
    if (existsSync(destAbs) && statSync(destAbs).mtimeMs >= srcMtime) {
      // mtime cache hit
    } else {
      await sharp(srcAbs)
        .rotate()
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toFile(destAbs);
      resized = true;
    }

    const meta = await sharp(destAbs).metadata();
    const aspect =
      meta.width && meta.height
        ? Number((meta.width / meta.height).toFixed(4))
        : undefined;

    // Country inference — always runs (even on mtime-cache hits) so
    // timeline edits propagate to existing photos via fresh ingest
    // events. The merger keeps the latest ingest value per field.
    const exifDate = await readExifDate(srcAbs);
    const inferredSlug = inferCountry(exifDate, tripRanges);
    if (!exifDate) noExifDate += 1;
    else if (!inferredSlug) exifNoMatch += 1;

    if (inferredSlug) {
      const event = {
        v: 1,
        id: `photo-${id}`,
        timestamp: new Date().toISOString(),
        fields: { country: inferredSlug },
      };
      appendFileSync(ingestFile, JSON.stringify(event) + '\n');
      countryEvents += 1;
      inferredCountry += 1;
    }

    const existing = byId.get(id);
    const patched: PhotographyEntryJson = {
      id,
      src: existing?.src ?? destRel,
      ...(aspect != null ? { aspect } : existing?.aspect != null ? { aspect: existing.aspect } : {}),
      ...(existing?.dupeOf && { dupeOf: existing.dupeOf }),
    };
    byId.set(id, patched);

    if (resized) {
      ingested += 1;
      if (ingested % 10 === 0) console.log(`  ingested ${ingested}/${sources.length}...`);
    } else {
      skipped += 1;
    }
  }

  // Write photography.json with structural-only fields. Preserve
  // existing ordering (curator may have rearranged), then append new
  // entries at the end.
  const orderedIds: string[] = [];
  const seen = new Set<string>();
  for (const e of existingRaw) {
    if (byId.has(e.id) && !seen.has(e.id)) { orderedIds.push(e.id); seen.add(e.id); }
  }
  for (const id of byId.keys()) {
    if (!seen.has(id)) { orderedIds.push(id); seen.add(id); }
  }
  const output = orderedIds.map((id) => byId.get(id)!);
  writeFileSync(JSON_PATH, JSON.stringify(output, null, 2) + '\n');

  console.log(
    `ingest-photography: ${ingested} resized, ${skipped} cache-hit, ` +
    `${output.length} total structural entries in photography.json`,
  );
  console.log(
    `ingest-photography: country inference → ${inferredCountry} events written, ` +
    `${exifNoMatch} no-match, ${noExifDate} no-EXIF-date`,
  );
  if (countryEvents > 0) {
    console.log(`ingest-photography: wrote ${countryEvents} events → ${ingestFile}`);
  }
  console.log(
    `ingest-photography: run \`bun run scripts/merge-labels.ts\` to flush ` +
    `the new ingest country events into photography.json + ` +
    `photo-classifications.json.`,
  );
}

// Strip an entry from photography.json down to just the structural set,
// dropping any leftover label fields if the file hasn't been
// re-merged yet. Defensive — bootstrap is supposed to leave only
// structural, but be tolerant.
function stripToStructural(e: Record<string, unknown>): PhotographyEntryJson {
  const out: Record<string, unknown> = {};
  for (const k of STRUCTURAL_FIELDS) {
    if (e[k] != null) out[k] = e[k];
  }
  return out as PhotographyEntryJson;
}

if (import.meta.main) {
  await ingest();
}
