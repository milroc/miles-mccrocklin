// Media-related utilities shared by Figure, FigureCarousel, and MediaProvider.
import { createContext } from 'react';
import type { MediaContextValue } from '../types';

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
