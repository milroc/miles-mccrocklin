// Classify and theme photos using a local LM Studio vision model.
//
// Writes one JSONL event per classified photo to
// data/photography-labels/ai/{sessionStamp}.jsonl. Doesn't touch
// photography.json or photo-classifications.json directly — run
// `bun run scripts/merge-labels.ts` manually when you're ready to
// flush events into the output files (that step also runs the LLM
// refinement prompt over any photos with curator notes). See
// scripts/merge-labels.ts for the pipeline architecture
// (tiers, precedence, refinement).
//
// Supports three sources (all flow through the same JSONL output):
//   1. photo-*  from data/photography.json
//   2. me-*     from data/me.json sabbatical-travel
//   3. atlas-*  from data/photo-atlas.json
//
// Why local: ~250+ photos × seconds-per-inference is a one-shot batch
// best kept on-machine. Local vision models (Qwen2.5-VL, MiniCPM-V) via
// LM Studio's OpenAI-compatible server avoid API costs and keep raw
// photos off third-party servers. Idempotent skip: only classifies
// photos whose CURRENT MERGED STATE has no theme; pass --force to
// re-classify everything (the new event overrides previous ones).
//
// Prereqs:
//   1. Install LM Studio (https://lmstudio.ai), download a vision
//      model (qwen2.5-vl-7b-instruct recommended).
//   2. Start LM Studio's local server (Developer tab → Start Server).
//   3. Load the vision model.
//
// Run:
//   bun scripts/classify-photography.ts                       # all sources, missing-only
//   bun scripts/classify-photography.ts --source photography  # one source
//   bun scripts/classify-photography.ts --force               # re-classify everything
//   bun scripts/classify-photography.ts --only photo-some-id  # match a namespaced id
//   bun scripts/classify-photography.ts --limit 10            # first 10 only
//   bun scripts/classify-photography.ts --dry-run             # print, no writes

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import type { JsonObject, JsonValue } from '../src/utils/json';
import { join, resolve } from 'node:path';
import {
  chatVision, DEFAULT_ENDPOINT, ensureLmStudioRunning, ensureVisionModelLoaded,
  extractJsonObject, imageToDataUrl,
} from './lm-client';
import { ensureLabelsDir, sessionStamp } from './merge-labels';

const ROOT = resolve(import.meta.dir, '..');
const PHOTOGRAPHY_JSON = join(ROOT, 'data', 'photography.json');
const PHOTO_CLASSIFICATIONS_JSON = join(ROOT, 'data', 'photo-classifications.json');
const ME_JSON = join(ROOT, 'data', 'me.json');
const ATLAS_JSON = join(ROOT, 'data', 'photo-atlas.json');

// Category hierarchy — single source of truth shared with the React UI
// (src/photography/categories.ts) and stamped into the prompt below so
// the model emits the SAME canonical leaf tags the filter recognizes.
import {
  CATEGORY_TREE,
  TREATMENT_TAGS,
  type CategoryNode,
} from '../src/photography/categories';

const { leafLabels, ancestorsOf } = (() => {
  const labels: { id: string; label: string }[] = [];
  const ancestors = new Map<string, string[]>();
  const walk = (nodes: CategoryNode[], chain: string[]): void => {
    for (const n of nodes) {
      labels.push({ id: n.id, label: n.label });
      ancestors.set(n.id, chain);
      if (n.children) walk(n.children, [...chain, n.id]);
    }
  };
  walk(CATEGORY_TREE, []);
  return { leafLabels: labels, ancestorsOf: ancestors };
})();

const ALL_CATEGORY_IDS = new Set(leafLabels.map((l) => l.id));
const ALL_TREATMENT_TAGS = new Set<string>(TREATMENT_TAGS);

// Country codes the photography page recognizes. Storage format is
// ISO-3166-1 alpha-3 (lowercase: usa, deu, gbr, ata, ...). The merger
// uses the same allowlist via scripts/locations.ts so we never drift.
import { ALL_COUNTRY_CODES, LOCATIONS, normalizeCountryCode } from '../src/utils/locations';
const COUNTRY_SLUGS = ALL_COUNTRY_CODES;

interface PhotographyEntry {
  id: string;
  src: string;
  caption?: string;
  alt?: string;
  theme?: string[];
  country?: string;
  species?: string;
  entities?: string[];
  story?: string;
  aspect?: number;
}

