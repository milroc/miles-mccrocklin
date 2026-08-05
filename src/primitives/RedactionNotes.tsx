// Footnote section for redacted metric variables. The Greek letters
// in the running prose anchor here via <a href="#note-{id}">; each
// <dt> below carries the matching id and a brief context line.
// Pattern is editorial-CV native (academic-style endnotes) and works
// on every device — no floating popover, no positioning math.
//
// Data is sourced from `data/me.json` and passed in as a prop by
// App.tsx, matching the pattern used by Community / Skills / EduEntry.
// Preamble copy lives in `src/me.ts` (REDACTION_DESCRIPTION).
import { Fragment } from 'react';
import { REDACTION_DESCRIPTION } from '../me';
import type { Redaction } from '../types';
import s from './RedactionNotes.module.css';

interface RedactionNotesProps {
  items?: Redaction[];
}

export function RedactionNotes({ items }: RedactionNotesProps) {
  if (!items || items.length === 0) return null;
  return (
    <>
      <p className={s.preamble}>{REDACTION_DESCRIPTION}</p>
      <dl className={s.list}>
        {items.map((r) => (
          <Fragment key={r.id}>
            <dt id={`note-${r.id}`} className={s.glyph}>
              {r.glyph}
            </dt>
            <dd className={s.context}>
              {r.context}{' '}
              {/* Return path: the inline glyph's first occurrence
                  carries id="ref-{id}" (see RedactedText.tsx). */}
              <a
                className={s.backref}
                href={`#ref-${r.id}`}
                aria-label="Back to the text"
              >
                ↩
              </a>
            </dd>
          </Fragment>
        ))}
      </dl>
    </>
  );
}
