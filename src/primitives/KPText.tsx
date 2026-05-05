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
// redaction registry in data/resume.json.
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
import { ModeContext, PrintContext } from '../utils/mode';
import { KP_BULLET_FONT, KP_PRINT_BULLET_WIDTH } from '../utils/kp-font';
import './KPText.css';

const REDACTED_TOOLTIP =
  'Withheld out of respect for collaborators. See note below; reach out for more.';

interface KPTextProps {
  text?: string;
  prefix?: string;
  prefixNode?: ReactNode;
  firstLineIndent?: number;
}

export function KPText({ text, prefix, prefixNode, firstLineIndent }: KPTextProps) {
  const mode = useContext(ModeContext);
  const printing = useContext(PrintContext);
  const cfg = KP_BULLET_FONT[mode] || KP_BULLET_FONT.interactive;
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const measuredWidth = useElementWidth(wrapRef);
  const width = printing ? KP_PRINT_BULLET_WIDTH : measuredWidth;

  const result = useMemo(() => {
    if (!text || width < 40) return null;
    const hyph = hyphenateText ? hyphenateText(text) : text;
    let indent = firstLineIndent || 0;
    if (prefix && !firstLineIndent) {
      indent = measureText(prefix, cfg.boldFont) + 1;
    }
    const firstLineMaxWidth = Math.max(40, width - indent);
    return layoutParagraph(hyph, {
      font: cfg.font,
      maxWidth: width,
      firstLineMaxWidth,
    });
  }, [text, prefix, firstLineIndent, width, cfg.font, cfg.boldFont]);

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
      {result.lines.map((ln, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          <span className="kp-line">{withRedactions(ln.text)}</span>
        </Fragment>
      ))}
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
