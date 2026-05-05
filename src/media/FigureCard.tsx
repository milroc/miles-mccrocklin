// Single figure tile. Reused across strip/grid/phone-row/carousel layouts
// so the card chrome (embed iframe, video, image, tag) stays consistent.
//
// `scope` is the list the lightbox should navigate when the card is
// clicked — usually all matches in the figure, but the phone row passes
// only the portrait subset so swiping in the lightbox stays within the
// phone gallery.
//
// All visual styling lives on the global `.figure-card` primitive in
// globals.css; layout containers add their own modifier rules on top.
import { useContext, type CSSProperties, type ReactNode } from 'react';
import { MediaCtx, prefersReducedMotion } from '../utils/media';
import type { MediaItem } from '../types';

interface FigureCardProps {
  p: MediaItem;
  scope: MediaItem[];
  // Suppress the corner tag overlay only — the tag stays in the data so
  // the lightbox caption can still show it. Used by MediaGroup.hide_tags.
  hideTag?: boolean;
}

export function FigureCard({ p, scope, hideTag }: FigureCardProps): ReactNode {
  const { open } = useContext(MediaCtx);
  const ar = p.aspect || 1;
  const cardStyle = { '--ar': ar } as CSSProperties;
  if (p.type === 'embed') {
    return (
      <div
        className="figure-card embed"
        title={p.caption}
        style={cardStyle}
        onContextMenu={(e) => e.preventDefault()}
      >
        <iframe
          src={p.src}
          title={p.caption || 'Embedded UI'}
          loading="lazy"
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
        {p.tag && !hideTag && <span className="figure-tag">{p.tag}</span>}
      </div>
    );
  }
  // Honor prefers-reduced-motion on every video card.
  const reduceMotion = prefersReducedMotion();
  return (
    <button
      type="button"
      className={`figure-card ${p.type}`}
      onClick={() => open(scope, p.id)}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      title={p.caption}
      aria-label={p.caption || (p.type === 'video' ? 'Open video' : 'Open photo')}
      style={cardStyle}
    >
      {p.type === 'video' ? (
        <video
          src={p.src}
          poster={p.poster}
          muted
          loop={!reduceMotion}
          autoPlay={!reduceMotion}
          playsInline
          preload="metadata"
        />
      ) : (
        // Explicit width/height (derived from aspect) gives the browser an
        // intrinsic-size hint so loading="lazy" + an aspect-ratio'd parent
        // don't collapse the lazy box to 0×0 before the image arrives —
        // observed on community-section heavyweight JPEGs where the
        // IntersectionObserver never fired and the image stayed blank.
        // decoding="async" hands the decode off the main thread.
        <img
          src={p.src}
          alt={p.caption || ''}
          loading="lazy"
          decoding="async"
          width={Math.round(1000 * ar)}
          height={1000}
        />
      )}
      {p.tag && !hideTag && <span className="figure-tag">{p.tag}</span>}
    </button>
  );
}
