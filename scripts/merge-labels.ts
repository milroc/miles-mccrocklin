// Merge label events into the canonical output files the build reads.
//
// Inputs
//   data/photography.json                  ← STRUCTURAL ONLY (id/src/aspect/dupeOf)
//   data/me.json                           ← structural for me-*
//   data/photo-atlas.json                  ← structural for atlas-*
//   data/photography-labels/
//     ingest/{ts}.jsonl                    ← per-ingest EXIF inferences
//     ai/{ts}.jsonl  + bootstrap-*.jsonl   ← classifier output
//     human/{ts}.jsonl                     ← curator notes + explicit toggles
//     refined/{ts}.jsonl                   ← DERIVED — written by this script
//
// Outputs
//   data/photography.json                  ← rewritten with merged labels
//                                            (structural fields preserved)
//   data/photo-classifications.json        ← rewritten as src-keyed table
//
// Each .jsonl line is one event:
//   {"v":1,"id":"<namespaced-id>","timestamp":"<ISO>","fields":{...}}
//
// Merge precedence (per field, highest first):
//   human > refined > ai > ingest
//
// Rationale: a human explicit value is a direct assertion ("the country
// is antarctica"). Refinement is an LLM interpretation of notes. So
// human wins for the SPECIFIC FIELD they touched; refinement still
// flows through for every other field on the same photo. Notes that
// describe corrections (without an explicit structured override) reach
// the merged output via the refined tier.
//
// Within a tier, the latest event wins per field. "Latest" = highest
// timestamp; if two events for the same field have identical timestamps,
// the later one in the file/filename order wins (stable secondary sort).
//
// Empty-value semantic
//   - human tier:        empty/null/[] → CLEAR the field (curator gesture)
//   - ai/ingest/refined: empty/null/[] → NO-OP ("no opinion" omits the key)
//
// Refinement (the generative step)
//   For each photo with BOTH a human note AND an AI label, the merger
//   runs an LLM prompt that takes the AI labels + the notes + the
//   image and outputs improved structured labels. The output is
//   appended as a refined event (one per refinement run). The merger
//   fingerprints (latest-human-ts, latest-ai-ts) for each photo; if a
//   refined event already has that fingerprint, it's reused. The
//   --skip-refine flag turns the prompt off entirely (e.g. for CI).
//
// Run:
//   bun run scripts/merge-labels.ts                  # normal merge + refine
//   bun run scripts/merge-labels.ts --skip-refine    # deterministic only
//   bun run scripts/merge-labels.ts --dry-run        # don't write outputs
//   bun run scripts/merge-labels.ts --verbose        # per-event log
//   bun run scripts/merge-labels.ts --strict         # exit 1 on bad JSONL

import {
  appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync,
  renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import type { JsonObject, JsonValue } from '../src/utils/json';
import {
  chatText, DEFAULT_CLAUDE_MODEL, DEFAULT_ENDPOINT, ensureLmStudioRunning,
  ensureTextModelLoaded, extractJsonObject, isClaudeCliAvailable,
  type ChatBackend,
} from './lm-client';
import {
  ALL_COUNTRY_CODES, countryNameForCode, LOCATIONS, normalizeCountryCode,
} from '../src/utils/locations';
import { LEGACY_THEME_REWRITES } from '../src/photography/categories';

// Theme rewrites applied by applyTier. Legacy values (`portrait`,
// `documentary`, etc.) get mapped or dropped before they reach the
// merged output. Source of truth: src/photography/categories.ts.
const THEME_REWRITES: Record<string, string | null> = LEGACY_THEME_REWRITES;

const ROOT = resolve(import.meta.dir, '..');
const DATA_DIR = join(ROOT, 'data');
const PHOTOGRAPHY_JSON = join(DATA_DIR, 'photography.json');
const PHOTO_CLASSIFICATIONS_JSON = join(DATA_DIR, 'photo-classifications.json');
const ME_JSON = join(DATA_DIR, 'me.json');
const ATLAS_JSON = join(DATA_DIR, 'photo-atlas.json');
const LABELS_DIR = join(DATA_DIR, 'photography-labels');

// Structural fields live on photography.json directly. The labels
// pipeline never overrides these — they identify the file, not its
// content.
const STRUCTURAL = new Set(['id', 'src', 'aspect']);

// Fields any label event is permitted to set. Anything else in a JSONL
// event is ignored so the schema stays explicit. dupeOf is curator-
// authored identity ("this photo is the same as that one"), so it
// flows through labels even though it lives on the entry row at
// output time.
const LABEL_FIELDS = new Set([
  'caption', 'alt', 'country', 'city', 'state', 'theme', 'species', 'story',
  'entities', 'album_url', 'featured', 'graphic', 'curator_notes',
  'dupeOf',
  // Per-photo critique scores (0-100) + a short notes string. Written
  // by scripts/photography-crit.ts as a second vision pass independent
  // of classify-photography. Excluded from REFINED_FIELDS — the
  // note-refinement and dupe-merge prompts don't second-guess scores;
  // crit fields are pure AI judgement.
  'crit_score', 'crit_composition', 'crit_lighting', 'crit_subject',
  'crit_emotion', 'crit_technical', 'crit_notes',
  'crit_composition_notes', 'crit_lighting_notes', 'crit_subject_notes',
  'crit_emotion_notes', 'crit_technical_notes',
  // Array of { type, action } prescriptions emitted by the new crit
  // prompt. Carried through verbatim — the merger doesn't merge or
  // dedupe across runs; latest-wins replaces the whole array, same
  // as any other AI-tier field.
  'crit_feedback',
  // Curator-assigned global ranking. Lower wins (sort ascending = best
  // first). Set in batches via the review tool's list-view drag-and-
  // drop "Save order" button. The manifest builder sorts the photos
  // array by this field at the end of buildPhotographyManifest, so the
  // ranking propagates to every downstream consumer (Photography.tsx
  // filter passes, MasonryWall tile order, etc.) for free.
  'sort_order',
  // Curator triage flags — human-tier only. Both are filter signals
  // for the merger, not labels shipped to the public manifest:
  //   omit       — drop the entry from photography.json /
  //                photo-classifications.json output entirely
  //   needs_edit — keep the entry, but list it on stdout so the
  //                curator knows which sources to re-process externally
  //                (e.g. open in Lightroom and re-export).
  // Excluded from toPhotographyOutput / toClassificationFields below
  // so they never leak into the build manifest.
  'omit', 'needs_edit',
]);

// Fields a refined event is allowed to produce. The refinement prompt
// is constrained to the AI-classifiable structured set — it doesn't
// touch curator_notes (the human's own prose) or the explicit toggles
// (featured / graphic / dupeOf / album_url). city + state are
// optional: the prompt can lift them from curator notes when the
// notes mention a place ("this was in Munich, Germany" → city=Munich,
// state="", country=deu).
const REFINED_FIELDS = new Set([
  'caption', 'alt', 'country', 'city', 'state', 'theme', 'species',
  'story', 'entities',
]);

// Prose fields the UI shows verbatim. Tracked through applyTier so the
// merged output carries a `prose_provenance` map recording which tier
// supplied the final value — used downstream to render a "by AI" badge
// when the prose was written (or rewritten) by the LLM. Only ai/refined
// tiers populate the map; human + ingest leave the field unmarked, so
// absence in the map = human-authored or structural.
const PROSE_FIELDS = new Set(['caption', 'alt', 'story']);

// Country values are stored as ISO-3166-1 alpha-3 codes (USA, DEU,
// GBR, ATA, ...). Anything else gets normalized via the locations
// table (kebab-case legacy slugs, alpha-2 codes, display names,
// aliases). Inputs that don't resolve are dropped at output time so
// the manifest builder doesn't choke on a code it can't map to a
// continent. Single source of truth: scripts/locations.ts.
function normalizeCountrySlug(raw: JsonValue): string | undefined {
  return normalizeCountryCode(raw);
}

type Tier = 'ingest' | 'ai' | 'human' | 'refined';

interface LabelEvent {
  v?: number;
  id: string;
  timestamp: string;
  tier: Tier;
  sessionFile: string;
  fields: JsonObject;
  // refined events embed the fingerprint of inputs they came from so
  // we can detect when the inputs have changed and re-refine.
  source_fingerprint?: { human: string; ai: string };
  // Subtype tag for refined events. Today: "notes" (note-refinement,
  // implicit when absent) or "dupe-merge" (dupe-cluster merger).
  kind?: string;
  // For kind=dupe-merge: hash-like signature of the cluster's input
  // states. When the signature changes the cluster gets re-merged.
  dupe_signature?: string;
}

interface AtlasEntry {
  country: string;
  country_slug: string;
  image?: string;
}

type MeItem = {
  id: string;
  type?: string;
  src: string;
  aspect?: number;
};

// Parse rather than assume: an item missing id or src is reported and
// skipped instead of merging labels onto an undefined key.
function isMeItem(it: JsonValue): it is MeItem {
  return (
    typeof it === 'object' &&
    it !== null &&
    !Array.isArray(it) &&
    typeof it.id === 'string' &&
    typeof it.src === 'string' &&
    (it.type === undefined || typeof it.type === 'string') &&
    (it.aspect === undefined || typeof it.aspect === 'number')
  );
}

interface MergedEntry {
  id: string;          // namespaced (photo-* / me-* / atlas-*)
  src: string;
  aspect?: number;
  dupeOf?: string;
  // Plus arbitrary label fields applied by the merge.
  [k: string]: JsonValue;
}

// ─── Helpers exported for callers (review-photos, classify, ingest) ──

export function ensureLabelsDir(tier: Tier): string {
  const dir = join(LABELS_DIR, tier);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Filesystem-safe ISO timestamp for filenames: 2026-05-22T18-04-12-345Z
export function sessionStamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

// Append a single event to the given tier's session file. Used by the
// writer scripts (ingest, classify, review) so they share one append
// path rather than each reinventing it.
export function appendEvent(
  tier: Tier,
  sessionStampStr: string,
  id: string,
  fields: JsonObject,
  extras: Partial<Pick<LabelEvent, 'source_fingerprint'>> = {},
): void {
  const dir = ensureLabelsDir(tier);
  const path = join(dir, `${sessionStampStr}.jsonl`);
  const event: LabelEvent = {
    v: 1,
    id,
    timestamp: new Date().toISOString(),
    tier,
    sessionFile: sessionStampStr,
    fields,
    ...extras,
  };
  // tier+sessionFile aren't actually stored on disk — they're derived
  // when loading. Strip them before serializing so the on-disk schema
  // matches what the original bootstrap import wrote (and what humans
  // expect to see when they cat a file).
  const onDisk = {
    v: event.v,
    id: event.id,
    timestamp: event.timestamp,
    ...(event.source_fingerprint && { source_fingerprint: event.source_fingerprint }),
    fields: event.fields,
  };
  appendFileSync(path, JSON.stringify(onDisk) + '\n');
}

// ─── Loading + merging ────────────────────────────────────────────────

function listJsonl(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
}

function loadEvents(tier: Tier, strict: boolean): LabelEvent[] {
  const dir = join(LABELS_DIR, tier);
  const events: LabelEvent[] = [];
  for (const f of listJsonl(dir)) {
    const path = join(dir, f);
    const sessionFile = f.replace(/\.jsonl$/, '');
    const text = readFileSync(path, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        const msg = `merge-labels: malformed line in ${path}: ${trimmed.slice(0, 80)}`;
        if (strict) { console.error(msg); process.exit(1); }
        console.warn(msg);
        continue;
      }
      if (typeof parsed !== 'object' || parsed === null) continue;
      const o = parsed as JsonObject;
      if (typeof o.id !== 'string' || typeof o.fields !== 'object' || o.fields === null) continue;
      if (o.v == null) {
        const msg = `merge-labels: ${path}: event missing "v" version field — assuming v=1`;
        if (strict) { console.error(msg); process.exit(1); }
        console.warn(msg);
      }
      const event: LabelEvent = {
        v: typeof o.v === 'number' ? o.v : undefined,
        id: o.id,
        timestamp: typeof o.timestamp === 'string' ? o.timestamp : sessionFile,
        tier,
        sessionFile,
        fields: o.fields as JsonObject,
      };
      // The three optional fields are written only when the event line
      // carried them, so a missing key stays missing rather than
      // becoming an explicit undefined the writer would round-trip.
      if (o.source_fingerprint && typeof o.source_fingerprint === 'object') {
        event.source_fingerprint = o.source_fingerprint as { human: string; ai: string };
      }
      if (typeof o.kind === 'string') event.kind = o.kind;
      if (typeof o.dupe_signature === 'string') event.dupe_signature = o.dupe_signature;
      events.push(event);
    }
  }
  // Sort chronologically (sessionFile is the tiebreaker since session
  // stamps are filesystem-safe ISO timestamps).
  events.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
    return a.sessionFile < b.sessionFile ? -1 : a.sessionFile > b.sessionFile ? 1 : 0;
  });
  return events;
}

