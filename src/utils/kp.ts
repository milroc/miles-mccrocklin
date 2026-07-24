// Knuth-Plass line breaking for ragged-right English text.
//
// Treats a paragraph as a sequence of items — boxes (glyph runs), glues
// (stretchable inter-word spaces), and penalties (optional break points
// like soft hyphens) — then runs a dynamic-programming search for the
// break sequence that minimizes a cumulative line-cost score.
//
// Tuned for resume bullets: short paragraphs (1-4 lines), occasional
// soft-hyphen breaks. Two cost modes: ragged-right (rag-depth cost) and
// full justification (per-space stretch-ratio cost + widow control; the
// renderer distributes each line's slack as word-spacing). Reference:
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
  // Full justification: line costs switch from rag-depth to per-space
  // stretch ratio (how far each inter-word space must stretch to fill
  // the measure), the classic KP badness. The renderer then distributes
  // each line's slack as word-spacing. Last lines stay ragged, but a
  // small widow penalty discourages a lone short word down there.
  justify?: boolean;
}
interface KPLine {
  text: string;
  width: number;
  // Interior inter-word spaces on the line — what word-spacing
  // distributes slack across when justifying. 0 ⇒ render ragged.
  spaces: number;
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
// Justify mode: a space may comfortably stretch about half its own
// width and SHRINK by about a third (TeX's classic glue proportions);
// the ratio cost is cubed so mildly adjusted lines are cheap and
// extreme ones get expensive fast. Shrink is what separates true KP
// justification from greedy-plus-stretching: the DP can pull a word up
// onto a slightly-tight line to relieve a gappy one below, evening out
// spacing across the paragraph — a trade greedy can't see. WIDOW_COST
// nudges the DP away from leaving a very short last line when a
// rebreak fixes it.
const STRETCH_PER_SPACE = 0.5;
const SHRINK_PER_SPACE = 0.33;
const JUSTIFY_COST_SCALE = 100;
const WIDOW_MIN_FRACTION = 0.15;
// Graded, not flat: a lone word pays nearly the whole cost, a
// half-filled short line pays little — so the DP has a gradient to
// climb by pulling words down even when the result is still shortish.
const WIDOW_COST = 40;
// A single word stranded under a justified block is categorically bad
// (TeX's widowpenalty posture): pay almost any stretch price upstream
// to pull a companion word down. Only bites when an alternative break
// exists — one-line paragraphs have no competing break to lose to.
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
// interior glues (justify distributes slack across them) and remember a
// representative space width for the stretch-ratio cost.
function measureLine(
  items: Item[], a: number, b: number,
): { w: number; spaces: number; spaceW: number } {
  let i = a;
  while (i < b && items[i]!.kind === 'glue') i++;
  let w = 0;
  let spaces = 0;
  let spaceW = 0;
  for (let j = i; j < b; j++) {
    const it = items[j]!;
    if (it.kind === 'box' || it.kind === 'glue') w += it.width;
    if (it.kind === 'glue' && it.width > 0) { spaces++; spaceW = it.width; }
  }
  const term = items[b];
  if (term && term.kind === 'penalty' && term.flag) w += term.width;
  return { w, spaces, spaceW };
}

function lineCost(
  items: Item[], a: number, b: number, maxWidth: number, isLast: boolean,
  justify: boolean,
): number {
  const { w, spaces, spaceW } = measureLine(items, a, b);
  // Justified non-last lines may exceed the natural measure by up to
  // the line's total shrinkability (the renderer compresses the spaces
  // back to the measure). Everything else overflows as before.
  const shrinkable =
    justify && !isLast ? spaces * Math.max(1, spaceW) * SHRINK_PER_SPACE : 0;
  if (w > maxWidth + shrinkable + FIT_EPSILON) {
    return OVERFLOW_BASE + (w - maxWidth) * OVERFLOW_PER_PX;
  }
  const term = items[b];
  const hyphenTax =
    term && term.kind === 'penalty' && term.flag ? HYPHEN_COST : 0;
  if (isLast) {
    // Ragged last line, but in justify mode discourage a widow (a line
    // so short it strands a word or two under a justified block).
    if (justify && w > 0) {
      if (spaces === 0 && w < maxWidth * 0.5) return SINGLE_WORD_WIDOW_COST;
      const minW = maxWidth * WIDOW_MIN_FRACTION;
      if (w < minW) return WIDOW_COST * ((minW - w) / minW);
    }
    return 0;
  }
  const slack = maxWidth - w;
  if (!justify) {
    const norm = slack / SLACK_DIVISOR;
    return norm * norm + hyphenTax;
  }
  // Adjustment ratio: slack distributed across the line's spaces,
  // relative to how far a space adjusts gracefully in that direction
  // (positive slack stretches, negative shrinks). Cubed magnitude,
  // TeX-style.
  const per = Math.max(1, spaces) * Math.max(1, spaceW);
  const r = slack >= 0
    ? slack / (per * STRETCH_PER_SPACE)
    : slack / (per * SHRINK_PER_SPACE);
  return JUSTIFY_COST_SCALE * Math.abs(r * r * r) + hyphenTax;
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

function runDP(items: Item[], maxWidth: number, firstLineWidth: number, justify: boolean): number[] {
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
    const c = lineCost(items, 0, b, firstLineWidth, last, justify);
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
      let c = cost[a] + lineCost(items, a + 1, b, maxWidth, last, justify);
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
  let spaces = 0;
  let trailingGlueW = 0;
  for (let j = i; j < b; j++) {
    const it = items[j]!;
    if (it.kind === 'box' || it.kind === 'glue') { text += it.text; width += it.width; }
    if (it.kind === 'glue' && it.width > 0) { spaces++; trailingGlueW = it.width; }
    else if (it.kind === 'box') trailingGlueW = 0;
    // mid-line penalties (soft hyphens not chosen) contribute nothing
  }
  const term = items[b];
  if (term && term.kind === 'penalty' && term.flag) {
    text += HYPHEN;
    width += term.width;
  }
  // Trim any trailing whitespace baked into the last glue/box; a
  // trailing glue also isn't an interior space, so drop its count/width.
  const trimmed = text.replace(/[ \t]+$/, '');
  if (trimmed !== text && trailingGlueW > 0) {
    spaces--;
    width -= trailingGlueW;
  }
  return { text: trimmed, width, spaces };
}

// --- Public API ---------------------------------------------------------

const cache = new Map<string, KPResult>();
const CACHE_LIMIT = 256;

function cacheKey(text: string, font: string, maxWidth: number, firstLineMaxWidth: number, justify: boolean): string {
  return `${justify ? 'J' : 'R'}|${maxWidth}|${firstLineMaxWidth}|${font}|${text}`;
}

export function layoutParagraph(text: string, opts: KPLayoutOpts): KPResult {
  const font = opts.font;
  const maxWidth = opts.maxWidth;
  const firstLineMaxWidth = opts.firstLineMaxWidth ?? maxWidth;
  const justify = opts.justify ?? false;
  if (!text || !font || !maxWidth) return { lines: [{ text: text || '', width: 0, spaces: 0 }] };

  const key = cacheKey(text, font, maxWidth, firstLineMaxWidth, justify);
  const cached = cache.get(key);
  if (cached) return cached;

  const items = buildItems(text, font);
  const breaks = runDP(items, maxWidth, firstLineMaxWidth, justify);
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
