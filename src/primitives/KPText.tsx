// Knuth-Plass renderer for bullets — replaces the browser's greedy line
// wrap inside <li> with breaks chosen by utils/kp. Width is measured from
// the actual rendered DOM (so layout follows the page as it shrinks below
// the 850px / 816px reference design widths) and re-runs whenever the
// container resizes.
//
// `.kp-wrap` and `.kp-line` are global classes (declared in globals.css)
// because Bullets and other consumers want to flow them with display: block
// inside <li>. Keep the font strings in utils/kp-font in sync with the
// CSS bullet rules in globals.css.
//
// Redactions: Greek letters in bullet text are rendered as italic,
// accent-colored variables with a hover tooltip. The matched glyph set
// lives in src/me.ts (REDACTED_GLYPH_RE) and must stay in sync with the
// redaction registry in data/me.json.
// The convention signals "I know the figure, intentionally not sharing it
// publicly" — turns a leak risk into a discretion signal. Markers are
// chosen so KP measures them as the actual visible glyph (no marker
// strip-out / re-insertion needed).
import {
  Fragment,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { REDACTED_GLYPH_RE } from '../me';
import { REDACTION_BY_GLYPH } from '../redactions';
import { layoutParagraph, measureText } from '../utils/kp';
import { hyphenate as hyphenateText } from '../utils/hyphenate';
import { useElementWidth } from '../utils/hooks';
import { ModeContext, PrintContext, TypesetContext } from '../utils/mode';
import { KP_BULLET_FONT, KP_PRINT_BULLET_WIDTH, type KPFontCfg } from '../utils/kp-font';
import type { Mode } from '../types';
import './KPText.css';

const REDACTED_TOOLTIP =
  'Withheld out of respect for collaborators. See note below; reach out for more.';

interface KPTextProps {
  text?: string;
  prefix?: string;
  prefixNode?: ReactNode;
  firstLineIndent?: number;
  // Override the default bullet-font measurement config. Pass a mode→
  // cfg table (e.g. KP_BODY_FONT from utils/kp-font) when KP is
  // running over text rendered at a different size/family than the
  // resume bullets. Defaults to KP_BULLET_FONT so existing callers
  // (Bullets) keep working.
  font?: Record<Mode, KPFontCfg>;
  // Full justification: KP switches to stretch-ratio line costs and
  // each non-last line distributes its slack as word-spacing so the
  // right edge sits flush on the measure. Last lines stay ragged.
  justify?: boolean;
}

// A space stretched past this multiple of the font size reads as a gap
// (rivers); beyond it the line renders ragged instead of gappy. With
// the DP's stretch-ratio cost this should rarely trigger — it guards
// pathological lines (few spaces, wide measure).
const MAX_STRETCH_EM = 0.5;
// Justify short of the measure by this much. Canvas measurement drifts
// from DOM rendering by a fraction of a px per glyph; a line stretched
// to the exact theoretical width can overshoot in the browser, and a
// first line sharing its row with a bold prefix then wraps WHOLE below
// it (nowrap makes the span atomic) — stranding "name —" alone on the
// line. A uniform shortfall keeps the right edge optically straight
// while making overshoot impossible.
const JUSTIFY_SAFETY_PX = 3;

export function KPText({ text, prefix, prefixNode, firstLineIndent, font, justify: justifyProp }: KPTextProps) {
  const mode = useContext(ModeContext);
  const printing = useContext(PrintContext);
  const typeset = useContext(TypesetContext);
  const justify = (justifyProp ?? false) && typeset === 'justify';
  const fontTable = font ?? KP_BULLET_FONT;
  const cfg = fontTable[mode] || fontTable.interactive;
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const measuredWidth = useElementWidth(wrapRef);
  const width = printing ? KP_PRINT_BULLET_WIDTH : measuredWidth;

  const layout = useMemo(() => {
    // 'off' skips KP entirely: the plain-span fallback below renders
    // and the browser's own greedy wrap takes over (no soft hyphens,
    // no chosen breaks) — the comparison baseline for the toolbar.
    if (typeset === 'off') return null;
    if (!text || width < 40) return null;
    const hyph = hyphenateText ? hyphenateText(text) : text;
    let indent = firstLineIndent || 0;
    if (prefix && !firstLineIndent) {
      indent = measureText(prefix, cfg.boldFont) + 1;
    }
    const firstLineMaxWidth = Math.max(40, width - indent);
    const result = layoutParagraph(hyph, {
      font: cfg.font,
      maxWidth: width,
      firstLineMaxWidth,
      justify,
    });
    return { result, firstLineMaxWidth };
  }, [text, prefix, firstLineIndent, width, cfg.font, cfg.boldFont, justify, typeset]);
  const result = layout?.result ?? null;

  // Justified lines fill the measure by stretching their inter-word
  // spaces: slack is known per line from the KP pass, so word-spacing
  // is exact, not the browser's guess. Last lines render ragged.
  const lineSpacing = (i: number): string | undefined => {
    if (!justify || !layout || !result) return undefined;
    const ln = result.lines[i]!;
    if (i === result.lines.length - 1 || ln.spaces <= 0) return undefined;
    const target = (i === 0 ? layout.firstLineMaxWidth : width) - JUSTIFY_SAFETY_PX;
    const slack = target - ln.width;
    if (slack <= 0.5) return undefined;
    const fontPx = parseFloat(cfg.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? '13');
    const per = Math.min(slack / ln.spaces, fontPx * MAX_STRETCH_EM);
    return `${per.toFixed(2)}px`;
  };

  if (!text && !prefixNode && !prefix) return null;

  const head: ReactNode = prefixNode ?? (prefix ? <b>{prefix}</b> : null);

  if (!result || !result.lines.length) {
    return (
      <span ref={wrapRef} className="kp-wrap">
        {head}{withRedactions(text)}
      </span>
    );
  }
  return (
    <span ref={wrapRef} className="kp-wrap">
      {head}
      {result.lines.map((ln, i) => {
        const ws = lineSpacing(i);
        return (
          <Fragment key={i}>
            {i > 0 && <br />}
            <span
              className="kp-line"
              style={ws ? { wordSpacing: ws } : undefined}
            >
              {withRedactions(ln.text)}
            </span>
          </Fragment>
        );
      })}
    </span>
  );
}

function withRedactions(text: string | undefined): ReactNode {
  if (!text) return null;
  if (!REDACTED_GLYPH_RE.test(text)) return text;
  REDACTED_GLYPH_RE.lastIndex = 0;
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = REDACTED_GLYPH_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const r = REDACTION_BY_GLYPH.get(m[0]);
    if (!r) {
      // Unregistered Greek letter — render as plain text rather than
      // a broken anchor. (Should not happen given REDACTED_GLYPH_RE
      // matches exactly the registered glyphs.)
      parts.push(m[0]);
    } else {
      parts.push(
        <a
          key={parts.length}
          className="redacted"
          href={`#note-${r.id}`}
          data-redacted-tooltip={REDACTED_TOOLTIP}
          aria-label={`Redacted variable ${r.glyph}. ${REDACTED_TOOLTIP}`}
        >
          {r.glyph}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