interface ClassifyResult {
  themes: string[];
  caption?: string;
  alt?: string;
  country?: string;
  species?: string;
  entities?: string[];
  story?: string;
}

type SourceFilter = 'all' | 'photography' | 'me' | 'atlas';

interface CliOptions {
  endpoint: string;
  model: string | null;
  source: SourceFilter;
  force: boolean;
  dryRun: boolean;
  limit: number | null;
  only: string | null;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    endpoint: DEFAULT_ENDPOINT,
    model: null,
    source: 'all',
    force: false,
    dryRun: false,
    limit: null,
    only: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--endpoint': opts.endpoint = argv[++i]; break;
      case '--model':    opts.model    = argv[++i]; break;
      case '--source':   opts.source   = argv[++i] as SourceFilter; break;
      case '--force':    opts.force    = true; break;
      case '--dry-run':  opts.dryRun   = true; break;
      case '--limit':    opts.limit    = Number(argv[++i]); break;
      case '--only':     opts.only     = argv[++i]; break;
      case '--help':
      case '-h':
        console.log(
          'Usage: bun scripts/classify-photography.ts [options]\n' +
          '  --endpoint <url>     LM Studio base URL (default http://localhost:1234/v1)\n' +
          '  --model <name>       Model id (auto-detected if omitted)\n' +
          '  --source <name>      Restrict to one source: photography | me | atlas | all (default all)\n' +
          '  --force              Re-classify even photos whose merged state already has theme\n' +
          '  --dry-run            Print results without writing\n' +
          '  --limit <n>          Stop after n photos\n' +
          '  --only <id>          Classify only this namespaced id (photo-* / me-* / atlas-*)',
        );
        process.exit(0);
      default:
        console.error(`Unknown option: ${a}`);
        process.exit(1);
    }
  }
  if (!['all', 'photography', 'me', 'atlas'].includes(opts.source)) {
    console.error(`Invalid --source: ${opts.source}. Use one of: all, photography, me, atlas.`);
    process.exit(1);
  }
  return opts;
}

function renderCategoryTreeForPrompt(): string {
  const lines: string[] = [];
  const walk = (nodes: CategoryNode[], depth: number): void => {
    for (const n of nodes) {
      lines.push(`${'  '.repeat(depth)}- ${n.id}    (${n.label})`);
      if (n.children) walk(n.children, depth + 1);
    }
  };
  walk(CATEGORY_TREE, 0);
  return lines.join('\n');
}

