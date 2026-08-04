// Build-time photography manifest builder.
//
// Merges three sources into one normalized PhotographyManifest used by
// the /photographer page:
//
//   1. data/me.json           — sabbatical-travel carousel items (already
//                                curated; flagged featured: true)
//   2. data/photography.json  — curator-authored themed photos (the new
//                                exports surface)
//   3. data/photo-atlas.json  — country atlas hero photos (country
//                                filter, Adobe Portfolio outbound link)
//
// For every photo, ensures sharp variants exist at:
//
//   media/portfolio/derived/{slug}-{480|960|1280}.jpg
//
// with an mtime cache: if the derived file is newer than its source, the
// variant is skipped. New or modified photos trigger a re-resize. The
// resize step uses `withoutEnlargement: true`, so a source smaller than
// 1280w just emits at its original width.
//
// Writes data/photography-manifest.json AND returns the manifest object
// so build.ts can inline-inject it into dist/photographer/index.html
// (window.__PHOTOGRAPHY_MANIFEST__) per D3 of the design review.
//
// Schema (data/photography.json — curator-authored entries):
//
//   [
//     {
//       "id": "wildlife-2025-01",                     // unique slug
//       "src": "media/photography/wildlife-2025-01.jpg",
//       "caption": "Editorial caption shown in lightbox",
//       "alt": "Descriptive a11y text for screen readers",
//       "theme": ["wildlife", "landscape"],          // freeform tags, no enum
//       "country": "antarctica",                     // optional slug
//       "aspect": 1.5,                               // optional; sharp computes
//       "album_url": "https://milesmccrocklin.myportfolio.com/wildlife-2025",
//       "featured": false                            // hero-eligible
//     }
//   ]
//
// Run via build.ts (invoked first, before Bun.build) or directly:
//
//   bun run scripts/build-photography-manifest.ts

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import sharp from 'sharp';
import type { PhotographyEntry, PhotographyManifest } from '../src/types';

const ROOT = resolve(import.meta.dir, '..');
const DERIVED_DIR = join(ROOT, 'media', 'portfolio', 'derived');

// Variant widths (px). Tile feeds the masonry grid (srcset 480w), medium
// is the upper srcset breakpoint for tile-in-grid retina (960w), full
// is the lightbox at the largest viewport (1280w). 1280w is the served
// ceiling: deliberately sub-print-grade to deter unauthorized prints.
// Matches the pattern used by professional photography portfolios on
// Squarespace, who cap at ~1000-1500w for the same reason.
const VARIANTS = [
  { width: 480,  suffix: 'tile',   quality: 85 },
  { width: 960,  suffix: 'medium', quality: 85 },
  { width: 1280, suffix: 'full',   quality: 92 },
] as const;

interface AtlasAlbum {
  title: string;
  url: string;
  source_image_url?: string;
}
interface AtlasLocalImage {
  title?: string;
  path: string;
}
interface AtlasEntry {
  country: string;
  country_slug: string;
  image?: string;
  image_tile?: string;
  primary_album?: AtlasAlbum;
  secondary_albums?: AtlasAlbum[];
  local_image?: AtlasLocalImage;
}

interface MeMediaItem {
  id: string;
  type: string;
  src: string;
  caption?: string;
  aspect?: number;
  tag?: string;
}

// Per-prose-field provenance: which tier of the labels pipeline wrote
// the final value. Only present when the value is AI-derived ('ai' =
// raw classifier, 'refined' = LLM rewrite informed by curator notes).
// Absence of an entry means the value is human-authored or structural.
type ProseProvenance = {
  caption?: 'ai' | 'refined';
  alt?: 'ai' | 'refined';
  story?: 'ai' | 'refined';
};

interface PhotographyJsonEntry {
  id: string;
  src: string;
  caption?: string;
  alt?: string;
  theme?: string[];
  country?: string;
  city?: string;
  state?: string;
  aspect?: number;
  album_url?: string;
  featured?: boolean;
  graphic?: boolean;
  entities?: string[];
  species?: string;
  story?: string;
  dupeOf?: string;
  sort_order?: number;
  prose_provenance?: ProseProvenance;
  crit_score?: number;
  crit_composition?: number;
  crit_lighting?: number;
  crit_subject?: number;
  crit_emotion?: number;
  crit_technical?: number;
  crit_composition_notes?: string;
  crit_lighting_notes?: string;
  crit_subject_notes?: string;
  crit_emotion_notes?: string;
  crit_technical_notes?: string;
  crit_notes?: string;
}