// Walk me.json's nested structure for sabbatical-travel items. Matches
// loadSabbaticalTravel in classify-photography.ts so the two scripts
// agree on what counts as a sabbatical photo.
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
            `merge-labels: skipped ${items.length - parsed.length} sabbatical-travel item(s) missing id/src`,
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

interface BaseMap {
  // namespaced id → structural entry. Order across the photography
  // array is preserved separately (in photographyOrder).
  entries: Map<string, MergedEntry>;
  photographyOrder: string[];   // namespaced photo-* ids in source order
  meEntries: MeItem[];          // src-keyed lookup happens off this
  atlasEntries: AtlasEntry[];
  // src → namespaced-id for me-* and atlas-* (used when writing the
  // src-keyed photo-classifications.json output).
  idToSrc: Map<string, string>;
  srcToId: Map<string, string>;
}

function buildBaseMap(): BaseMap {
  const entries = new Map<string, MergedEntry>();
  const photographyOrder: string[] = [];
  const idToSrc = new Map<string, string>();
  const srcToId = new Map<string, string>();

  // photo-* entries from the (structural-only) photography.json.
  const photoRaw = JSON.parse(readFileSync(PHOTOGRAPHY_JSON, 'utf8')) as Array<JsonObject>;
  for (const e of photoRaw) {
    const bareId = e.id as string;
    if (!bareId) continue;
    const nsId = `photo-${bareId}`;
    const entry: MergedEntry = {
      id: nsId,
      src: e.src as string,
      ...(typeof e.aspect === 'number' && { aspect: e.aspect }),
      ...(typeof e.dupeOf === 'string' && { dupeOf: e.dupeOf }),
    };
    if (!entries.has(nsId)) {
      // Dedupe entries with the same id. The source file occasionally
      // contains duplicates left over from manual edits; the last-seen
      // structural values win (Map.set below), but we only push the
      // id into the order array once.
      photographyOrder.push(nsId);
    }
    entries.set(nsId, entry);
    idToSrc.set(nsId, e.src as string);
    srcToId.set(e.src as string, nsId);
  }

  // me-* entries from me.json sabbatical-travel.
  const me = JSON.parse(readFileSync(ME_JSON, 'utf8')) as JsonObject;
  const meItems = loadSabbaticalItems(me).filter((it) => !it.type || it.type === 'image');
  for (const item of meItems) {
    const nsId = `me-${item.id}`;
    const entry: MergedEntry = {
      id: nsId,
      src: item.src,
      ...(typeof item.aspect === 'number' && { aspect: item.aspect }),
    };
    entries.set(nsId, entry);
    idToSrc.set(nsId, item.src);
    srcToId.set(item.src, nsId);
  }

  // atlas-* entries from photo-atlas.json.
  const atlas = JSON.parse(readFileSync(ATLAS_JSON, 'utf8')) as AtlasEntry[];
  for (const a of atlas) {
    if (!a.image) continue;
    const nsId = `atlas-${a.country_slug}`;
    const entry: MergedEntry = {
      id: nsId,
      src: a.image,
    };
    entries.set(nsId, entry);
    idToSrc.set(nsId, a.image);
    srcToId.set(a.image, nsId);
  }

  return { entries, photographyOrder, meEntries: meItems, atlasEntries: atlas, idToSrc, srcToId };
}

