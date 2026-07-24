// Floating typesetting evaluation panel — prototype chrome for the KP
// justification PR. Hosts the Justify / Ragged / Browser switch, a gap
// visualization overlay (every inter-word space tinted by how far it
// deviates from the page's median gap, the same idea as the pretext
// justification-comparison demo), and live micro-typography stats:
// line count, gap-width deviation, and river joins (gaps on adjacent
// lines whose horizontal spans overlap — the raw material of "rivers"
// of white running down a paragraph).
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

interface GapStats {
  paragraphs: number;
  lines: number;
  gaps: number;
  mean: number;
  sigma: number;
  min: number;
  max: number;
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
function collectGaps(): { gaps: GapRect[]; lineCount: number; paraCount: number } {
  const gaps: GapRect[] = [];
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
    const lineRects: Array<{ top: number; bottom: number }> = [];
    frags
      .sort((a, b) => a.top - b.top)
      .forEach((r) => {
        const last = lineRects[lineRects.length - 1];
        const mid = (r.top + r.bottom) / 2;
        if (last && mid < last.bottom) {
          last.top = Math.min(last.top, r.top);
          last.bottom = Math.max(last.bottom, r.bottom);
        } else {
          lineRects.push({ top: r.top, bottom: r.bottom });
        }
      });
    lineCount += lineRects.length;
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
  });
  return { gaps, lineCount, paraCount: wraps.length };
}

function computeStats(gaps: GapRect[], lineCount: number, paraCount: number): GapStats {
  const widths = gaps.map((g) => g.w);
  const n = widths.length;
  const mean = n ? widths.reduce((a, b) => a + b, 0) / n : 0;
  const sigma = n
    ? Math.sqrt(widths.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n)
    : 0;
  // River joins: within a paragraph, a gap on line L and a gap on line
  // L+1 whose horizontal spans overlap stack into a vertical channel of
  // white. Each such pair is one join; chains of joins read as rivers.
  let rivers = 0;
  const byParaLine = new Map<string, GapRect[]>();
  gaps.forEach((g) => {
    const k = `${g.para}:${g.line}`;
    const arr = byParaLine.get(k);
    if (arr) arr.push(g); else byParaLine.set(k, [g]);
  });
  gaps.forEach((g) => {
    const below = byParaLine.get(`${g.para}:${g.line + 1}`);
    if (!below) return;
    for (const b of below) {
      if (b.x < g.x + g.w && g.x < b.x + b.w) { rivers++; break; }
    }
  });
  return {
    paragraphs: paraCount,
    lines: lineCount,
    gaps: n,
    mean,
    sigma,
    min: n ? Math.min(...widths) : 0,
    max: n ? Math.max(...widths) : 0,
    rivers,
  };
}

// Tint scale for the overlay: deviation from the median gap, blue when
// tighter, orange→red when wider. Median (not natural space width)
// keeps the scale meaningful in all three modes without a canvas probe.
function gapColor(w: number, median: number): string {
  const dev = (w - median) / median;
  if (dev < -0.04) return 'rgba(64, 120, 192, 0.55)';
  if (dev > 0.35) return 'rgba(200, 60, 40, 0.60)';
  if (dev > 0.12) return 'rgba(214, 138, 60, 0.55)';
  return 'rgba(120, 140, 120, 0.30)';
}

export function TypesetPanel({ typeset, onChange }: TypesetPanelProps) {
  const [showGaps, setShowGaps] = useState(false);
  const [stats, setStats] = useState<GapStats | null>(null);
  const [overlay, setOverlay] = useState<GapRect[]>([]);
  const [median, setMedian] = useState(3.5);

  const measure = useCallback(() => {
    const { gaps, lineCount, paraCount } = collectGaps();
    setStats(computeStats(gaps, lineCount, paraCount));
    const widths = gaps.map((g) => g.w).sort((a, b) => a - b);
    setMedian(widths[Math.floor(widths.length / 2)] ?? 3.5);
    setOverlay(gaps);
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
    { id: 'justify', label: 'Justify', title: 'Knuth-Plass breaks + shrink/stretch glue, flush right edge' },
    { id: 'ragged', label: 'Ragged', title: 'Knuth-Plass breaks, ragged right edge' },
    { id: 'off', label: 'Browser', title: 'Browser default wrap — no Knuth-Plass at all' },
  ];

  return (
    <>
      {showGaps && (
        <div className={s.overlay} aria-hidden="true">
          {overlay.map((g, i) => (
            <div
              key={i}
              className={s.gap}
              style={{
                left: g.x,
                top: g.y,
                width: g.w,
                height: g.h,
                background: gapColor(g.w, median),
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
        {stats && (
          <dl className={s.stats}>
            <div><dt>lines</dt><dd>{stats.lines} in {stats.paragraphs} blocks</dd></div>
            <div><dt>gaps</dt><dd>{stats.gaps} · mean {stats.mean.toFixed(2)}px</dd></div>
            <div><dt>deviation σ</dt><dd>{stats.sigma.toFixed(2)}px ({stats.mean > 0 ? ((100 * stats.sigma) / stats.mean).toFixed(0) : 0}%)</dd></div>
            <div><dt>range</dt><dd>{stats.min.toFixed(1)}–{stats.max.toFixed(1)}px</dd></div>
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
