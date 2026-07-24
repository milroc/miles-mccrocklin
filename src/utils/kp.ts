// Knuth-Plass line breaking for ragged-right English text.
//
// Treats a paragraph as a sequence of items — boxes (glyph runs), glues
// (stretchable inter-word spaces), and penalties (optional break points
// like soft hyphens) — then runs a dynamic-programming search for the
// break sequence that minimizes a cumulative line-cost score.
//
// Tuned for resume bullets: short paragraphs (1-4 lines), ragged-right
// with natural spacing (never adjusted), occasional soft-hyphen breaks,
// widow control. Reference: Knuth & Plass, "Breaking Paragraphs into
// Lines" (Software—Practice and Experience, 1981).

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
//
// Spacing is NEVER adjusted — ragged-right with natural spaces is the
// point (a justification experiment was tried and rejected: stretching
// spaces to a flush edge reads as gaps and rivers; see PR #49). KP's
// job here is purely better BREAKS than greedy: even rag depth, no
// stranded single-word last lines, compounds kept together.
const SLACK_DIVISOR = 40;
const HYPHEN_COST = 50;
const ADJ_HYPHEN_COST = 200;
const OVERFLOW_BASE = 1e6;
const OVERFLOW_PER_PX = 1e3;
const FIT_EPSILON = 0.5;
// Widow control. Graded cost on a short last line — a lone word pays
// nearly the whole cost, a half-filled short line pays little — so the
// DP has a gradient to climb by pulling words down. A single-word last
// line under a multi-line paragraph is categorically bad (TeX's
// widowpenalty posture) and pays a flat high cost on top; one-line
// paragraphs have no competing break, so the constant cannot change
// their layout.
const WIDOW_MIN_FRACTION = 0.15;
const WIDOW_COST = 40;
const SINGLE_WORD_WIDOW_COST = 200;

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
// penalty (soft hyphen), include the hyphen-glyph width. Also count the
// interior glues so the widow rule can tell a lone word from a phrase.
function measureLine(
  items: Item[], a: number, b: number,
): { w: number; spaces: number } {
  let i = a;
  while (i < b && items[i]!.kind === 'glue') i++;
  let w = 0;
  let spaces = 0;
  for (let j = i; j < b; j++) {
    const it = items[j]!;
    if (it.kind === 'box' || it.kind === 'glue') w += it.width;
    if (it.kind === 'glue' && it.width > 0) spaces++;
  }
  const term = items[b];
  if (term && term.kind === 'penalty' && term.flag) w += term.width;
  return { w, spaces };
}

function lineCost(
  items: Item[], a: number, b: number, maxWidth: number, isLast: boolean,
): number {
  const { w, spaces } = measureLine(items, a, b);
  if (w > maxWidth + FIT_EPSILON) {
    return OVERFLOW_BASE + (w - maxWidth) * OVERFLOW_PER_PX;
  }
  const term = items[b];
  const hyphenTax =
    term && term.kind === 'penalty' && term.flag ? HYPHEN_COST : 0;
  if (isLast) {
    // Last lines are free-form, except widow control: don't strand a
    // lone word (or a very short phrase) under a multi-line paragraph
    // when an earlier break can pull a companion down.
    if (w > 0) {
      if (spaces === 0 && w < maxWidth * 0.5) return SINGLE_WORD_WIDOW_COST;
      const minW = maxWidth * WIDOW_MIN_FRACTION;
      if (w < minW) return WIDOW_COST * ((minW - w) / minW);
    }
    return 0;
  }
  const slack = maxWidth - w;
  const norm = slack / SLACK_DIVISOR;
  return norm * norm + hyphenTax;
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
