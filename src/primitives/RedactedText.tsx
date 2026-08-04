// Prose with redaction anchors. Greek letters in the text render as
// italic, accent-colored variables with a hover tooltip and an anchor
// to the matching footnote in the Notes section. The matched glyph set
// lives in src/me.ts (REDACTED_GLYPH_RE) and must stay in sync with the
// redaction registry in data/me.json.
// The convention signals "I know the figure, intentionally not sharing
// it publicly" — turns a leak risk into a discretion signal.
import { useEffect, useRef, type ReactNode } from 'react';
import { REDACTED_GLYPH_RE } from '../me';
import { REDACTION_BY_GLYPH } from '../redactions';
import './RedactedText.css';

const REDACTED_TOOLTIP =
  'Withheld out of respect for collaborators. See note below; reach out for more.';

// First-occurrence registry for the ↩ return links in RedactionNotes.
// Each note links back to `#ref-{id}`, so exactly one glyph anchor per
// redaction may carry that id (a few glyphs recur in the prose).
// Claims are owned per component instance: components render in
// document order, so the first instance to render a glyph wins; its
// re-renders keep the id, and unmounting releases the claim.
const REF_CLAIMS = new Map<string, object>();

interface RedactedTextProps {
  text?: string;
}

export function RedactedText({ text }: RedactedTextProps): ReactNode {
  const owner = useRef({}).current;
  useEffect(
    () => () => {
      for (const [id, o] of REF_CLAIMS) {
        if (o === owner) REF_CLAIMS.delete(id);
      }
    },
    [owner],
  );
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
      const claim = REF_CLAIMS.get(r.id);
      const isFirst = claim === undefined || claim === owner;
      if (isFirst) REF_CLAIMS.set(r.id, owner);
      parts.push(
        <a
          key={parts.length}
          id={isFirst ? `ref-${r.id}` : undefined}
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