// Country codes are stored as ISO-3166-1 alpha-3 (lowercase: usa, deu,
// gbr, ata...). The Location filter on /photographer groups countries
// by continent. The continent map is generated from the shared
// locations table so we never drift from the merger's allowlist or
// from the review tool's dropdown.
import {
  continentForCode, countryNameForCode, LOCATIONS, normalizeCountryCode,
} from '../src/utils/locations';
const CONTINENT_BY_CODE: Record<string, string> = {};
for (const row of LOCATIONS) {
  CONTINENT_BY_CODE[row.code] = row.continent;
}

// Derive a country slug from a free-form me.json tag like
// "Yerevan, Armenia" → "armenia", "Antarctica" → "antarctica".
// Last comma-separated token wins; if no comma, whole string is the country.
function countryFromTag(tag: string | undefined): string | undefined {
  if (!tag) return undefined;
  const last = tag.split(',').pop()?.trim();
  if (!last) return undefined;
  // Route the free-form tag through the locations normalizer so we
  // get an ISO-3 code back. Falls back to undefined when the tag
  // doesn't match any known country / alias.
  return normalizeCountryCode(last);
}

// Convert a media source path to its derived-variant path:
//   media/portfolio/antarctica.jpg → media/portfolio/derived/antarctica-tile.jpg
function variantPath(src: string, suffix: string): string {
  const slug = basename(src).replace(/\.[^.]+$/, '');
  return `media/portfolio/derived/${slug}-${suffix}.jpg`;
}

// Resize one photo into all three variants, skipping any whose derived
// file is newer than the source (mtime cache).
async function ensureVariants(src: string): Promise<void> {
  const srcAbs = join(ROOT, src);
  if (!existsSync(srcAbs)) {
    throw new Error(`build-photography-manifest: source image missing: ${src}`);
  }
  const srcMtime = statSync(srcAbs).mtimeMs;
  for (const { width, suffix, quality } of VARIANTS) {
    const outRel = variantPath(src, suffix);
    const outAbs = join(ROOT, outRel);
    if (existsSync(outAbs) && statSync(outAbs).mtimeMs >= srcMtime) {
      continue;
    }
    mkdirSync(dirname(outAbs), { recursive: true });
    await sharp(srcAbs)
      .rotate()                                    // honor EXIF orientation
      .resize({ width, withoutEnlargement: true }) // don't upscale small sources
      .jpeg({ quality, mozjpeg: true })
      .toFile(outAbs);
  }
}

// Read source dimensions; needed for entries whose aspect isn't provided
// (photo-atlas.json and photography.json with no aspect field).
async function readAspect(src: string): Promise<number> {
  const srcAbs = join(ROOT, src);
  const meta = await sharp(srcAbs).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 1;
  if (!w || !h) {
    throw new Error(`build-photography-manifest: could not read dimensions for ${src}`);
  }
  return w / h;
}

function validatePhotographyEntry(e: unknown, idx: number): PhotographyJsonEntry {
  if (typeof e !== 'object' || e === null) {
    throw new Error(`photography.json[${idx}]: not an object`);
  }
  const o = e as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) {
    throw new Error(`photography.json[${idx}]: missing or invalid 'id'`);
  }
  if (typeof o.src !== 'string' || !o.src) {
    throw new Error(`photography.json[${idx}]: missing or invalid 'src'`);
  }
  if (o.theme != null && (!Array.isArray(o.theme) || o.theme.some((t) => typeof t !== 'string'))) {
    throw new Error(`photography.json[${idx}]: 'theme' must be string[]`);
  }
  return o as unknown as PhotographyJsonEntry;
}

// Extract sabbatical-travel carousel items from me.json. They live deep
// in the dossier; this scan is robust to schema drift as long as a media
// group's items[] all share the sabbatical-travel/ src prefix.
function loadSabbaticalTravel(me: Record<string, unknown>): MeMediaItem[] {
  const out: MeMediaItem[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
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
        items.forEach((it) => out.push(it as MeMediaItem));
        return;
      }
    }
    Object.values(obj).forEach(visit);
  };
  visit(me);
  return out;
}