function buildPrompt(): string {
  return [
    'You are tagging photographs for a personal photography portfolio.',
    'Look at the image and respond with a SINGLE JSON object — no prose, no markdown fences — matching this exact shape:',
    '',
    '{',
    '  "themes": string[],     // category tags from the hierarchy below (the deepest matching leaf plus any ancestors are fine — see Theme rules)',
    '  "treatments": string[], // 0 to 3 style/treatment tags, each EXACTLY one of the allowed values below, or empty array',
    '  "entities": string[],   // 3 to 12 specific subjects/objects/landmarks visible in the photo',
    '  "story": string,        // 1-3 sentence narrative interpretation of what is happening',
    '  "caption": string,      // 1 short editorial title, max ~12 words, no trailing period',
    '  "alt": string,          // descriptive alt text for screen readers, 1-2 sentences, ends with period',
    '  "country": string,      // EXACTLY one slug from the allowed countries list, or "" if unsure',
    '  "species": string       // common English species name when "wildlife" is a theme, else ""',
    '}',
    '',
    'Category hierarchy. Pick the MOST SPECIFIC leaf that fits, then ALSO include every ancestor up to its top-level. So a photo of a primate would have themes: ["wildlife","mammals","primates"]. A skyline shot would have themes: ["landscape","cityscape"]. A festival shot would have themes: ["culture","festival"]. Use the EXACT id (left of the parens):',
    renderCategoryTreeForPrompt(),
    '',
    'Allowed treatment tags (optional — use only when the style is obvious; do not invent new ones):',
    TREATMENT_TAGS.join(', '),
    '',
    'Allowed country codes (ISO-3166-1 alpha-3, lowercase; if you cannot tell, return ""). Use the code, not the country name:',
    LOCATIONS.map((r) => r.code + '=' + r.name).join(', '),
    '',
    'Theme rules:',
    '- Pick the deepest leaf that genuinely fits. If you can\'t identify a sub-leaf with confidence, stop at the parent (e.g. ["wildlife","birds"] is fine when you can\'t tell which kind of bird).',
    '- ALWAYS include the ancestor chain for every leaf you pick. ["primates"] alone is wrong — output ["wildlife","mammals","primates"].',
    '- A photo can span multiple top-level categories. A person under mountains can be ["landscape","mountains","culture","people"] — include all relevant chains.',
    '- "wildlife" only when animals are the primary subject. A pigeon in a street scene does not get "wildlife".',
    '- "street" only for candid urban scenes with people or human activity.',
    '- "people" only when human beings are the primary subject (portraits, candid life, ceremonies, lifestyle).',
    '- "cityscape" for the city as landscape (skylines, panoramas, urban density). For a single building or interior, use "architecture" under culture instead.',
    '- "sky" for atmospheric photos (clouds, storms, fog, night sky, Milky Way, auroras).',
    '- "water" includes seascapes, lakes, rivers, waterfalls, glaciers, snowfields, and icebergs.',
    '- Do NOT invent new theme ids. Only the ids in the hierarchy are allowed in "themes".',
    '',
    'Treatment rules:',
    '- Use only when the style is clearly present. Most photos have an empty treatments array.',
    '- "monochrome" only for genuinely B&W or single-hue photos.',
    '- "sunrise" / "sunset" only when the warm light is the primary feature.',
    '- "silhouette" when subject is shape-only against a brighter background.',
    '- "macro" only for true close-ups (insects, textures, small details).',
    '',
    'Entities rules:',
    '- 3 to 12 concrete nouns naming what is visibly in the photo: animals, plants, vehicles, buildings, named landmarks, weather features, people-as-roles ("monk", "fisherman", "child").',
    '- Use common English. Be specific when possible ("acacia tree" over "tree", "fishing boat" over "boat"). Lowercase.',
    '- Skip generic background fillers like "sky" or "ground" unless they are the subject.',
    '- Named landmarks are fine and encouraged when identifiable ("Iguazú Falls", "Hagia Sophia", "Mount Fuji").',
    '',
    'Story rules:',
    '- 1 to 3 sentences describing what is happening and the mood. This is the LLM\'s interpretation, not a literal description — say what the photo is about.',
    '- Avoid hedging language ("appears to be", "seems"). State what you see.',
    '- Do not start with "This image" or "A photo of". Start with the subject or action.',
    '',
    'Caption / alt / country / species rules:',
    '- Caption is an editorial title (e.g. "Iguazú at dawn"), not a description. Description goes in alt.',
    '- Alt is plain descriptive text for screen readers.',
    '- "species": when "wildlife" is in themes, identify the animal to species level using its common English name (e.g. "African bush elephant", "Galápagos marine iguana", "king penguin"). If you can only get to genus or family, return that (e.g. "macaque", "heron"). If there is no animal or it is not the primary subject, return "".',
    '- Do NOT put species names in themes or entities — species belongs in the "species" field only (entities can still say "elephant" generically).',
    '- Respond with the JSON object only.',
  ].join('\n');
}

async function classifyOne(
  endpoint: string,
  model: string,
  imageUrl: string,
): Promise<ClassifyResult> {
  const raw = await chatVision({
    endpoint, model,
    prompt: buildPrompt(),
    imageUrl,
  });
  return normalizeResult(extractJsonObject(raw), raw);
}

function normalizeResult(o: JsonObject, raw: string): ClassifyResult {
  const rawThemes = Array.isArray(o.themes) ? o.themes : [];
  const themes = normalizeCategoryThemes(rawThemes);
  if (themes.length === 0) {
    throw new Error(`Model returned no recognized themes. Raw: ${raw.slice(0, 200)}`);
  }
  const rawTreatments = Array.isArray(o.treatments) ? o.treatments : [];
  const treatments = normalizeTreatments(rawTreatments);
  const rawEntities = Array.isArray(o.entities) ? o.entities : [];
  const entities = normalizeEntityList(rawEntities, 12);

  // Run anything the model emits through the shared locations
  // normalizer so we accept the canonical code OR the legacy slug OR
  // a display name and end up with a canonical ISO-3 code regardless.
  const country = normalizeCountryCode(o.country);
  const caption = typeof o.caption === 'string' ? o.caption.trim() : undefined;
  const alt = typeof o.alt === 'string' ? o.alt.trim() : undefined;
  const story = typeof o.story === 'string' ? o.story.trim() : undefined;

  let species: string | undefined;
  if (typeof o.species === 'string' && themes.includes('wildlife')) {
    const s = o.species.trim();
    if (s) species = s;
  }

  const combinedThemes = [...themes];
  for (const t of treatments) {
    if (!combinedThemes.includes(t)) combinedThemes.push(t);
  }

  return {
    themes: combinedThemes,
    ...(entities.length > 0 && { entities }),
    ...(story && { story }),
    ...(caption && { caption }),
    ...(alt && { alt }),
    ...(country && { country }),
    ...(species && { species }),
  };
}

