// Horizontal scroll-snap photo strip. Centers the highest-priority item on
// mount; cards arranged so priority decreases outward from the middle.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { FigureCard } from './FigureCard';
import { arrangeByPriority } from '../utils/media';
import type { MediaItem } from '../types';
import s from './FigureCarousel.module.css';

interface FigureCarouselProps {
  matches: MediaItem[];
}

export function FigureCarousel({ matches }: FigureCarouselProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const arranged = useMemo(() => arrangeByPriority(matches), [matches]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !arranged.length) return;
    const id = requestAnimationFrame(() => {
      const cards = el.querySelectorAll<HTMLElement>('.figure-card');
      if (!cards.length) return;
      const mid = Math.floor(cards.length / 2);
      const card = cards[mid];
      if (!card) return;
      el.scrollLeft =
        card.offsetLeft + card.offsetWidth / 2 - el.clientWidth / 2;
    });
    return () => cancelAnimationFrame(id);
  }, [arranged.length]);

  return (
    // Wrapper hosts the hover-only chevron hints (CSS pseudos). The
    // carousel itself has overflow-x scroll + a mask gradient, so the
    // hints can't live on it directly without scrolling away or fading
    // into the mask edges.
    <div className={s.wrap}>
      <div className={s.carousel} ref={ref}>
        <div className={s.track}>
          {arranged.map((p) => <FigureCard key={p.id} p={p} scope={arranged} />)}
        </div>
      </div>
    </div>
  );
}