interface ApplyStats { applied: number; cleared: number; skipped: number; }

// Apply one tier's events onto the merged map. The empty-value
// semantic depends on the tier: human clears the field on empty,
// every other tier treats empty as "no opinion".
function applyTier(
  base: Map<string, MergedEntry>,
  events: LabelEvent[],
  tier: Tier,
  allowedFields: Set<string>,
  verbose: boolean,
): ApplyStats {
  const stats: ApplyStats = { applied: 0, cleared: 0, skipped: 0 };
  for (const ev of events) {
    const entry = base.get(ev.id);
    if (!entry) {
      if (verbose) console.log(`  [${tier}] skip — no base entry for ${ev.id}`);
      stats.skipped += 1;
      continue;
    }
    for (const [k, v] of Object.entries(ev.fields)) {
      if (!allowedFields.has(k)) continue;
      const isEmpty =
        v == null ||
        v === '' ||
        (Array.isArray(v) && v.length === 0);
      if (isEmpty) {
        if (tier === 'human') {
          delete entry[k];
          clearProseProvenance(entry, k);
          stats.cleared += 1;
        }
        // ai / ingest / refined: empty = no-op
        continue;
      }
      // Country slugs are constrained by the manifest builder's
      // continent map. Normalize any aliases ("united-states" →
      // "united-states-of-america"); drop unrecognized values so the
      // build never sees a slug it can't continent-map.
      if (k === 'country') {
        const norm = normalizeCountrySlug(v);
        if (!norm) {
          if (verbose) console.log(`  [${tier}] drop unknown country slug "${v}" on ${ev.id}`);
          continue;
        }
        entry[k] = norm;
        stats.applied += 1;
        continue;
      }
      // Theme tags: apply the legacy-rewrite map so old classifier
      // output (portrait → people, drop documentary, etc.) maps onto
      // the current taxonomy without re-running classify on every
      // photo. Dedupes the resulting array.
      if (k === 'theme' && Array.isArray(v)) {
        const out: string[] = [];
        const seen = new Set<string>();
        for (const raw of v) {
          if (typeof raw !== 'string') continue;
          const trimmed = raw.trim();
          if (!trimmed) continue;
          const mapped = THEME_REWRITES[trimmed];
          const final = mapped === undefined ? trimmed : mapped;
          if (final === null) continue;     // explicit drop (documentary, etc.)
          if (seen.has(final)) continue;
          seen.add(final);
          out.push(final);
        }
        if (out.length === 0) continue;
        entry[k] = out;
        stats.applied += 1;
        continue;
      }
      entry[k] = v;
      if (PROSE_FIELDS.has(k)) setProseProvenance(entry, k, tier);
      stats.applied += 1;
    }
  }
  return stats;
}

// Record the tier that supplied a prose field's final value on the
// merged entry. Only ai / refined are tracked — human + ingest writes
// clear any prior mark so absence in the map means "human-authored or
// structural", which is what the downstream UI keys off when deciding
// whether to render a "by AI" badge.
function setProseProvenance(entry: MergedEntry, field: string, tier: Tier): void {
  if (tier === 'ai' || tier === 'refined') {
    let map = entry.prose_provenance as Record<string, string> | undefined;
    if (!map) {
      map = {};
      entry.prose_provenance = map;
    }
    map[field] = tier;
    return;
  }
  // human / ingest: clear any previous AI mark — the latest write isn't
  // AI prose anymore.
  clearProseProvenance(entry, field);
}

function clearProseProvenance(entry: MergedEntry, field: string): void {
  const map = entry.prose_provenance as Record<string, string> | undefined;
  if (!map) return;
  if (!(field in map)) return;
  delete map[field];
  if (Object.keys(map).length === 0) delete entry.prose_provenance;
}

// ─── Refinement (generative tier) ─────────────────────────────────────

// Build the prompt that turns AI labels + curator notes → improved
// structured labels. Kept here rather than in lm-client because the
// shape (which fields are expected back) is merger-specific.
function buildRefinePrompt(aiLabels: JsonObject, notes: string): string {
  return [
    'You refine structured labels for a single photograph in a personal',
    'portfolio. The AI classifier produced labels from the image alone.',
    'The photographer added freeform notes that the AI could not see —',
    'names of people, places only the photographer recognizes, the story',
    'behind the shot, and corrections to AI mistakes. The notes may',
    'include speech-to-text artifacts (filler words, repeated phrases,',
    'typos) — treat them as a guide to intent, not as literal copy.',
    '',
    'Rules:',
    '- The photographer\'s notes are authoritative for facts. Use them to',
    '  correct AI mistakes (wrong species, country, tone).',
    '- Keep AI values that the notes do not contradict.',
    '- Omit any field you have no opinion on. Never invent.',
    '',
    'Fields:',
    '- caption: short editorial title, under ~12 words, no trailing period.',
    '- alt: descriptive 1-2 sentence text for screen readers, ends with period.',
    '- country: EXACTLY one ISO-3166-1 alpha-3 code (lowercase) from the allowed list below, or empty string if unsure. Allowed codes (with the country they map to): ' + LOCATIONS.map((r) => r.code + '=' + r.name).join(', ') + '.',
    '- city: city name (or "" if unsure or unmentioned). Title-cased, no abbreviations.',
    '- state: state / province / region (or "" if unsure or unmentioned). Use the local-language name when notable.',
    '- theme: array of category tags.',
    '- species: common-English species name when wildlife, else empty string.',
    '- story: 1-3 sentence narrative interpretation.',
    '- entities: array of 3-12 concrete nouns visible in the photo.',
    '',
    'Example output (illustration only — do NOT copy these values):',
    '{"caption":"Iguazú at dawn","alt":"Wide misty falls flowing over basalt cliffs at golden hour.","country":"arg","city":"Puerto Iguazú","state":"Misiones","theme":["landscape","water"],"species":"","story":"Morning light spills across the falls, long curtains of mist rising into pink sky.","entities":["waterfalls","mist","basalt rocks","river"]}',
    '',
    'AI labels (current):',
    JSON.stringify(aiLabels),
    '',
    'Photographer\'s notes:',
    notes,
    '',
    'Reply with ONE single-line JSON object and nothing else — no prose,',
    'no thinking, no markdown fences, no commentary before or after.',
  ].join('\n');
}

// Resolve "what does the AI tier currently say for this photo?" by
// walking all AI events for that id and taking the latest value per
// field. Same logic as applyTier but scoped to one id, so we can feed
// the result to the refinement prompt without going through the full
// merge first.
function resolveAiState(
  id: string,
  aiEvents: LabelEvent[],
): JsonObject {
  const out: JsonObject = {};
  for (const ev of aiEvents) {
    if (ev.id !== id) continue;
    for (const [k, v] of Object.entries(ev.fields)) {
      if (!LABEL_FIELDS.has(k)) continue;
      if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
      out[k] = v;
    }
  }
  return out;
}

// Concatenate every human curator_notes for a photo, in chronological
// order, so the prompt sees the curator's full thinking even across
// multiple sessions.
function collectHumanNotes(id: string, humanEvents: LabelEvent[]): string {
  const chunks: string[] = [];
  for (const ev of humanEvents) {
    if (ev.id !== id) continue;
    const note = ev.fields.curator_notes;
    if (typeof note !== 'string' || !note.trim()) continue;
    chunks.push(note.trim());
  }
  return chunks.join('\n\n');
}

interface RefineContext {
  endpoint: string;
  model: string;
  backend: ChatBackend;
  // When true, emit a single `PROGRESS {json}` line per per-photo
  // outcome so the SSE endpoint in review-photos can parse it.
  emitProgress?: boolean;
}

// Single-line machine-readable status event. The streaming merge
// endpoint in scripts/review-photos.ts scans stdout for these and
// pumps them out as SSE events with the same shape.
function emitProgressLine(ctx: RefineContext, event: JsonObject): void {
  if (!ctx.emitProgress) return;
  process.stdout.write('PROGRESS ' + JSON.stringify(event) + '\n');
}

