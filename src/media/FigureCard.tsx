// Single figure tile. Reused across strip/grid/phone-row/carousel layouts
// so the card chrome (embed iframe, video, image, tag) stays consistent.
//
// `scope` is the list the lightbox should navigate when the card is
// clicked — usually all matches in the figure, but the phone row passes
// only the portrait subset so swiping in the lightbox stays within the
// phone gallery.
//
// Visual styling lives in FigureCard.module.css; layout containers add
// their own modifier rules on top by targeting the `data-figure-card` /
// `data-figure-tag` hooks (the module's class names are hashed).
import { useContext, type CSSProperties, type ReactNode } from 'react';
import { MediaCtx, mediaSrc } from '../utils/media';
import { VideoInView } from './VideoInView';
import type { MediaItem } from '../types';
import s from './FigureCard.module.css';

interface FigureCardProps {
  p: MediaItem;
  scope: MediaItem[];
  // Suppress the corner tag overlay only — the tag stays in the data so
  // the lightbox caption can still show it. Used by MediaGroup.hide_tags.
  hideTag?: boolean;
  // Loop-clone card: removed from the tab order and AT tree so keyboard
  // and screen-reader users traverse each strip's items exactly once.
  // Mouse clicks must keep working — clones are visible in the peek/edge
  // zones — so this is aria-hidden + tabIndex, NOT `inert`.
  decorative?: boolean;
}

export function FigureCard({ p, scope, hideTag, decorative }: FigureCardProps): ReactNode {
  const { open } = useContext(MediaCtx);
  const ar = p.aspect || 1;
  const cardStyle = { '--ar': ar } as CSSProperties;
  if (p.type === 'embed') {
    return (
      <div
        className={`${s.root} ${s.embed}`}
        data-figure-card
        title={p.caption}
        style={cardStyle}
        aria-hidden={decorative || undefined}
        onContextMenu={(e) => e.preventDefault()}
      >
        <iframe
          src={mediaSrc(p.src)}
          title={p.caption || 'Embedded UI'}
          tabIndex={decorative ? -1 : undefined}
          loading="lazy"
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
        {p.tag && !hideTag && (
          <span className={s.tag} data-figure-tag>{p.tag}</span>
        )}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`${s.root} ${s[p.type]}`}
      data-figure-card
      aria-hidden={decorative || undefined}
      tabIndex={decorative ? -1 : undefined}
      onClick={() => open(scope, p.id)}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      title={p.caption}
      aria-label={p.caption || (p.type === 'video' ? 'Open video' : 'Open photo')}
      style={cardStyle}
    >
      {p.type === 'video' ? (
        // Video tiles autoplay only while in the viewport (see
        // VideoInView). Click still opens the lightbox.
        <VideoInView src={mediaSrc(p.src)} poster={mediaSrc(p.poster)} />
      ) : (
        // Explicit width/height (derived from aspect) gives the browser an
        // intrinsic-size hint so loading="lazy" + an aspect-ratio'd parent
        // don't collapse the lazy box to 0×0 before the image arrives —
        // observed on community-section heavyweight JPEGs where the
        // IntersectionObserver never fired and the image stayed blank.
        // decoding="async" hands the decode off the main thread.
        <img
          src={mediaSrc(p.src)}
          alt={p.caption || ''}
          loading="lazy"
          decoding="async"
          width={Math.round(1000 * ar)}
          height={1000}
        />
      )}
      {p.tag && !hideTag && (
        <span className={s.tag} data-figure-tag>{p.tag}</span>
      )}
    </button>
  );
}
