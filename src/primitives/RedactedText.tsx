// Prose with redaction anchors. Greek letters in the text render as
// italic, accent-colored variables with a hover tooltip and an anchor
// to the matching footnote in the Notes section. The matched glyph set
// lives in src/me.ts (REDACTED_GLYPH_RE) and must stay in sync with the
// redaction registry in data/me.json.
// The convention signals "I know the figure, intentionally not sharing
// it publicly" — turns a leak risk into a discretion signal.
import type { ReactNode } from 'react';
import { REDACTED_GLYPH_RE } from '../me';
import { REDACTION_BY_GLYPH } from '../redactions';
import './RedactedText.css';

const REDACTED_TOOLTIP =
  'Withheld out of respect for collaborators. See note below; reach out for more.';

interface RedactedTextProps {
  text?: string;
}

export function RedactedText({ text }: RedactedTextProps): ReactNode {
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