async function runRefinement(
  base: Map<string, MergedEntry>,
  aiEvents: LabelEvent[],
  humanEvents: LabelEvent[],
  existingRefined: LabelEvent[],
  ctx: RefineContext,
  verbose: boolean,
  scope: Set<string> | null = null,
): Promise<{ ran: number; reused: number; failed: number; refinedFile: string | null }> {
  // Index latest AI event timestamp + latest human event timestamp per id.
  const latestAi = new Map<string, string>();
  for (const ev of aiEvents) latestAi.set(ev.id, ev.timestamp);
  const latestHuman = new Map<string, string>();
  for (const ev of humanEvents) {
    const note = ev.fields.curator_notes;
    if (typeof note !== 'string' || !note.trim()) continue;
    latestHuman.set(ev.id, ev.timestamp);
  }

  // Photos eligible for refinement: have BOTH a human note and an AI
  // label, AND (when --latest-session is set) appear in the scoped id
  // set so we only re-refine what the curator touched recently.
  const candidates: string[] = [];
  for (const id of latestHuman.keys()) {
    if (!latestAi.has(id)) continue;
    if (scope && !scope.has(id)) continue;
    candidates.push(id);
  }

  if (candidates.length === 0) {
    if (verbose) console.log('  [refine] 0 candidates (no photos have both notes and AI labels)');
    return { ran: 0, reused: 0, failed: 0, refinedFile: null };
  }

  // Index existing refined events by id → latest fingerprint.
  const lastRefined = new Map<string, { human: string; ai: string }>();
  for (const ev of existingRefined) {
    if (!ev.source_fingerprint) continue;
    lastRefined.set(ev.id, ev.source_fingerprint);
  }

  // Walk candidates, run the prompt for any whose fingerprint changed.
  let ran = 0, reused = 0, failed = 0;
  let refinedFile: string | null = null;
  const sessionStampStr = sessionStamp();
  for (const id of candidates) {
    const fingerprint = {
      human: latestHuman.get(id)!,
      ai: latestAi.get(id)!,
    };
    const prev = lastRefined.get(id);
    if (prev && prev.human === fingerprint.human && prev.ai === fingerprint.ai) {
      reused += 1;
      if (verbose) console.log(`  [refine] reuse ${id} (fingerprint unchanged)`);
      emitProgressLine(ctx, { kind: 'refine', status: 'cached', id });
      continue;
    }
    emitProgressLine(ctx, { kind: 'refine', status: 'running', id });
    const entry = base.get(id);
    if (!entry) {
      failed += 1;
      if (verbose) console.log(`  [refine] skip ${id} — no base entry`);
      emitProgressLine(ctx, { kind: 'refine', status: 'failed', id, reason: 'no base entry' });
      continue;
    }
    const aiLabels = resolveAiState(id, aiEvents);
    const notes = collectHumanNotes(id, humanEvents);
    try {
      // Pure text refinement — the AI labels + curator notes carry
      // everything the model needs. No image is sent, so a smaller
      // text-only model is fine here (classify-photography is where
      // the vision pass lives).
      // No max_tokens cap — let the model run to its natural stop.
      // Reasoning models can produce long <think>…</think> preambles
      // before emitting JSON; capping caused empty-content failures.
      const raw = await chatText({
        endpoint: ctx.endpoint,
        model: ctx.model,
        backend: ctx.backend,
        prompt: buildRefinePrompt(aiLabels, notes),
      });
      const parsed = extractJsonObject(raw);
      const fields: JsonObject = {};
      for (const k of Object.keys(parsed)) {
        if (!REFINED_FIELDS.has(k)) continue;
        const v = parsed[k];
        if (v == null) continue;
        if (typeof v === 'string' && v.trim() === '') continue;
        if (Array.isArray(v) && v.length === 0) continue;
        if (k === 'country') {
          const norm = normalizeCountrySlug(v);
          if (norm) fields[k] = norm;
          continue;
        }
        fields[k] = v;
      }
      if (Object.keys(fields).length === 0) {
        if (verbose) console.log(`  [refine] ${id} produced no fields, skipping write`);
        continue;
      }
      if (refinedFile == null) {
        refinedFile = join(ensureLabelsDir('refined'), `${sessionStampStr}.jsonl`);
      }
      const event = {
        v: 1,
        id,
        timestamp: new Date().toISOString(),
        source_fingerprint: fingerprint,
        fields,
      };
      appendFileSync(refinedFile, JSON.stringify(event) + '\n');
      ran += 1;
      console.log(`  [refine] ${id} → ${Object.keys(fields).join(', ')}`);
      emitProgressLine(ctx, { kind: 'refine', status: 'done', id, fields });
    } catch (e) {
      failed += 1;
      const msg = (e as Error).message;
      console.warn(`  [refine] ${id} FAILED: ${msg}`);
      emitProgressLine(ctx, { kind: 'refine', status: 'failed', id, reason: msg });
    }
  }
  return { ran, reused, failed, refinedFile };
}

// ─── Dupe merge (generative tier — same JSONL file, different prompt) ─
//
// When the curator marks photo A as a duplicate of B (sets A.dupeOf=B),
// the merger calls the LLM with both images + both photos' current
// merged metadata. The model produces improved structured labels for
// the canonical (B), incorporating useful detail from the duplicate (A).
// The dupe still gets its dupeOf set in the merged output; the display
// layer is what hides it.
//
// Chains: A.dupeOf=B + B.dupeOf=C → cluster {A, B} → canonical C.
// Cycles: A.dupeOf=B + B.dupeOf=A → warn, skip the cluster.
//
// Fingerprint: sorted ids + their latest event timestamps. If a
// refined event with kind=dupe-merge already has that fingerprint, the
// cluster is up to date and we skip it.

const DUPE_KIND = 'dupe-merge';

// Resolve a chain of dupeOf pointers to find the ultimate canonical id.
// Returns null on cycle or when the chain points at a non-existent id.
function resolveCanonical(
  id: string,
  dupeOfMap: Map<string, string>,
  base: Map<string, MergedEntry>,
): string | null {
  const seen = new Set<string>();
  let cursor = id;
  while (true) {
    if (seen.has(cursor)) return null;  // cycle
    seen.add(cursor);
    const next = dupeOfMap.get(cursor);
    if (!next) return base.has(cursor) ? cursor : null;
    if (!base.has(next)) return null;   // points at unknown
    cursor = next;
  }
}

// Compute the "current merged state" for a single id by applying all
// tiers (ingest → ai → refined → human) in order, respecting the same
// empty-value semantic the main merge uses. The dupe-merge prompt
// receives this so it sees what each photo currently looks like in the
// canonical pipeline output.
function resolveCurrentState(
  id: string,
  ingestEvents: LabelEvent[],
  aiEvents: LabelEvent[],
  refinedEvents: LabelEvent[],
  humanEvents: LabelEvent[],
): JsonObject {
  const out: JsonObject = {};
  const apply = (events: LabelEvent[], tier: Tier, allowed: Set<string>) => {
    for (const ev of events) {
      if (ev.id !== id) continue;
      for (const [k, v] of Object.entries(ev.fields)) {
        if (!allowed.has(k)) continue;
        const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0);
        if (empty) {
          if (tier === 'human') delete out[k];
          continue;
        }
        out[k] = v;
      }
    }
  };
  apply(ingestEvents, 'ingest', LABEL_FIELDS);
  apply(aiEvents, 'ai', LABEL_FIELDS);
  apply(refinedEvents, 'refined', REFINED_FIELDS);
  apply(humanEvents, 'human', LABEL_FIELDS);
  return out;
}

