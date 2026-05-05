// Horizontal scroll-snap photo strip with seamless looping. The strip is
// rendered three times; on mount we left-align the lead card (index 0 in
// the data array) inside the middle copy so the user reads left-to-right,
// 0 → N-1. On scroll we shift scrollLeft by one set width whenever the
// viewport crosses out of the middle copy. The jump lands on a visually
// identical card, so the loop reads as continuous in either direction.
import { useLayoutEffect, useRef } from 'react';
import { FigureCard } from './FigureCard';
import type { MediaItem } from '../types';
import s from './FigureCarousel.module.css';

interface FigureCarouselProps {
  matches: MediaItem[];
  hideTags?: boolean;
}

const COPIES = 3;

export function FigureCarousel({ matches, hideTags }: FigureCarouselProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const N = matches.length;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !N) return;

    let setWidth = 0;
    let copyBStart = 0;
    let copyCStart = 0;
    let jumping = false;

    const measure = (): boolean => {
      const cards = el.querySelectorAll<HTMLElement>('.figure-card');
      if (cards.length < N * COPIES) return false;
      const a = cards[0].offsetLeft;
      copyBStart = cards[N].offsetLeft;
      copyCStart = cards[2 * N].offsetLeft;
      setWidth = copyBStart - a;
      return setWidth > 0;
    };

    const startAtZero = () => {
      const cards = el.querySelectorAll<HTMLElement>('.figure-card');
      // First card of the middle (B) copy = item 0 in the data array.
      // Array order is the priority, so the lead photo is what the user
      // sees first; subsequent items extend right.
      const card = cards[N];
      if (!card) return;
      el.scrollLeft = card.offsetLeft;
    };

    const normalize = () => {
      if (jumping || !setWidth) return;
      const left = el.scrollLeft;
      let next = left;
      if (left >= copyCStart) next = left - setWidth;
      else if (left < copyBStart) next = left + setWidth;
      if (next === left) return;
      jumping = true;
      // Disable snap during the jump so mandatory scroll-snap doesn't
      // try to re-snap to the position we just left.
      const prevSnap = el.style.scrollSnapType;
      el.style.scrollSnapType = 'none';
      el.scrollLeft = next;
      requestAnimationFrame(() => {
        el.style.scrollSnapType = prevSnap;
        jumping = false;
      });
    };

    const id = requestAnimationFrame(() => {
      if (!measure()) return;
      startAtZero();
      el.addEventListener('scroll', normalize, { passive: true });
    });

    const ro = new ResizeObserver(() => {
      if (measure()) normalize();
    });
    ro.observe(el);

    return () => {
      cancelAnimationFrame(id);
      el.removeEventListener('scroll', normalize);
      ro.disconnect();
    };
  }, [matches, N]);

  return (
    // Wrapper hosts the hover-only chevron hints (CSS pseudos). The
    // carousel itself has overflow-x scroll + a mask gradient, so the
    // hints can't live on it directly without scrolling away or fading
    // into the mask edges.
    <div className={s.wrap}>
      <div className={s.carousel} ref={ref}>
        <div className={s.track}>
          {Array.from({ length: COPIES }).flatMap((_, c) =>
            matches.map((p) => (
              <FigureCard
                key={`${c}-${p.id}`}
                p={p}
                scope={matches}
                hideTag={hideTags}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