function normalizeCategoryThemes(raw: unknown[]): string[] {
  const direct = new Set<string>();
  for (const t of raw) {
    if (typeof t !== 'string') continue;
    const norm = t.toLowerCase().trim().replace(/[\s_]+/g, '-');
    if (ALL_CATEGORY_IDS.has(norm)) direct.add(norm);
  }
  const out = new Set<string>();
  for (const id of direct) {
    out.add(id);
    for (const anc of ancestorsOf.get(id) ?? []) out.add(anc);
  }
  return [...out];
}

function normalizeTreatments(raw: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    if (typeof t !== 'string') continue;
    const norm = t.toLowerCase().trim().replace(/[\s_]+/g, '-');
    if (!ALL_TREATMENT_TAGS.has(norm)) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
    if (out.length >= 3) break;
  }
  return out;
}

function normalizeEntityList(raw: unknown[], max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    if (typeof t !== 'string') continue;
    const norm = t.trim().toLowerCase();
    if (!norm || norm.length > 60) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
    if (out.length >= max) break;
  }
  return out;
}

// ─── Job loading ──────────────────────────────────────────────────────

interface PhotoJob {
  source: 'photography' | 'me' | 'atlas';
  id: string;                          // namespaced
  src: string;                         // path relative to repo root
  hasExistingTheme: boolean;           // used by --skip-existing logic
}

type MeItem = {
  id: string;
  type: string;
  src: string;
};

// Parse rather than assume: an item missing one of the three required
// fields is reported and skipped instead of reaching the classifier
// with an undefined id.
function isMeItem(it: JsonValue): it is MeItem {
  return (
    typeof it === 'object' &&
    it !== null &&
    !Array.isArray(it) &&
    typeof it.id === 'string' &&
    typeof it.type === 'string' &&
    typeof it.src === 'string'
  );
}