// Stable fingerprint for a dupe cluster: canonical id, plus each
// dupe id paired with the timestamp of its latest event (across any
// tier). If any photo in the cluster gains a new event, the
// fingerprint changes and the cluster gets re-merged.
function clusterFingerprint(
  canonicalId: string,
  dupeIds: string[],
  allEvents: LabelEvent[],
): string {
  const latestByid = new Map<string, string>();
  for (const ev of allEvents) {
    // Skip the dupe-merge pass's own output events: including them
    // makes the canonical's latest-timestamp advance on every run, so
    // the stored signature never matches and every cluster re-runs
    // through the LLM on every merge.
    if (ev.kind === DUPE_KIND) continue;
    const prev = latestByid.get(ev.id);
    if (!prev || prev < ev.timestamp) latestByid.set(ev.id, ev.timestamp);
  }
  const ids = [canonicalId, ...dupeIds].sort();
  return ids.map((id) => `${id}@${latestByid.get(id) ?? '-'}`).join(';');
}

function buildDupeMergePrompt(
  canonicalState: JsonObject,
  dupes: Array<{ id: string; state: JsonObject }>,
): string {
  const lines: string[] = [
    'Multiple photographs of the same scene were marked as duplicates by',
    'the photographer. The "Canonical" block describes the photo the',
    'photographer chose to keep visible; the "Duplicate" blocks are',
    'hidden in the final output, but their accumulated metadata carries',
    'useful detail.',
    '',
    'Produce improved structured labels for the canonical that fold in',
    'the best content from every side.',
    '',
    'Rules:',
    '- Treat any curator-authored content as authoritative for facts.',
    '- Prefer the more specific value when fields disagree ("Iguazú Falls"',
    '  beats "waterfall"; "emperor penguin" beats "penguin").',
    '- For arrays (theme, entities), output a deduplicated union of the',
    '  inputs; trim entities to the 12 most relevant.',
    '- For caption / alt / story, pick the writing that reads strongest —',
    '  favor accurate, concrete language over generic description.',
    '- DO NOT change which photo is canonical. The photographer chose.',
    '- Omit any field you have no opinion on.',
    '',
    'Output fields: caption, alt, country (ISO-3166-1 alpha-3 lowercase), city, state, theme, species, story, entities.',
    '',
    'Example output (illustration only — do NOT copy these values):',
    '{"caption":"Iguazú at dawn","alt":"Wide misty falls flowing over basalt cliffs at golden hour.","country":"arg","city":"Puerto Iguazú","state":"Misiones","theme":["landscape","water"],"species":"","story":"Morning light spills across the falls, long curtains of mist rising into pink sky.","entities":["waterfalls","mist","basalt rocks","river"]}',
    '',
    'Canonical labels:',
    JSON.stringify(canonicalState),
  ];
  for (let i = 0; i < dupes.length; i++) {
    lines.push(
      '',
      `Duplicate ${i + 1} (id=${dupes[i].id}):`,
      JSON.stringify(dupes[i].state),
    );
  }
  lines.push(
    '',
    'Reply with ONE single-line JSON object and nothing else — no prose,',
    'no thinking, no markdown fences, no commentary before or after.',
  );
  return lines.join('\n');
}

async function runDupeMerge(
  base: Map<string, MergedEntry>,
  ingestEvents: LabelEvent[],
  aiEvents: LabelEvent[],
  refinedEvents: LabelEvent[],
  humanEvents: LabelEvent[],
  ctx: RefineContext,
  verbose: boolean,
  scope: Set<string> | null = null,
): Promise<{ ran: number; reused: number; failed: number; refinedFile: string | null }> {
  // Resolve the latest dupeOf value per photo by walking ALL tiers.
  // Same precedence as the main merge: human last wins.
  const dupeOfMap = new Map<string, string>();
  const apply = (events: LabelEvent[], tier: Tier) => {
    for (const ev of events) {
      const v = ev.fields.dupeOf;
      if (v == null || v === '') {
        if (tier === 'human') dupeOfMap.delete(ev.id);
        continue;
      }
      if (typeof v === 'string') dupeOfMap.set(ev.id, v);
    }
  };
  apply(ingestEvents, 'ingest');
  apply(aiEvents, 'ai');
  apply(refinedEvents, 'refined');
  apply(humanEvents, 'human');

  if (dupeOfMap.size === 0) {
    if (verbose) console.log('  [dupe-merge] no dupeOf signals, nothing to do');
    return { ran: 0, reused: 0, failed: 0, refinedFile: null };
  }

  // Build clusters by resolving each dupe to its ultimate canonical.
  const clusters = new Map<string, string[]>();
  for (const dupeId of dupeOfMap.keys()) {
    const canonical = resolveCanonical(dupeId, dupeOfMap, base);
    if (!canonical || canonical === dupeId) {
      console.warn(`  [dupe-merge] skip ${dupeId} — cycle or unresolved canonical`);
      continue;
    }
    if (!clusters.has(canonical)) clusters.set(canonical, []);
    clusters.get(canonical)!.push(dupeId);
  }

  // When scoped to the latest session, drop any cluster that has no
  // overlap with the scope (none of its canonical or dupes were
  // touched recently). Costs nothing if scope is null.
  if (scope) {
    for (const [canonical, dupes] of [...clusters]) {
      const touches = scope.has(canonical) || dupes.some((d) => scope.has(d));
      if (!touches) clusters.delete(canonical);
    }
  }

  if (clusters.size === 0) {
    return { ran: 0, reused: 0, failed: 0, refinedFile: null };
  }

  // Index existing dupe-merge refined events by canonical id → fingerprint.
  const lastDupeMerge = new Map<string, string>();
  for (const ev of refinedEvents) {
    if (ev.kind !== DUPE_KIND) continue;
    if (typeof ev.dupe_signature === 'string') lastDupeMerge.set(ev.id, ev.dupe_signature);
  }
  const allEvents = [...ingestEvents, ...aiEvents, ...refinedEvents, ...humanEvents];

  let ran = 0, reused = 0, failed = 0;
  let refinedFile: string | null = null;
  const sessionStampStr = sessionStamp();
  for (const [canonicalId, dupeIds] of clusters) {
    const fingerprint = clusterFingerprint(canonicalId, dupeIds, allEvents);
    if (lastDupeMerge.get(canonicalId) === fingerprint) {
      reused += 1;
      if (verbose) console.log(`  [dupe-merge] reuse ${canonicalId} ← ${dupeIds.length} dupes (fingerprint unchanged)`);
      emitProgressLine(ctx, { kind: 'dupe-merge', status: 'cached', id: canonicalId, dupes: dupeIds });
      continue;
    }
    emitProgressLine(ctx, { kind: 'dupe-merge', status: 'running', id: canonicalId, dupes: dupeIds });
    const canonicalEntry = base.get(canonicalId);
    if (!canonicalEntry) {
      failed += 1;
      console.warn(`  [dupe-merge] skip ${canonicalId} — no base entry`);
      emitProgressLine(ctx, { kind: 'dupe-merge', status: 'failed', id: canonicalId, reason: 'no base entry' });
      continue;
    }

    const dupeStates: Array<{ id: string; state: JsonObject }> = [];
    let skipCluster = false;
    for (const dupeId of dupeIds) {
      const dupeEntry = base.get(dupeId);
      if (!dupeEntry) { skipCluster = true; break; }
      dupeStates.push({
        id: dupeId,
        state: resolveCurrentState(dupeId, ingestEvents, aiEvents, refinedEvents, humanEvents),
      });
    }
    if (skipCluster) {
      failed += 1;
      console.warn(`  [dupe-merge] skip cluster for ${canonicalId} — missing entry for a dupe`);
      continue;
    }

    const canonicalState = resolveCurrentState(
      canonicalId, ingestEvents, aiEvents, refinedEvents, humanEvents,
    );
    try {
      // Text-only merge — the curator already picked which photo is
      // canonical; the model's job is to fold textual metadata across
      // sides. No image inspection needed, so a small text model
      // works fine here. No max_tokens cap — let it run to its
      // natural stop, including any reasoning preamble.
      const raw = await chatText({
        endpoint: ctx.endpoint,
        model: ctx.model,
        backend: ctx.backend,
        prompt: buildDupeMergePrompt(canonicalState, dupeStates),
      });
      const parsed = extractJsonObject(raw);
      const fields: JsonObject = {};
      for (const k of Object.keys(parsed)) {
        if (!REFINED_FIELDS.has(k)) continue;
        const v = parsed[k];
        if (v == null) continue;
        if (typeof v === 'string' && v.trim() === '') continue;
        if (Array.isArray(v) && v.length === 0) continue;
        if (k === 'country') {
          const norm = normalizeCountrySlug(v);
          if (norm) fields[k] = norm;
          continue;
        }
        fields[k] = v;
      }
      if (Object.keys(fields).length === 0) {
        if (verbose) console.log(`  [dupe-merge] ${canonicalId} produced no fields, skipping write`);
        continue;
      }
      // Stamp the event with the dupe-merge kind + signature so the
      // next run can skip when nothing's changed.
      if (refinedFile == null) {
        refinedFile = join(ensureLabelsDir('refined'), `${sessionStampStr}.jsonl`);
      }
      const event = {
        v: 1,
        id: canonicalId,
        timestamp: new Date().toISOString(),
        kind: DUPE_KIND,
        dupe_signature: fingerprint,
        fields,
      };
      appendFileSync(refinedFile, JSON.stringify(event) + '\n');
      ran += 1;
      console.log(
        `  [dupe-merge] ${canonicalId} ← ${dupeIds.length} dupes ` +
        `→ ${Object.keys(fields).join(', ')}`,
      );
      emitProgressLine(ctx, { kind: 'dupe-merge', status: 'done', id: canonicalId, dupes: dupeIds, fields });
    } catch (e) {
      failed += 1;
      const msg = (e as Error).message;
      console.warn(`  [dupe-merge] ${canonicalId} FAILED: ${msg}`);
      emitProgressLine(ctx, { kind: 'dupe-merge', status: 'failed', id: canonicalId, reason: msg });
    }
  }
  return { ran, reused, failed, refinedFile };
}

