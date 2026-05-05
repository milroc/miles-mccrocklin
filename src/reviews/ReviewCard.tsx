// Single Airbnb-style review card. Highlights are body-aware: when the
// guest provided a translation, we switch which phrase list drives the
// `<mark>` overlays so the highlights match the visible body.
import { useState } from 'react';
import { highlightReview } from '../utils/highlight';
import type { Review } from '../types';
import s from './Reviews.module.css';

interface ReviewCardProps {
  r: Review;
  cleanLocation: (loc: string) => string;
}

export function ReviewCard({ r, cleanLocation }: ReviewCardProps) {
  const [translated, setTranslated] = useState(false);
  const showTranslated = translated && !!r.translation;
  const body = showTranslated ? r.translation! : r.review;
  // Highlights are body-aware. Two patterns supported:
  //   1. Combined list: drop both original-language and translated phrases
  //      into `host_highlights`. The regex matches whichever exist in the
  //      current body and silently skips misses. Simplest to author.
  //   2. Separate lists: put translated-text phrases in
  //      `translation_highlights` for stricter authoring separation. When
  //      defined, it overrides `host_highlights` while showing the
  //      translation.
  const highlights = showTranslated
    ? (r.translation_highlights ?? r.host_highlights)
    : r.host_highlights;

  return (
    <article className={s.card}>
      <div className={s.cardHead}>
        <div className={s.avatar} aria-hidden="true">
          {r.reviewer.charAt(0)}
        </div>
        <div className={s.reviewer}>
          <div className={s.name}>{r.reviewer}</div>
          <div className={s.location}>{cleanLocation(r.location)}</div>
        </div>
        <div className={s.metaRow}>
          <span className={s.stars} aria-label={`${r.rating} out of 5`} role="img">
            <span aria-hidden="true">{'★'.repeat(r.rating)}</span>
          </span>
          <span>{r.date}</span>
        </div>
      </div>
      <p className={s.text}>{highlightReview(body, highlights, s.highlight!)}</p>
      {r.translation && (
        <button
          type="button"
          className={s.translate}
          onClick={() => setTranslated(!translated)}
          aria-label={translated ? 'Show original' : 'Translate to English (US)'}
        >
          <span className={s.translateIcon} aria-hidden="true">A<sub>あ</sub></span>
          <span>{translated ? 'Show original' : 'Translate to English (US)'}</span>
        </button>
      )}
    </article>
  );
}