function loadSabbaticalTravel(me: JsonObject): MeItem[] {
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
            `classify-photography: skipped ${items.length - parsed.length} sabbatical-travel item(s) missing id/type/src`,
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

interface AtlasEntry {
  country: string;
  country_slug: string;
  image?: string;
}

function loadAllJobs(source: SourceFilter): PhotoJob[] {
  const jobs: PhotoJob[] = [];

  // photo-*  (current merged state lives in photography.json)
  if (source === 'all' || source === 'photography') {
    const entries = JSON.parse(readFileSync(PHOTOGRAPHY_JSON, 'utf8')) as PhotographyEntry[];
    for (const e of entries) {
      jobs.push({
        source: 'photography',
        id: `photo-${e.id}`,
        src: e.src,
        hasExistingTheme: Array.isArray(e.theme) && e.theme.length > 0,
      });
    }
  }

  // me-*  (current merged state lives in photo-classifications.json keyed by src)
  if (source === 'all' || source === 'me') {
    const me = JSON.parse(readFileSync(ME_JSON, 'utf8')) as JsonObject;
    const sideTable = existsSync(PHOTO_CLASSIFICATIONS_JSON)
      ? JSON.parse(readFileSync(PHOTO_CLASSIFICATIONS_JSON, 'utf8')) as Record<string, { theme?: string[] }>
      : {};
    for (const item of loadSabbaticalTravel(me)) {
      if (item.type !== 'image') continue;
      const existing = sideTable[item.src];
      jobs.push({
        source: 'me',
        id: `me-${item.id}`,
        src: item.src,
        hasExistingTheme: !!(existing?.theme && existing.theme.length > 0),
      });
    }
  }

  // atlas-*  (current merged state lives in photo-classifications.json keyed by src)
  if (source === 'all' || source === 'atlas') {
    const atlas = JSON.parse(readFileSync(ATLAS_JSON, 'utf8')) as AtlasEntry[];
    const sideTable = existsSync(PHOTO_CLASSIFICATIONS_JSON)
      ? JSON.parse(readFileSync(PHOTO_CLASSIFICATIONS_JSON, 'utf8')) as Record<string, { theme?: string[] }>
      : {};
    for (const a of atlas) {
      if (!a.image) continue;
      const existing = sideTable[a.image];
      jobs.push({
        source: 'atlas',
        id: `atlas-${a.country_slug}`,
        src: a.image,
        hasExistingTheme: !!(existing?.theme && existing.theme.length > 0),
      });
    }
  }

  return jobs;
}

function shouldProcess(job: PhotoJob, opts: CliOptions): boolean {
  if (opts.only) return job.id === opts.only;
  if (opts.force) return true;
  return !job.hasExistingTheme;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  // Bring LM Studio up if it isn't already, then make sure a vision
  // model is loaded. The classifier is image-in/labels-out so we
  // specifically need a vision model (qwen2.5-vl-*, llava, etc.).
  await ensureLmStudioRunning(opts.endpoint);
  const model = opts.model ?? (await ensureVisionModelLoaded(opts.endpoint));
  if (!model) {
    console.error(
      'classify-photography: could not load a vision model. ' +
      'Pass --model <id> or run `lms load <model>` first.',
    );
    process.exit(1);
  }
  console.log(`classify-photography: endpoint=${opts.endpoint} model=${model}`);
  if (opts.dryRun) console.log('  (dry-run: no events written)');

  const allJobs = loadAllJobs(opts.source);
  const queue = allJobs.filter((j) => shouldProcess(j, opts));
  const total = opts.limit != null ? Math.min(opts.limit, queue.length) : queue.length;
  const bySource = { photography: 0, me: 0, atlas: 0 } satisfies Record<PhotoJob['source'], number>;
  for (const j of queue) bySource[j.source] += 1;
  console.log(
    `  ${total} to classify (queue ${queue.length} of ${allJobs.length} total) ` +
      `— photography=${bySource.photography} me=${bySource.me} atlas=${bySource.atlas}`,
  );

  // Open one session file for the whole run. Each classified photo
  // appends a single line. If the script crashes, partial progress is
  // preserved (the next merge picks up whatever was already written).
  const stamp = sessionStamp();
  const sessionFile = join(ensureLabelsDir('ai'), `${stamp}.jsonl`);

  let done = 0;
  let failed = 0;
  for (const job of queue) {
    if (done >= total) break;
    const absSrc = join(ROOT, job.src);
    if (!existsSync(absSrc)) {
      console.warn(`  [${job.id}] skip — source missing at ${job.src}`);
      failed += 1;
      continue;
    }
    const startedAt = Date.now();
    try {
      const { dataUrl } = await imageToDataUrl(absSrc);
      const result = await classifyOne(opts.endpoint, model, dataUrl);

      if (!opts.dryRun) {
        const fields: JsonObject = { theme: result.themes };
        if (result.caption) fields.caption = result.caption;
        if (result.alt) fields.alt = result.alt;
        if (result.country) fields.country = result.country;
        if (result.species) fields.species = result.species;
        if (result.story) fields.story = result.story;
        if (result.entities && result.entities.length > 0) fields.entities = result.entities;
        const event = {
          v: 1,
          id: job.id,
          timestamp: new Date().toISOString(),
          fields,
        };
        appendFileSync(sessionFile, JSON.stringify(event) + '\n');
      }

      done += 1;
      const ms = Date.now() - startedAt;
      const summary = [
        job.source,
        result.themes.join('+'),
        result.species ? `sp:${result.species}` : '',
        result.entities && result.entities.length > 0
          ? `ent:${result.entities.slice(0, 4).join(',')}${result.entities.length > 4 ? '+' : ''}`
          : '',
        result.country ?? '-',
        result.caption ? `"${result.caption}"` : '',
      ].filter(Boolean).join(' | ');
      console.log(`  [${done}/${total}] ${job.id} (${ms} ms) → ${summary}`);
    } catch (e) {
      failed += 1;
      console.warn(`  [${job.id}] FAILED: ${(e as Error).message}`);
    }
  }

  console.log(`classify-photography: ${done} classified, ${failed} failed`);
  if (done > 0) {
    console.log(`classify-photography: wrote events → ${sessionFile}`);
    console.log(
      `classify-photography: run \`bun run scripts/merge-labels.ts\` to ` +
      `flush these into photography.json + photo-classifications.json ` +
      `(also runs LLM refinement on photos with curator notes).`,
    );
  }
}

if (import.meta.main) {
  await main();
}