// ─── Output writers ───────────────────────────────────────────────────

// Build the on-disk photography.json shape from a merged entry. Drops
// the `photo-` prefix to keep photography.json IDs bare (matches
// pre-pipeline format).
function toPhotographyOutput(entry: MergedEntry): JsonObject {
  const bareId = entry.id.startsWith('photo-') ? entry.id.slice('photo-'.length) : entry.id;
  const out: JsonObject = { id: bareId, src: entry.src };
  if (entry.aspect != null) out.aspect = entry.aspect;
  // Label fields in a deterministic order matching the pre-pipeline file.
  const labelOrder = [
    'caption', 'alt', 'country', 'city', 'state',
    'theme', 'species', 'story', 'entities',
    'prose_provenance',
    'crit_score', 'crit_composition', 'crit_composition_notes',
    'crit_lighting', 'crit_lighting_notes',
    'crit_subject', 'crit_subject_notes',
    'crit_emotion', 'crit_emotion_notes',
    'crit_technical', 'crit_technical_notes',
    'crit_notes', 'crit_feedback',
    'album_url', 'featured', 'graphic', 'sort_order',
    'dupeOf', 'curator_notes',
  ];
  for (const k of labelOrder) {
    if (entry[k] != null) out[k] = entry[k];
  }
  return out;
}

// Build the on-disk photo-classifications.json shape — src-keyed.
// Carries every label field me-/atlas- entries need, so curator
// overrides on those sources reach the manifest builder the same way
// they reach it for photo-* entries (which live in photography.json).
// curator_notes is intentionally excluded — it's pure provenance, not
// shipped to the public manifest.
function toClassificationFields(entry: MergedEntry): JsonObject {
  const out: JsonObject = {};
  for (const k of [
    'theme', 'caption', 'alt', 'story', 'entities',
    'country', 'city', 'state', 'species',
    'prose_provenance',
    'crit_score', 'crit_composition', 'crit_composition_notes',
    'crit_lighting', 'crit_lighting_notes',
    'crit_subject', 'crit_subject_notes',
    'crit_emotion', 'crit_emotion_notes',
    'crit_technical', 'crit_technical_notes',
    'crit_notes', 'crit_feedback',
    'album_url', 'featured', 'graphic', 'sort_order', 'dupeOf',
  ]) {
    if (entry[k] != null) out[k] = entry[k];
  }
  return out;
}

// ─── Main ─────────────────────────────────────────────────────────────

interface CliOptions {
  dryRun: boolean;
  verbose: boolean;
  strict: boolean;
  skipRefine: boolean;
  endpoint: string;
  model: string | null;
  backend: ChatBackend | null;     // null → auto (claude if CLI present)
  // When true, the refinement + dupe-merge passes only consider ids
  // that appear in the most-recent human/{ts}.jsonl session file.
  // Useful for fast iterations: label a batch in the review tool,
  // then merge just those photos without re-walking every prior session.
  // The deterministic precedence merge always processes every event
  // regardless of this flag — only the LLM passes get scoped.
  latestSession: boolean;
  // Per-photo mode: only refine + apply + WRITE the given ids (plus
  // their dupe-cluster siblings, which the dupe-merge prompt
  // necessarily touches). The output files keep every other entry
  // byte-identical so the review tool's per-card "Refine" button can
  // produce minimal, readable diffs. Empty list = full-corpus mode.
  only: string[];
  // Machine-parsable per-event status output on stdout. The SSE
  // streaming endpoint in review-photos parses these to drive the
  // UI's status badges + diff panels.
  emitProgress: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    dryRun: false,
    verbose: false,
    strict: false,
    skipRefine: false,
    endpoint: DEFAULT_ENDPOINT,
    model: null,
    backend: null,
    latestSession: false,
    only: [],
    emitProgress: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--dry-run':    opts.dryRun = true; break;
      case '--verbose':    opts.verbose = true; break;
      case '--strict':     opts.strict = true; break;
      case '--skip-refine':opts.skipRefine = true; break;
      case '--latest-session': opts.latestSession = true; break;
      case '--emit-progress': opts.emitProgress = true; break;
      case '--only': {
        const list = argv[++i];
        opts.only = list.split(',').map((s) => s.trim()).filter(Boolean);
        break;
      }
      case '--endpoint':   opts.endpoint = argv[++i]; break;
      case '--model':      opts.model = argv[++i]; break;
      case '--backend': {
        const v = argv[++i];
        if (v !== 'claude' && v !== 'lmstudio') {
          console.error(`--backend must be "claude" or "lmstudio", got ${v}`);
          process.exit(1);
        }
        opts.backend = v;
        break;
      }
      case '--help':
      case '-h':
        console.log(
          'Usage: bun run scripts/merge-labels.ts [options]\n' +
          '  --dry-run         do not write output files\n' +
          '  --verbose         per-event log\n' +
          '  --strict          exit 1 on malformed JSONL\n' +
          '  --skip-refine     skip the LLM refinement pass\n' +
          '  --latest-session  only refine/dupe-merge photos touched in the\n' +
          '                    most recent human session (fast iteration)\n' +
          '  --only <ids>      comma-separated list of namespaced ids to\n' +
          '                    refine + flush; partial output writes keep\n' +
          '                    every other entry byte-identical\n' +
          '  --emit-progress   machine-readable per-event status lines\n' +
          '                    (used by the review tool\'s SSE endpoint)\n' +
          '  --backend <name>  "claude" (default if `claude` CLI is on PATH)\n' +
          '                    or "lmstudio" (local LM Studio server)\n' +
          '  --endpoint <url>  LM Studio endpoint when --backend lmstudio\n' +
          '  --model <name>    model id (claude alias e.g. "sonnet"/"opus",\n' +
          '                    or LM Studio model id; auto-picked if omitted)',
        );
        process.exit(0);
      default:
        console.error(`Unknown option: ${a}`);
        process.exit(1);
    }
  }
  return opts;
}