// Side-table written by scripts/classify-photography.ts for the me.json
// + photo-atlas.json photos (whose source files are owned by other
// concerns — resume rendering, atlas data — and shouldn't get classifier
// output mixed into them). Keyed by src path. Schema mirrors the
// classifier fields of PhotographyEntry.
interface SideClassification {
  theme?: string[];
  caption?: string;
  alt?: string;
  country?: string;
  city?: string;
  state?: string;
  species?: string;
  entities?: string[];
  story?: string;
  // Curator overrides for me-/atlas- entries flow through the labels
  // pipeline into this side table, so the manifest needs to read them
  // here for those sources (photo-* read them straight from
  // photography.json).
  album_url?: string;
  featured?: boolean;
  graphic?: boolean;
  dupeOf?: string;
  sort_order?: number;
  crit_score?: number;
  crit_composition?: number;
  crit_lighting?: number;
  crit_subject?: number;
  crit_emotion?: number;
  crit_technical?: number;
  crit_composition_notes?: string;
  crit_lighting_notes?: string;
  crit_subject_notes?: string;
  crit_emotion_notes?: string;
  crit_technical_notes?: string;
  crit_notes?: string;
  prose_provenance?: ProseProvenance;
}

function loadClassificationSideTable(): Record<string, SideClassification> {
  const path = join(ROOT, 'data', 'photo-classifications.json');
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, SideClassification>;
}

