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