export async function merge(opts: Partial<CliOptions> = {}): Promise<void> {
  const o: CliOptions = {
    dryRun: false, verbose: false, strict: false, skipRefine: false,
    endpoint: DEFAULT_ENDPOINT, model: null, backend: null,
    latestSession: false, only: [], emitProgress: false,
    ...opts,
  };

  // 1. Base map from structural sources.
  const baseMap = buildBaseMap();
  console.log(
    `merge-labels: base map → ${baseMap.entries.size} entries ` +
    `(${baseMap.photographyOrder.length} photo, ${baseMap.meEntries.length} me, ` +
    `${baseMap.atlasEntries.filter((a) => a.image).length} atlas)`,
  );

  // 2. Load events from every tier.
  const ingestEvents = loadEvents('ingest', o.strict);
  const aiEvents = loadEvents('ai', o.strict);
  const humanEvents = loadEvents('human', o.strict);
  const refinedEvents = loadEvents('refined', o.strict);
  console.log(
    `merge-labels: loaded events — ingest=${ingestEvents.length} ` +
    `ai=${aiEvents.length} human=${humanEvents.length} refined=${refinedEvents.length}`,
  );

  // 3. Refinement pass — adds new refined events when (human, ai)
  //    fingerprints have shifted. Skipped if --skip-refine or no
  //    eligible candidates.
  //
  //    --latest-session narrows refinement + dupe-merge to ids that
  //    appear in the most recent human/{ts}.jsonl. The merge below
  //    still applies every event regardless, so this is purely a
  //    cost optimization for fast iterations.
  let latestSessionScope: Set<string> | null = null;
  if (o.latestSession) {
    const lastFile = [...new Set(humanEvents.map((e) => e.sessionFile))].sort().pop();
    latestSessionScope = new Set(
      humanEvents.filter((e) => e.sessionFile === lastFile).map((e) => e.id),
    );
    console.log(
      `merge-labels: --latest-session → scoped to ${latestSessionScope.size} ids ` +
      `from human session "${lastFile ?? '(none)'}"`,
    );
  }

  // --only narrows refinement, dupe-merge, AND the output writes. We
  // expand the explicit id list to include any cluster siblings the
  // dupe-merge pass would touch, so the partial write covers the
  // canonical when the curator refines a dupe (or vice versa).
  let onlyScope: Set<string> | null = null;
  if (o.only.length > 0) {
    const expanded = new Set<string>(o.only);
    // Walk human dupeOf events to find cluster siblings transitively.
    // Same logic the dupe-merge pass uses to resolve canonical.
    const dupeOfMap = new Map<string, string>();
    for (const ev of humanEvents) {
      const v = ev.fields.dupeOf;
      if (v == null || v === '') { dupeOfMap.delete(ev.id); continue; }
      if (typeof v === 'string') dupeOfMap.set(ev.id, v);
    }
    // For each given id, pull in (a) anything pointing AT it (other
    // dupes of the same canonical) and (b) its canonical, transitively.
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of [...expanded]) {
        const target = dupeOfMap.get(id);
        if (target && !expanded.has(target)) { expanded.add(target); changed = true; }
      }
      for (const [dupeId, canonical] of dupeOfMap) {
        if (expanded.has(canonical) && !expanded.has(dupeId)) {
          expanded.add(dupeId); changed = true;
        }
      }
    }
    onlyScope = expanded;
    const added = expanded.size - o.only.length;
    console.log(
      `merge-labels: --only → scoped to ${expanded.size} id(s)` +
      (added > 0 ? ` (${added} pulled in as dupe-cluster siblings)` : ''),
    );
  }

  // Combine the scopes for the LLM passes: a candidate must be in
  // every active scope.
  const llmScope: Set<string> | null = onlyScope && latestSessionScope
    ? new Set([...onlyScope].filter((id) => latestSessionScope!.has(id)))
    : (onlyScope ?? latestSessionScope);
  if (!o.skipRefine) {
    const inScope = (id: string) =>
      llmScope == null || llmScope.has(id);
    const hasNoteCandidates = humanEvents.some((ev) => {
      if (!inScope(ev.id)) return false;
      const note = ev.fields.curator_notes;
      return typeof note === 'string' && note.trim() && aiEvents.some((a) => a.id === ev.id);
    });
    const hasDupeCandidates = humanEvents.some((ev) =>
      inScope(ev.id) &&
      typeof ev.fields.dupeOf === 'string' && (ev.fields.dupeOf as string).length > 0,
    );

    // Shared bootstrap: decide which backend to use, then prepare it.
    //   - "claude": shells out to `claude --print` (Max subscription).
    //     No local server to start; we just verify the CLI is present.
    //   - "lmstudio": starts the local server if needed and ensures a
    //     text-only model is loaded.
    // Default backend is "claude" when the CLI is on PATH; otherwise
    // LM Studio. Explicit --backend overrides.
    let textModel: string | null = null;
    let backend: ChatBackend | null = null;
    if (hasNoteCandidates || hasDupeCandidates) {
      const requested: ChatBackend = o.backend
        ?? (isClaudeCliAvailable() ? 'claude' : 'lmstudio');
      try {
        if (requested === 'claude') {
          if (!isClaudeCliAvailable()) {
            throw new Error(
              '`claude` CLI is not on PATH. Install Claude Code or pass --backend lmstudio.',
            );
          }
          textModel = o.model ?? DEFAULT_CLAUDE_MODEL;
          backend = 'claude';
        } else {
          await ensureLmStudioRunning(o.endpoint);
          textModel = o.model ?? (await ensureTextModelLoaded(o.endpoint));
          backend = 'lmstudio';
        }
      } catch (e) {
        console.warn(
          `merge-labels: refinement + dupe-merge skipped — ${(e as Error).message}\n` +
          `  (pass --skip-refine to silence this when no backend is available)`,
        );
      }
    }

    if (hasNoteCandidates && textModel && backend) {
      try {
        console.log(
          `merge-labels: refinement backend=${backend} model=${textModel}` +
          (backend === 'lmstudio' ? ` endpoint=${o.endpoint}` : ''),
        );
        const result = await runRefinement(
          baseMap.entries,
          aiEvents,
          humanEvents,
          refinedEvents,
          { endpoint: o.endpoint, model: textModel, backend, emitProgress: o.emitProgress },
          o.verbose,
          llmScope,
        );
        console.log(
          `merge-labels: refinement ran=${result.ran} reused=${result.reused} ` +
          `failed=${result.failed}`,
        );
        // Reload refined events so the freshly-appended ones flow into
        // the merge below.
        if (result.refinedFile && result.ran > 0) {
          refinedEvents.length = 0;
          refinedEvents.push(...loadEvents('refined', o.strict));
        }
      } catch (e) {
        console.warn(`merge-labels: refinement failed — ${(e as Error).message}`);
      }
    } else if (o.verbose && !hasNoteCandidates) {
      console.log('merge-labels: refinement skipped — no human notes + ai pairs');
    }

    // 3b. Dupe-merge pass. Runs over every cluster of photos linked by
    //     dupeOf and produces a single refined event per canonical
    //     with the merged labels. Re-uses any existing dupe-merge
    //     events whose fingerprint matches the current inputs.
    if (hasDupeCandidates && textModel && backend) try {
      const dupeResult = await runDupeMerge(
        baseMap.entries,
        ingestEvents, aiEvents, refinedEvents, humanEvents,
        { endpoint: o.endpoint, model: textModel, backend },
        o.verbose,
        latestSessionScope,
      );
      if (dupeResult.ran > 0 || dupeResult.reused > 0 || dupeResult.failed > 0) {
        console.log(
          `merge-labels: dupe-merge ran=${dupeResult.ran} reused=${dupeResult.reused} ` +
          `failed=${dupeResult.failed}`,
        );
      }
      if (dupeResult.refinedFile && dupeResult.ran > 0) {
        refinedEvents.length = 0;
        refinedEvents.push(...loadEvents('refined', o.strict));
      }
    } catch (e) {
      console.warn(
        `merge-labels: dupe-merge skipped — ${(e as Error).message}\n` +
        `  (pass --skip-refine to silence this when the model isn't loaded)`,
      );
    }
  }

  // 4. Apply tiers in precedence order (lowest → highest). Higher
  //    tiers overwrite lower ones for the same field. Human is applied
  //    LAST so any human-explicit value wins over the LLM's refined
  //    version of the same field; refinement still wins over raw AI
  //    for fields the human didn't touch.
  const ingestStats = applyTier(baseMap.entries, ingestEvents, 'ingest', LABEL_FIELDS, o.verbose);
  const aiStats     = applyTier(baseMap.entries, aiEvents,     'ai',     LABEL_FIELDS, o.verbose);
  const refinedStats= applyTier(baseMap.entries, refinedEvents,'refined',REFINED_FIELDS, o.verbose);
  const humanStats  = applyTier(baseMap.entries, humanEvents,  'human',  LABEL_FIELDS, o.verbose);
  console.log(
    `merge-labels: applied — ingest=${ingestStats.applied} ai=${aiStats.applied} ` +
    `refined=${refinedStats.applied} human=${humanStats.applied} ` +
    `(${humanStats.cleared} human clears)`,
  );

  // 4b. Curator triage flags.
  //
  //   omit       → drop the entry from BOTH output files (the public
  //                manifest never sees it). The JSONL event is kept so
  //                a future un-omit (human-tier clear) puts the photo
  //                back into the output on the next merge.
  //   needs_edit → keep the entry in output, but list it on stdout so
  //                the curator knows which sources to re-process
  //                externally (e.g. open in Lightroom and re-export).
  //
  // Neither flag is shipped to the public manifest — toPhotographyOutput
  // and toClassificationFields only emit known label fields, so we
  // strip them off the in-memory entries before output for cleanliness.
  const omittedIds = new Set<string>();
  const needsEditEntries: Array<{ id: string; src: string }> = [];
  for (const [id, entry] of baseMap.entries) {
    if (entry.omit === true) omittedIds.add(id);
    if (entry.needs_edit === true) needsEditEntries.push({ id, src: entry.src });
    // Strip the triage fields off so they never reach the output
    // writers (defense in depth — the label-order arrays in
    // toPhotographyOutput / toClassificationFields already exclude them).
    delete entry.omit;
    delete entry.needs_edit;
  }
  if (needsEditEntries.length > 0) {
    console.log(
      `\nmerge-labels: ${needsEditEntries.length} photo(s) marked needs_edit — ` +
      `re-process these externally:`,
    );
    for (const { id, src } of needsEditEntries) {
      console.log(`  ${src}  (${id})`);
    }
    console.log('');
  }
  if (omittedIds.size > 0) {
    console.log(
      `merge-labels: ${omittedIds.size} photo(s) marked omit — dropping from output`,
    );
  }

  // 5. Split outputs.
  //
  // Full-corpus mode: compute every entry from scratch, write the
  // whole file.
  //
  // Per-photo (`--only`) mode: read the existing on-disk file, mutate
  // only the entries in `onlyScope`, write the file back. Every other
  // entry's bytes stay identical so git diffs show only what the
  // curator just refined.

  if (o.dryRun) {
    console.log('merge-labels: --dry-run set, not writing.');
    return;
  }

  if (onlyScope) {
    // ── Per-photo partial write ──
    const photoOnly = new Set<string>();
    const meAtlasOnly = new Set<string>();
    for (const id of onlyScope) {
      if (id.startsWith('photo-')) photoOnly.add(id);
      else if (id.startsWith('me-') || id.startsWith('atlas-')) meAtlasOnly.add(id);
    }

    if (photoOnly.size > 0) {
      const existing = JSON.parse(readFileSync(PHOTOGRAPHY_JSON, 'utf8')) as Array<JsonObject>;
      let touched = 0;
      for (let i = 0; i < existing.length; i++) {
        const bareId = existing[i].id as string;
        if (!bareId) continue;
        const nsId = `photo-${bareId}`;
        if (!photoOnly.has(nsId)) continue;
        if (omittedIds.has(nsId)) {
          // Curator marked omit — drop the entry entirely.
          existing.splice(i, 1); i -= 1; touched += 1; continue;
        }
        const entry = baseMap.entries.get(nsId);
        if (!entry) continue;
        existing[i] = toPhotographyOutput(entry);
        touched += 1;
      }
      const tmp = PHOTOGRAPHY_JSON + '.tmp';
      writeFileSync(tmp, JSON.stringify(existing, null, 2) + '\n');
      renameSync(tmp, PHOTOGRAPHY_JSON);
      console.log(`merge-labels: wrote ${touched} photo-* entries (of ${photoOnly.size} requested) → ${PHOTOGRAPHY_JSON}`);
    }

    if (meAtlasOnly.size > 0) {
      const existing = existsSync(PHOTO_CLASSIFICATIONS_JSON)
        ? JSON.parse(readFileSync(PHOTO_CLASSIFICATIONS_JSON, 'utf8')) as Record<string, JsonObject>
        : {};
      let touched = 0;
      for (const id of meAtlasOnly) {
        const entry = baseMap.entries.get(id);
        if (!entry) continue;
        if (omittedIds.has(id)) {
          if (existing[entry.src]) { delete existing[entry.src]; touched += 1; }
          continue;
        }
        const fields = toClassificationFields(entry);
        if (Object.keys(fields).length === 0) {
          if (existing[entry.src]) { delete existing[entry.src]; touched += 1; }
          continue;
        }
        existing[entry.src] = fields;
        touched += 1;
      }
      // Re-sort alphabetically for stable order after the in-place edit.
      const sorted: Record<string, JsonObject> = {};
      for (const key of Object.keys(existing).sort()) sorted[key] = existing[key];
      const tmp = PHOTO_CLASSIFICATIONS_JSON + '.tmp';
      writeFileSync(tmp, JSON.stringify(sorted, null, 2) + '\n');
      renameSync(tmp, PHOTO_CLASSIFICATIONS_JSON);
      console.log(`merge-labels: wrote ${touched} me-/atlas- entries (of ${meAtlasOnly.size} requested) → ${PHOTO_CLASSIFICATIONS_JSON}`);
    }
    return;
  }

  // ── Full-corpus mode: rewrite both files from scratch. ──
  //    photography.json (preserve original entry order, structural + labels)
  const photographyOut = baseMap.photographyOrder.map((nsId) => {
    if (omittedIds.has(nsId)) return null;
    const entry = baseMap.entries.get(nsId);
    if (!entry) return null;
    return toPhotographyOutput(entry);
  }).filter((x): x is JsonObject => x != null);

  //    photo-classifications.json (src-keyed, sorted alphabetically for
  //    deterministic diffs). Includes me-* and atlas-* entries that
  //    have any classifiable label field.
  const classifications: Record<string, JsonObject> = {};
  const meAndAtlasIds = [...baseMap.entries.keys()].filter(
    (id) => id.startsWith('me-') || id.startsWith('atlas-'),
  );
  for (const id of meAndAtlasIds) {
    if (omittedIds.has(id)) continue;
    const entry = baseMap.entries.get(id);
    if (!entry) continue;
    const fields = toClassificationFields(entry);
    if (Object.keys(fields).length === 0) continue;
    classifications[entry.src] = fields;
  }
  // Sort keys alphabetically for stable on-disk ordering.
  const sortedClassifications: Record<string, JsonObject> = {};
  for (const key of Object.keys(classifications).sort()) {
    sortedClassifications[key] = classifications[key];
  }

  // 6. Atomic writes.
  const photoTmp = PHOTOGRAPHY_JSON + '.tmp';
  writeFileSync(photoTmp, JSON.stringify(photographyOut, null, 2) + '\n');
  renameSync(photoTmp, PHOTOGRAPHY_JSON);
  console.log(`merge-labels: wrote ${photographyOut.length} entries → ${PHOTOGRAPHY_JSON}`);

  const classTmp = PHOTO_CLASSIFICATIONS_JSON + '.tmp';
  writeFileSync(classTmp, JSON.stringify(sortedClassifications, null, 2) + '\n');
  renameSync(classTmp, PHOTO_CLASSIFICATIONS_JSON);
  console.log(
    `merge-labels: wrote ${Object.keys(sortedClassifications).length} entries → ` +
    `${PHOTO_CLASSIFICATIONS_JSON}`,
  );
}

if (import.meta.main) {
  await merge(parseArgs(process.argv.slice(2)));
}
