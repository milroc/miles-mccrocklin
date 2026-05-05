// Knuth-Plass line breaking for ragged-right English text.
//
// Treats a paragraph as a sequence of items — boxes (glyph runs), glues
// (stretchable inter-word spaces), and penalties (optional break points
// like soft hyphens) — then runs a dynamic-programming search for the
// break sequence that minimizes a cumulative line-cost score.
//
// Tuned for resume bullets: short paragraphs (1-4 lines), ragged-right
// (no justification math), occasional soft-hyphen breaks. Reference:
// Knuth & Plass, "Breaking Paragraphs into Lines" (Software—Practice
// and Experience, 1981).

import { prepareWithSegments } from '@chenglou/pretext';

const HYPHEN = '-';
const INF = Infinity;
const PARA_END = -1e10;

// ----- Item types ------------------------------------------------------

interface BoxItem {
  kind: 'box';
  text: string;
  width: number;
}
interface GlueItem {
  kind: 'glue';
  text: string;
  width: number;
}
interface PenaltyItem {
  kind: 'penalty';
  text: string;
  width: number;
  penalty: number;
  flag: boolean;
}
type Item = BoxItem | GlueItem | PenaltyItem;

// ----- Public API types ------------------------------------------------

interface KPLayoutOpts {
  font: string;
  maxWidth: number;
  firstLineMaxWidth?: number;
}
interface KPLine {
  text: string;
  width: number;
}
interface KPResult {
  lines: KPLine[];
}

// Cost weights. The three knobs that matter:
//   SLACK_DIVISOR    — bigger ⇒ less penalty for ragged right edges.
//   HYPHEN_COST      — pay this much to break a word at a soft hyphen.
//   ADJ_HYPHEN_COST  — extra charge if the previous line also ended on a
//                      hyphen (KP's classic "no two hyphens in a row" guard).
// OVERFLOW_BASE makes any line that doesn't fit categorically worse than
// any feasible alternative — but still finite so the DP can pick the
// least-bad overflow when no soft hyphen rescues a giant word.
const SLACK_DIVISOR = 100;
const HYPHEN_COST = 50;
const ADJ_HYPHEN_COST = 200;
const OVERFLOW_BASE = 1e6;
const OVERFLOW_PER_PX = 1e3;
const FIT_EPSILON = 0.5;

// --- Item construction --------------------------------------------------

function buildItems(text: string, font: string): Item[] {
  const prep = prepareWithSegments(text, font);
  const { widths, kinds, segments, discretionaryHyphenWidth } = prep;
  const items: Item[] = [];
  const n = segments ? segments.length : 0;
  for (let i = 0; i < n; i++) {
    const k = kinds[i] as string;
    const seg = (segments?.[i] ?? '') as string;
    const w = widths[i] ?? 0;
    if (k === 'space' || k === 'preserved-space') {
      items.push({ kind: 'glue', text: seg || ' ', width: w });
    } else if (k === 'soft-hyphen') {
      items.push({
        kind: 'penalty',
        text: '',
        width: discretionaryHyphenWidth,
        penalty: HYPHEN_COST,
        flag: true,
      });
    } else if (k === 'zero-width-break') {
      items.push({ kind: 'penalty', text: '', width: 0, penalty: 0, flag: false });
    } else if (k === 'hard-break') {
      // Force a paragraph break: an immediate negative-infinity penalty.
      items.push({ kind: 'glue', text: ' ', width: 0 });
      items.push({ kind: 'penalty', text: '', width: 0, penalty: PARA_END, flag: false });
    } else {
      items.push({ kind: 'box', text: seg, width: w });
    }
  }
  // Forced end-of-paragraph: a glue that absorbs any trailing space, then a
  // -infinity penalty that the backtrack uses as the terminal break.
  items.push({ kind: 'glue', text: '', width: 0 });
  items.push({ kind: 'penalty', text: '', width: 0, penalty: PARA_END, flag: false });
  return items;
}

// --- Line cost ----------------------------------------------------------

// Sum the box+glue widths from items[a..b-1], dropping leading glue (it
// collapses at the start of a new line). If the line ends at a flagged
// penalty (soft hyphen), include the hyphen-glyph width.
function measureLine(items: Item[], a: number, b: number): number {
  let i = a;
  while (i < b && items[i]!.kind === 'glue') i++;
  let w = 0;
  for (let j = i; j < b; j++) {
    const it = items[j]!;
    if (it.kind === 'box' || it.kind === 'glue') w += it.width;
  }
  const term = items[b];
  if (term && term.kind === 'penalty' && term.flag) w += term.width;
  return w;
}

function lineCost(items: Item[], a: number, b: number, maxWidth: number, isLast: boolean): number {
  const w = measureLine(items, a, b);
  if (w > maxWidth + FIT_EPSILON) {
    return OVERFLOW_BASE + (w - maxWidth) * OVERFLOW_PER_PX;
  }
  if (isLast) return 0;
  const slack = maxWidth - w;
  const norm = slack / SLACK_DIVISOR;
  let cost = norm * norm;
  const term = items[b];
  if (term && term.kind === 'penalty' && term.flag) cost += HYPHEN_COST;
  return cost;
}

