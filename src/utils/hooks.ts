import { useState, useEffect, useLayoutEffect, type RefObject } from 'react';

// Live `matchMedia` subscription. Returns the current match state and
// re-renders when the media-query result flips. Used by Figure to branch
// layout on viewport: mobile gets the phone-gallery split, desktop gets
// the original justified strip.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent): void => setMatches(e.matches);
    mql.addEventListener('change', handler);
    setMatches(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

// Subscribes to width changes on the wrapper element and returns the live
// content-box width in CSS pixels. Falls back to a one-shot read + window
// resize listener when ResizeObserver isn't available.
//
// Two guards against the "ResizeObserver loop completed with undelivered
// notifications" feedback loop: KPText's layout output can change the
// wrapper width, which would re-fire the observer synchronously.
//   1. Defer the setState into the next animation frame so the current
//      observer callback returns before React commits new layout.
//   2. Skip the setState entirely when the floored width is unchanged.
//      Eliminates needless re-renders and short-circuits the loop.
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const read = (): void => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        const next = Math.floor(el.getBoundingClientRect().width);
        setWidth((prev) => (prev === next ? prev : next));
      });
    };
    read();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(read);
      ro.observe(el);
      return () => {
        if (raf) cancelAnimationFrame(raf);
        ro.disconnect();
      };
    }
    window.addEventListener('resize', read);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', read);
    };
  }, [ref]);
  return width;
}
