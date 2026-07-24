// Floating typesetting evaluation panel — prototype chrome for the KP
// line-breaking PR. Hosts the KP / Browser switch, a rag visualization
// overlay (each line's unused right-edge slack tinted, deep rag hotter)
// and live micro-typography stats measured from the rendered DOM: line
// count, rag depth mean/max/deviation, single-word widows, and river
// joins (inter-word gaps on adjacent lines whose horizontal spans
// overlap — the raw material of "rivers" of white). Spacing itself is
// never adjusted in either mode, so gap width stats would be constant;
// the rag is where the two engines differ.
import { useCallback, useEffect, useState } from 'react';
import type { Typeset } from '../utils/mode';
import s from './TypesetPanel.module.css';

interface GapRect {
  x: number;
  y: number;
  w: number;
  h: number;
  para: number;
  line: number;
}

interface RagRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface GapStats {
  paragraphs: number;
  lines: number;
  ragMean: number;
  ragSigma: number;
  ragMax: number;
  widows: number;
  rivers: number;
}

interface TypesetPanelProps {
  typeset: Typeset;
  onChange: (t: Typeset) => void;
}

// Walk every KP-managed block (.kp-wrap) and measure the client rect of
// each inter-word space character via Range. Works identically whether
// the text is KP-set (spaces inside .kp-line spans, word-spacing
// applied) or browser-wrapped plain text — which is what makes the
// stats comparable across the three modes.
function collectGaps(): {
  gaps: GapRect[];
  rags: RagRect[];
  ragDepths: number[];
  widows: number;
  lineCount: number;
  paraCount: number;
} {
  const gaps: GapRect[] = [];
  const rags: RagRect[] = [];
  const ragDepths: number[] = [];
  let widows = 0;
  let lineCount = 0;
  const wraps = Array.from(document.querySelectorAll('.kp-wrap'));
  wraps.forEach((wrap, para) => {
    // Line boxes: .kp-wrap is display:block (one rect), so fragment the
    // CONTENT via a Range — its client rects come per inline fragment —
    // and merge fragments that share a baseline. Works identically for
    // KP-set lines and browser-wrapped plain text.
    const range = document.createRange();
    range.selectNodeContents(wrap);
    const frags = Array.from(range.getClientRects()).filter(
      (r) => r.width > 1 && r.height > 4,
    );
    const lineRects: Array<{ top: number; bottom: number; right: number }> = [];
    frags
      .sort((a, b) => a.top - b.top)
      .forEach((r) => {
        const last = lineRects[lineRects.length - 1];
        const mid = (r.top + r.bottom) / 2;
        if (last && mid < last.bottom) {
          last.top = Math.min(last.top, r.top);
          last.bottom = Math.max(last.bottom, r.bottom);
          last.right = Math.max(last.right, r.right);
        } else {
          lineRects.push({ top: r.top, bottom: r.bottom, right: r.right });
        }
      });
    lineCount += lineRects.length;
    // Rag: unused right-edge slack per non-last line, both as a stat
    // and as an overlay box from line end to the measure edge.
    const wrapRight = wrap.getBoundingClientRect().right;
    lineRects.forEach((lr, i) => {
      if (i === lineRects.length - 1) return;
      const depth = Math.max(0, wrapRight - lr.right);
      ragDepths.push(depth);
      if (depth > 0.5) {
        rags.push({
          x: lr.right + window.scrollX,
          y: lr.top + window.scrollY,
          w: depth,
          h: lr.bottom - lr.top,
        });
      }
    });
    const lineOf = (y: number): number => {
      let best = 0;
      let bestD = Infinity;
      lineRects.forEach((r, i) => {
        const d = Math.abs((r.top + r.bottom) / 2 - y);
        if (d < bestD) { bestD = d; best = i; }
      });
      return best;
    };
    const walker = document.createTreeWalker(wrap, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const textNode = node as Text;
      const text = textNode.data;
      for (let i = 0; i < text.length; i++) {
        if (text[i] !== ' ') continue;
        const range = document.createRange();
        range.setStart(textNode, i);
        range.setEnd(textNode, i + 1);
        const r = range.getClientRects()[0];
        if (!r || r.width <= 0.1) continue;
        gaps.push({
          x: r.left + window.scrollX,
          y: r.top + window.scrollY,
          w: r.width,
          h: r.height,
          para,
          line: lineOf(r.top + r.height / 2),
        });
      }
    }
    if (lineRects.length > 1) {
      const lastIdx = lineRects.length - 1;
      const gapsOnLast = gaps.filter((g) => g.para === para && g.line === lastIdx).length;
      if (gapsOnLast === 0) widows++;
    }
  });
  return { gaps, rags, ragDepths, widows, lineCount, paraCount: wraps.length };
}

// River joins: within a paragraph, a gap on line L and a gap on line
// L+1 whose horizontal spans overlap stack into a vertical channel of
// white. Each such pair is one join; chains of joins read as rivers.
// Returns the join count plus the set of gap indices participating on
// either end, so the overlay can paint river gaps hot.
function markRivers(gaps: GapRect[]): { joins: number; riverGaps: Set<number> } {
  let joins = 0;
  const riverGaps = new Set<number>();
  const byParaLine = new Map<string, number[]>();
  gaps.forEach((g, i) => {
    const k = `${g.para}:${g.line}`;
    const arr = byParaLine.get(k);
    if (arr) arr.push(i); else byParaLine.set(k, [i]);
  });
  gaps.forEach((g, i) => {
    const below = byParaLine.get(`${g.para}:${g.line + 1}`);
    if (!below) return;
    let joined = false;
    for (const j of below) {
      const b = gaps[j]!;
      if (b.x < g.x + g.w && g.x < b.x + b.w) {
        joined = true;
        riverGaps.add(i);
        riverGaps.add(j);
      }
    }
    if (joined) joins++;
  });
  return { joins, riverGaps };
}