// --- DP -----------------------------------------------------------------

function endsWithHyphen(items: Item[], b: number): boolean {
  const t = items[b];
  return !!(t && t.kind === 'penalty' && t.flag);
}

function isParaEnd(items: Item[], b: number): boolean {
  const t = items[b];
  return !!(t && t.kind === 'penalty' && t.penalty <= PARA_END);
}

function runDP(items: Item[], maxWidth: number, firstLineWidth: number): number[] {
  const N = items.length;
  if (N === 0) return [];

  const isBP = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const it = items[i]!;
    if (it.kind === 'glue') isBP[i] = 1;
    else if (it.kind === 'penalty' && it.penalty < INF) isBP[i] = 1;
  }

  const cost = new Float64Array(N);
  cost.fill(INF);
  const prev = new Int32Array(N).fill(-2);
  const hyph = new Uint8Array(N);

  // Lines starting from the paragraph head (prev = -1).
  for (let b = 0; b < N; b++) {
    if (!isBP[b]) continue;
    const last = isParaEnd(items, b);
    const c = lineCost(items, 0, b, firstLineWidth, last);
    if (c < cost[b]) {
      cost[b] = c;
      prev[b] = -1;
      hyph[b] = endsWithHyphen(items, b) ? 1 : 0;
    }
    if (last) break;
  }

  // Subsequent lines.
  for (let a = 0; a < N; a++) {
    if (!isBP[a] || cost[a] === INF || isParaEnd(items, a)) continue;
    const prevHyph = hyph[a];
    for (let b = a + 1; b < N; b++) {
      if (!isBP[b]) continue;
      const last = isParaEnd(items, b);
      let c = cost[a] + lineCost(items, a + 1, b, maxWidth, last);
      if (prevHyph && endsWithHyphen(items, b)) c += ADJ_HYPHEN_COST;
      if (c < cost[b]) {
        cost[b] = c;
        prev[b] = a;
        hyph[b] = endsWithHyphen(items, b) ? 1 : 0;
      }
      if (last) break;
    }
  }

  // Find the terminal breakpoint (the forced paragraph-end penalty).
  let term = -1;
  for (let i = N - 1; i >= 0; i--) {
    if (isParaEnd(items, i) && cost[i] < INF) { term = i; break; }
  }
  if (term < 0) return [];

  // Backtrack.
  const breaks: number[] = [];
  let cur: number = term;
  while (cur >= 0) {
    breaks.unshift(cur);
    cur = prev[cur]!;
  }
  return breaks;
}

// --- Materialization ----------------------------------------------------

function materializeLine(items: Item[], a: number, b: number): KPLine {
  let i = a;
  while (i < b && items[i]!.kind === 'glue') i++;
  let text = '';
  let width = 0;
  for (let j = i; j < b; j++) {
    const it = items[j]!;
    if (it.kind === 'box' || it.kind === 'glue') { text += it.text; width += it.width; }
    // mid-line penalties (soft hyphens not chosen) contribute nothing
  }
  const term = items[b];
  if (term && term.kind === 'penalty' && term.flag) {
    text += HYPHEN;
    width += term.width;
  }
  // Trim any trailing whitespace baked into the last glue/box.
  text = text.replace(/[ \t]+$/, '');
  return { text, width };
}

// --- Public API ---------------------------------------------------------

const cache = new Map<string, KPResult>();
const CACHE_LIMIT = 256;

function cacheKey(text: string, font: string, maxWidth: number, firstLineMaxWidth: number): string {
  return `${maxWidth}|${firstLineMaxWidth}|${font}|${text}`;
}

export function layoutParagraph(text: string, opts: KPLayoutOpts): KPResult {
  const font = opts.font;
  const maxWidth = opts.maxWidth;
  const firstLineMaxWidth = opts.firstLineMaxWidth ?? maxWidth;
  if (!text || !font || !maxWidth) return { lines: [{ text: text || '', width: 0 }] };

  const key = cacheKey(text, font, maxWidth, firstLineMaxWidth);
  const cached = cache.get(key);
  if (cached) return cached;

  const items = buildItems(text, font);
  const breaks = runDP(items, maxWidth, firstLineMaxWidth);
  const lines: KPLine[] = [];
  let start = 0;
  for (const b of breaks) {
    lines.push(materializeLine(items, start, b));
    start = b + 1;
  }
  // Drop trailing empty lines (from the para-end sentinel pair).
  while (lines.length > 1 && lines[lines.length - 1]!.text === '') lines.pop();

  const result: KPResult = { lines };
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, result);
  return result;
}

// Expose a tiny measurement helper so the renderer can size a bold prefix
// or any other inline non-KP run without reaching for canvas itself.
export function measureText(text: string, font: string): number {
  if (!text) return 0;
  const prep = prepareWithSegments(text, font);
  let w = 0;
  for (const x of prep.widths) w += x;
  return w;
}
