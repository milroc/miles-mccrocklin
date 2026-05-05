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

// Arrange items so the highest-priority one sits at the visual center.
export function arrangeByPriority(items: MediaItem[]): MediaItem[] {
  const byPrio = [...items]
    .map((it, i) => ({ it, prio: it.priority ?? 999, i }))
    .sort((a, b) => a.prio - b.prio || a.i - b.i)
    .map(({ it }) => it);
  const positioned = byPrio.map((item, i) => {
    let pos = 0;
    if (i > 0) pos = i % 2 === 1 ? -Math.ceil(i / 2) : i / 2;
    return { item, pos };
  });
  return positioned
    .sort((a, b) => a.pos - b.pos)
    .map(({ item }) => item);
}