// Compose the manifest's prose_provenance for an entry whose prose
// fields are assembled from multiple sources (me.json item.caption,
// side-table sc, atlas album titles). For each field, only mark "by
// AI" when the value that ends up in the manifest came from the side
// table AND the side table marked that field as ai/refined. Structural
// inputs (me.json captions, atlas album titles, country fallbacks) are
// human-authored and stay unmarked.
function composeProseProvenance(
  marks: { caption?: 'ai' | 'refined'; alt?: 'ai' | 'refined'; story?: 'ai' | 'refined' },
): ProseProvenance | undefined {
  const out: ProseProvenance = {};
  if (marks.caption) out.caption = marks.caption;
  if (marks.alt) out.alt = marks.alt;
  if (marks.story) out.story = marks.story;
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function buildPhotographyManifest(): Promise<PhotographyManifest> {
  const me = JSON.parse(
    await Bun.file(join(ROOT, 'data', 'me.json')).text(),
  ) as Record<string, unknown>;
  const photographyRaw = JSON.parse(
    await Bun.file(join(ROOT, 'data', 'photography.json')).text(),
  ) as unknown[];
  const atlas = JSON.parse(
    await Bun.file(join(ROOT, 'data', 'photo-atlas.json')).text(),
  ) as AtlasEntry[];
  const sideTable = loadClassificationSideTable();

  const photos: PhotographyEntry[] = [];
  const themeCounts = new Map<string, number>();
  const speciesCounts = new Map<string, number>();
  // species → wildlife-class tag → count. Used after the photo loop to
  // pick each species' majority class for the speciesByClass map.
  const speciesClassCounts = new Map<string, Map<string, number>>();
  const WILDLIFE_CLASSES = new Set([
    'birds',
    'mammals',
    'reptiles-amphibians',
    'marine-life',
    'insects',
    'flora',
  ]);
  const countryNames = new Map<string, string>();

  // 1. Sabbatical-travel items from me.json → featured-eligible entries.
  // Classifier output (theme/species/entities/story) merged in from the
  // side table, keyed by src path. Curator-authored caption stays
  // authoritative; classifier alt fills in only when the curator hasn't
  // written one.
  let droppedDupes = 0;
  for (const item of loadSabbaticalTravel(me)) {
    if (item.type !== 'image') continue;
    const sc = sideTable[item.src] ?? {};
    // Marked as a duplicate via the labels pipeline (the dupe-merge
    // pass has already folded this photo's metadata into the canonical).
    // Skip entirely — no manifest entry, no variant generation.
    if (sc.dupeOf) { droppedDupes += 1; continue; }
    await ensureVariants(item.src);
    const aspect = item.aspect ?? (await readAspect(item.src));
    const country = countryFromTag(item.tag);
    const themeArr = sc.theme ?? [];
    // me.json's item.caption / item.tag are human-authored — they
    // shadow side-table values, so the provenance only inherits the
    // side-table mark when the manifest actually pulls from sc.
    const captionFromSc = !item.caption && !!sc.caption;
    const altFromSc = !item.caption && !!sc.alt;
    const proseProvenance = composeProseProvenance({
      caption: captionFromSc ? sc.prose_provenance?.caption : undefined,
      alt: altFromSc ? sc.prose_provenance?.alt : undefined,
      story: sc.story ? sc.prose_provenance?.story : undefined,
    });
    photos.push({
      id: `me-${item.id}`,
      src: item.src,
      src_tile: variantPath(item.src, 'tile'),
      src_medium: variantPath(item.src, 'medium'),
      src_full: variantPath(item.src, 'full'),
      aspect,
      caption: item.caption || sc.caption || undefined,
      alt: item.caption || sc.alt || item.tag || undefined,
      prose_provenance: proseProvenance,
      theme: themeArr,
      country: country ?? sc.country,
      city: sc.city,
      state: sc.state,
      entities: sc.entities,
      species: sc.species,
      story: sc.story,
      album_url: sc.album_url,
      featured: sc.featured ?? true,
      graphic: sc.graphic,
      dupeOf: sc.dupeOf,
      sort_order: sc.sort_order,
      crit_score: sc.crit_score,
      crit_composition: sc.crit_composition,
      crit_lighting: sc.crit_lighting,
      crit_subject: sc.crit_subject,
      crit_emotion: sc.crit_emotion,
      crit_technical: sc.crit_technical,
      crit_composition_notes: sc.crit_composition_notes,
      crit_lighting_notes: sc.crit_lighting_notes,
      crit_subject_notes: sc.crit_subject_notes,
      crit_emotion_notes: sc.crit_emotion_notes,
      crit_technical_notes: sc.crit_technical_notes,
      crit_notes: sc.crit_notes,
    });
    if (country && item.tag) {
      // Display name from the last comma-separated chunk of the tag, preserving original case.
      const name = item.tag.split(',').pop()?.trim();
      if (name) countryNames.set(country, name);
    }
    // Side-table classifications contribute to the theme/species counts
    // so the filter dropdowns show them alongside photography.json data.
    for (const t of themeArr) themeCounts.set(t, (themeCounts.get(t) ?? 0) + 1);
    if (sc.species) {
      speciesCounts.set(sc.species, (speciesCounts.get(sc.species) ?? 0) + 1);
      let perClass = speciesClassCounts.get(sc.species);
      if (!perClass) {
        perClass = new Map();
        speciesClassCounts.set(sc.species, perClass);
      }
      for (const t of themeArr) {
        if (WILDLIFE_CLASSES.has(t)) {
          perClass.set(t, (perClass.get(t) ?? 0) + 1);
        }
      }
    }
  }

  // 2. Curator-authored photography.json → main themed entries
  for (let i = 0; i < photographyRaw.length; i++) {
    const e = validatePhotographyEntry(photographyRaw[i], i);
    if (e.dupeOf) { droppedDupes += 1; continue; }
    await ensureVariants(e.src);
    const aspect = e.aspect ?? (await readAspect(e.src));
    // alt falls back to caption when alt is missing — when that
    // happens, alt's provenance mirrors caption's.
    const altFallsBackToCaption = !e.alt && !!e.caption;
    const proseProvenance = composeProseProvenance({
      caption: e.prose_provenance?.caption,
      alt: altFallsBackToCaption ? e.prose_provenance?.caption : e.prose_provenance?.alt,
      story: e.story ? e.prose_provenance?.story : undefined,
    });
    photos.push({
      id: `photo-${e.id}`,
      src: e.src,
      src_tile: variantPath(e.src, 'tile'),
      src_medium: variantPath(e.src, 'medium'),
      src_full: variantPath(e.src, 'full'),
      aspect,
      caption: e.caption,
      alt: e.alt ?? e.caption,
      prose_provenance: proseProvenance,
      theme: e.theme ?? [],
      country: e.country,
      city: e.city,
      state: e.state,
      entities: e.entities,
      species: e.species,
      story: e.story,
      album_url: e.album_url,
      featured: e.featured ?? false,
      graphic: e.graphic,
      dupeOf: e.dupeOf,
      sort_order: e.sort_order,
      crit_score: e.crit_score,
      crit_composition: e.crit_composition,
      crit_lighting: e.crit_lighting,
      crit_subject: e.crit_subject,
      crit_emotion: e.crit_emotion,
      crit_technical: e.crit_technical,
      crit_composition_notes: e.crit_composition_notes,
      crit_lighting_notes: e.crit_lighting_notes,
      crit_subject_notes: e.crit_subject_notes,
      crit_emotion_notes: e.crit_emotion_notes,
      crit_technical_notes: e.crit_technical_notes,
      crit_notes: e.crit_notes,
    });
    (e.theme ?? []).forEach((t) => themeCounts.set(t, (themeCounts.get(t) ?? 0) + 1));
    if (e.species) {
      speciesCounts.set(e.species, (speciesCounts.get(e.species) ?? 0) + 1);
      // Track which wildlife class this species was tagged under, so
      // we can build the speciesByClass map at the end.
      let perClass = speciesClassCounts.get(e.species);
      if (!perClass) {
        perClass = new Map();
        speciesClassCounts.set(e.species, perClass);
      }
      for (const t of e.theme ?? []) {
        if (WILDLIFE_CLASSES.has(t)) {
          perClass.set(t, (perClass.get(t) ?? 0) + 1);
        }
      }
    }
  }

  // 3. Country atlas → one entry per country with album_url
  // Atlas entries: classifier output merged in from the side table.
  // Curator-authored caption (album title) + country stay authoritative.
  for (const a of atlas) {
    if (!a.image) continue;
    const sc = sideTable[a.image] ?? {};
    if (sc.dupeOf) { droppedDupes += 1; continue; }
    await ensureVariants(a.image);
    const aspect = await readAspect(a.image);
    const themeArr = sc.theme ?? [];
    // photo-atlas.json still ships kebab-case slugs (it predates the
    // ISO-code migration). Normalize so the manifest's country field
    // matches the rest of the data — ISO-3 codes everywhere.
    const atlasCode = normalizeCountryCode(a.country_slug) ?? a.country_slug;
    // primary_album.title and country are human-curated atlas data —
    // they shadow side-table values, so provenance only inherits when
    // sc is what actually fills the field.
    const captionFromSc = !a.primary_album?.title && !!sc.caption;
    const altFromSc = !!sc.alt;
    const proseProvenance = composeProseProvenance({
      caption: captionFromSc ? sc.prose_provenance?.caption : undefined,
      alt: altFromSc ? sc.prose_provenance?.alt : undefined,
      story: sc.story ? sc.prose_provenance?.story : undefined,
    });
    photos.push({
      id: `atlas-${a.country_slug}`,
      src: a.image,
      src_tile: variantPath(a.image, 'tile'),
      src_medium: variantPath(a.image, 'medium'),
      src_full: variantPath(a.image, 'full'),
      aspect,
      caption: a.primary_album?.title ?? sc.caption,
      alt: sc.alt ?? a.country,
      prose_provenance: proseProvenance,
      theme: themeArr,
      country: atlasCode,
      city: sc.city,
      state: sc.state,
      entities: sc.entities,
      species: sc.species,
      story: sc.story,
      album_url: sc.album_url ?? a.primary_album?.url,
      featured: sc.featured ?? false,
      graphic: sc.graphic,
      dupeOf: sc.dupeOf,
      sort_order: sc.sort_order,
      crit_score: sc.crit_score,
      crit_composition: sc.crit_composition,
      crit_lighting: sc.crit_lighting,
      crit_subject: sc.crit_subject,
      crit_emotion: sc.crit_emotion,
      crit_technical: sc.crit_technical,
      crit_composition_notes: sc.crit_composition_notes,
      crit_lighting_notes: sc.crit_lighting_notes,
      crit_subject_notes: sc.crit_subject_notes,
      crit_emotion_notes: sc.crit_emotion_notes,
      crit_technical_notes: sc.crit_technical_notes,
      crit_notes: sc.crit_notes,
    });
    countryNames.set(atlasCode, a.country);
    for (const t of themeArr) themeCounts.set(t, (themeCounts.get(t) ?? 0) + 1);
    if (sc.species) {
      speciesCounts.set(sc.species, (speciesCounts.get(sc.species) ?? 0) + 1);
      let perClass = speciesClassCounts.get(sc.species);
      if (!perClass) {
        perClass = new Map();
        speciesClassCounts.set(sc.species, perClass);
      }
      for (const t of themeArr) {
        if (WILDLIFE_CLASSES.has(t)) {
          perClass.set(t, (perClass.get(t) ?? 0) + 1);
        }
      }
    }
  }

  // Apply the curator's ranking. The ordering rule:
  //   1. featured photos come first, sorted by sort_order ascending
  //      (lower = better, top of array = best). sort_order is only
  //      meaningful within the featured set; non-featured photos
  //      shouldn't have it set.
  //   2. non-featured photos follow, keeping their source-file order
  //      (stable sort handles this).
  // Set in batches via the review tool's sort-mode drag-and-drop;
  // propagates here so every downstream consumer (Photography.tsx
  // filter passes, MasonryWall tile order) inherits the ranking.
  photos.sort((a, b) => {
    const af = a.featured ? 1 : 0;
    const bf = b.featured ? 1 : 0;
    if (af !== bf) return bf - af; // featured (1) before non-featured (0)
    if (af) {
      const ao = a.sort_order ?? Infinity;
      const bo = b.sort_order ?? Infinity;
      return ao - bo;
    }
    return 0; // non-featured tie → stable sort preserves insertion order
  });

  // Count themes (atlas + sabbatical contribute zero), sort by count desc.
  const themes = [...themeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);

  // Same shape for species — the dropdown shows most-photographed
  // species first.
  const species = [...speciesCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);

  // Group species by their majority wildlife class. Species with no
  // class tag (photos lacked the class — e.g. only "wildlife" was
  // emitted) fall into an "unclassified" bucket the UI can choose to
  // surface or hide.
  const speciesByClass: Record<string, string[]> = {};
  for (const sp of species) {
    const counts = speciesClassCounts.get(sp);
    let bestClass = 'unclassified';
    let bestN = 0;
    if (counts) {
      for (const [cls, n] of counts) {
        if (n > bestN) {
          bestN = n;
          bestClass = cls;
        }
      }
    }
    (speciesByClass[bestClass] ??= []).push(sp);
  }
  // Sort species alphabetically within each class for stable display.
  for (const cls of Object.keys(speciesByClass)) {
    speciesByClass[cls].sort((a, b) => a.localeCompare(b));
  }

  // Countries: present in any photo, sorted by display name asc. The
  // slug field is the ISO-3 code (storage format). Display layer uses
  // the name. A code missing from the locations table is a build-time
  // error so unmapped values can't silently slip through to the client.
  const usedCountries = new Set(photos.map((p) => p.country).filter(Boolean) as string[]);
  const countries = [...usedCountries]
    .map((code) => {
      const continent = CONTINENT_BY_CODE[code];
      if (!continent) {
        throw new Error(
          `build-photography-manifest: no continent mapped for country code '${code}'. ` +
            `Add it to scripts/locations.ts.`,
        );
      }
      return {
        slug: code,
        name: countryNames.get(code) ?? countryNameForCode(code),
        continent,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const manifest: PhotographyManifest = {
    photos,
    themes,
    species,
    speciesByClass,
    countries,
  };

  // Write disk artifact (consumed by dev server fetch fallback).
  const outPath = join(ROOT, 'data', 'photography-manifest.json');
  writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');

  console.log(
    `  photography manifest: ${photos.length} photos, ${themes.length} themes, ` +
    `${species.length} species, ${countries.length} countries` +
    (droppedDupes > 0 ? ` (${droppedDupes} dupes filtered)` : ''),
  );
  return manifest;
}

// Allow direct invocation: `bun run scripts/build-photography-manifest.ts`
if (import.meta.main) {
  await buildPhotographyManifest();
}
