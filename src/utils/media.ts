// Media-related utilities shared by Figure, FigureCarousel, and MediaProvider.
import { createContext } from 'react';
import type { MediaContextValue, MediaItem } from '../types';

// The lightbox is global (single overlay at the app root) but it has no
// global media list — every Figure passes its own items as the lightbox
// scope when opening.
export const MediaCtx = createContext<MediaContextValue>({ open: () => {} });

// Honor prefers-reduced-motion: when reduced, skip video autoplay/loop so
// users with vestibular sensitivity see a still poster instead of motion.
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  !!window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Lightbox treatment selector. UI items render with a dedicated about-text
// panel beside the screenshot; everything else (default) keeps the bottom
// gradient caption overlay. Driven by `subtype` in resume.json — no id-prefix
// heuristic, opt-in only.
export function isUiItem(p: MediaItem | null | undefined): boolean {
  return p?.subtype === 'ui';
}

// Resolve a media src from data/resume.json against the site root.
//
// resume.json was authored when / WAS the long-form page, so paths
// look like "media/foo/bar.jpg" (no leading slash). After the splash
// redesign the long-form lives at /long-form/, where a browser would
// resolve the same relative path to /long-form/media/... and 404.
// Absolutize at the render boundary so the data file stays untouched.
//
// Pass-through for already-absolute paths (http(s)://, //, /, data:,
// blob:, embed iframes pointing at YouTube/FB, etc).
export function mediaSrc(src: string | undefined): string | undefined {
  if (!src) return src;
  if (/^([a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(src)) return src;
  return '/' + src;
}