function computeStats(
  gaps: GapRect[],
  ragDepths: number[],
  widows: number,
  lineCount: number,
  paraCount: number,
): GapStats {
  const n = ragDepths.length;
  const ragMean = n ? ragDepths.reduce((a, b) => a + b, 0) / n : 0;
  const ragSigma = n
    ? Math.sqrt(ragDepths.reduce((a, b) => a + (b - ragMean) * (b - ragMean), 0) / n)
    : 0;
  const { joins: rivers } = markRivers(gaps);
  return {
    paragraphs: paraCount,
    lines: lineCount,
    ragMean,
    ragSigma,
    ragMax: n ? Math.max(...ragDepths) : 0,
    widows,
    rivers,
  };
}

// Tint scale for the rag overlay: shallow rag is quiet, deep rag runs
// hot — the eye should land where a line stops far short of the measure.
function ragColor(depth: number): string {
  if (depth > 80) return 'rgba(200, 60, 40, 0.45)';
  if (depth > 40) return 'rgba(214, 138, 60, 0.40)';
  return 'rgba(120, 140, 120, 0.22)';
}

export function TypesetPanel({ typeset, onChange }: TypesetPanelProps) {
  const [showGaps, setShowGaps] = useState(false);
  const [showRag, setShowRag] = useState(false);
  const [stats, setStats] = useState<GapStats | null>(null);
  const [ragOverlay, setRagOverlay] = useState<RagRect[]>([]);
  const [gapOverlay, setGapOverlay] = useState<Array<GapRect & { river: boolean }>>([]);

  const measure = useCallback(() => {
    const { gaps, rags, ragDepths, widows, lineCount, paraCount } = collectGaps();
    setStats(computeStats(gaps, ragDepths, widows, lineCount, paraCount));
    setRagOverlay(rags);
    const { riverGaps } = markRivers(gaps);
    setGapOverlay(gaps.map((g, i) => ({ ...g, river: riverGaps.has(i) })));
  }, []);

  // Re-measure when the mode flips (double rAF + settle delay so KP's
  // ResizeObserver relayout lands first) and on resize.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const kick = () => {
      timer = setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(measure)), 250);
    };
    kick();
    const onResize = () => { clearTimeout(timer); kick(); };
    window.addEventListener('resize', onResize);
    return () => { clearTimeout(timer); window.removeEventListener('resize', onResize); };
  }, [typeset, measure]);

  const modes: Array<{ id: Typeset; label: string; title: string }> = [
    { id: 'kp', label: 'KP', title: 'Knuth-Plass breaks — even rag, widow control, natural spacing' },
    { id: 'off', label: 'Browser', title: 'Browser default wrap — no Knuth-Plass at all' },
  ];

  return (
    <>
      {(showGaps || showRag) && (
        <div className={s.overlay} aria-hidden="true">
          {showRag && ragOverlay.map((g, i) => (
            <div
              key={`r${i}`}
              className={s.gap}
              style={{
                left: g.x,
                top: g.y,
                width: g.w,
                height: g.h,
                background: ragColor(g.w),
              }}
            />
          ))}
          {showGaps && gapOverlay.map((g, i) => (
            <div
              key={`g${i}`}
              className={s.gap}
              style={{
                left: g.x,
                top: g.y,
                width: g.w,
                height: g.h,
                // River gaps hot (they stack into channels of white on
                // adjacent lines); ordinary spaces a quiet wash.
                background: g.river
                  ? 'rgba(200, 60, 40, 0.55)'
                  : 'rgba(64, 120, 192, 0.30)',
              }}
            />
          ))}
        </div>
      )}
      <aside className={s.root} aria-label="Typesetting evaluation">
        <div className={s.modes}>
          {modes.map((m) => (
            <button
              key={m.id}
              className={typeset === m.id ? s.active : ''}
              aria-pressed={typeset === m.id}
              title={m.title}
              onClick={() => onChange(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <label className={s.gapsToggle}>
          <input
            type="checkbox"
            checked={showGaps}
            onChange={(e) => setShowGaps(e.target.checked)}
          />
          show gaps
        </label>
        <label className={s.gapsToggle}>
          <input
            type="checkbox"
            checked={showRag}
            onChange={(e) => setShowRag(e.target.checked)}
          />
          show rag
        </label>
        {stats && (
          <dl className={s.stats}>
            <div><dt>lines</dt><dd>{stats.lines} in {stats.paragraphs} blocks</dd></div>
            <div><dt>rag mean</dt><dd>{stats.ragMean.toFixed(1)}px</dd></div>
            <div><dt>rag σ</dt><dd>{stats.ragSigma.toFixed(1)}px</dd></div>
            <div><dt>rag max</dt><dd>{stats.ragMax.toFixed(0)}px</dd></div>
            <div><dt>widows</dt><dd>{stats.widows}</dd></div>
            <div><dt>river joins</dt><dd>{stats.rivers}</dd></div>
          </dl>
        )}
        <button className={s.refresh} onClick={measure} title="Re-measure after scroll/expand">
          re-measure
        </button>
      </aside>
    </>
  );
}
