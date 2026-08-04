// RedactionLegend — one compact mono footer line for 1-pager / print.
// The full Notes section (RedactionNotes) is hidden in mode-1pager to
// keep the PDF on one Letter page, which left the Greek redaction
// glyphs (Ξ α β …) with no key on paper. This line lists the glyphs
// and says why they exist, in a size that doesn't cost a second page.
// App.tsx renders it only when mode === '1pager' (print auto-switches
// to that mode before snapshot).
import type { Redaction } from '../types';
import s from './RedactionLegend.module.css';

interface RedactionLegendProps {
  items?: Redaction[];
}

export function RedactionLegend({ items }: RedactionLegendProps) {
  if (!items || items.length === 0) return null;
  const glyphs = items.map((r) => r.glyph).join(' ');
  return (
    <p className={s.root}>
      {glyphs} mark figures intentionally withheld; ask me about the specifics.
    </p>
  );
}
