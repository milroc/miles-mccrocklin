// Inline video that autoplays only when scrolled into view and pauses
// when scrolled away. Muted + playsInline so mobile browsers allow the
// autoplay; reduced-motion users get a paused first frame.
import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '../utils/media';

export function VideoInView({ src, poster }: { src?: string; poster?: string }) {
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
