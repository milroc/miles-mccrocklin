// KP renderer font config — kept beside KPText but exported so AIProjectBullet
// can measure prefix widths to set firstLineIndent. Keep in sync with the
// bullet rules in Bullets.module.css if those font sizes change.
import { measureText } from './kp';
import type { Mode } from '../types';

const KP_BULLET_FONT_BASE =
  'Georgia, "Times New Roman", Times, serif';

export type KPFontCfg = { font: string; boldFont: string };

export const KP_BULLET_FONT: Record<Mode, KPFontCfg> = {
  interactive: { font: `12.5px ${KP_BULLET_FONT_BASE}`, boldFont: `bold 12.5px ${KP_BULLET_FONT_BASE}` },
  text:        { font: `12.5px ${KP_BULLET_FONT_BASE}`, boldFont: `bold 12.5px ${KP_BULLET_FONT_BASE}` },
  '1pager':    { font: `12px ${KP_BULLET_FONT_BASE}`,   boldFont: `bold 12px ${KP_BULLET_FONT_BASE}` },
};

// Canonical bullet column width when the resume is being printed.
export const KP_PRINT_BULLET_WIDTH = 725;

type Weight = 'bold' | 'normal';
export type PrefixPart = readonly [text: string, weight: Weight];

export function measureKPPrefix(parts: readonly PrefixPart[], mode: Mode): number {
  const cfg = KP_BULLET_FONT[mode] || KP_BULLET_FONT.interactive;
  let total = 0;
  for (const [text, weight] of parts) {
    total += measureText(text, weight === 'bold' ? cfg.boldFont : cfg.font);
  }
  // Canvas measureText drifts from DOM layout by a fraction of a px per glyph.
  // On long bold prefixes (e.g. "diction.coach — ") the drift accumulates and
  // pushes prefix + first kp-line past the container, forcing the browser to
  // break between them. 6px absorbs realistic drift without losing meaningful
  // first-line capacity.
  return total + 6;
}
