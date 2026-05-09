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
import {
  useContext,
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { MediaCtx, prefersReducedMotion, mediaSrc } from '../utils/media';
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
          src={mediaSrc(p.src)}
          title={p.caption || 'Embedded UI'}
          loading="lazy"
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
        {p.tag && !hideTag && <span className="figure-tag">{p.tag}</span>}
      </div>
    );
  }
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
      {p.tag && !hideTag && <span className="figure-tag">{p.tag}</span>}
    </button>
  );
}

// Inline video that autoplays only when scrolled into view and pauses
// when scrolled away. Muted + playsInline so mobile browsers allow the
// autoplay; reduced-motion users get a paused first frame.
function VideoInView({ src, poster }: { src?: string; poster?: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const reduceMotion = prefersReducedMotion();
    if (reduceMotion) return;
    if (typeof IntersectionObserver === 'undefined') {
      // No IO support: fall back to autoplay always.
      void v.play().catch(() => {});
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            // play() returns a promise that may reject if the user navigated
            // away or autoplay was blocked; swallow it silently.
            void v.play().catch(() => {});
          } else {
            v.pause();
          }
        }
      },
      { threshold: 0.4 },
    );
    io.observe(v);
    return () => {
      io.disconnect();
    };
  }, []);

  return (
    <video
      ref={videoRef}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload="metadata"
    />
  );
}
