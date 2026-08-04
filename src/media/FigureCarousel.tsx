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

// When the user clicks a card whose center sits this close (or closer) to
// the viewport edge — measured as a fraction of the viewport width —
// treat the click as "advance the strip" instead of "open the lightbox".
// 0.18 ≈ the leftmost / rightmost partially-clipped card under the
// edge mask, without catching the next-in card whose center is well
// inside the visible area.
const EDGE_RATIO = 0.18;

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
    // Wall-clock until which normalize() is paused. Set when a click on
    // an edge card kicks off a smooth-scroll-to-center. The 3-copy track
    // can absorb scrollLeft drifting outside [copyBStart, copyCStart) for
    // the duration of one animation without any visual discontinuity —
    // pausing normalize prevents its synchronous scrollLeft reassignment
    // from interrupting the in-flight smooth scroll.
    let smoothUntil = 0;

    const measure = (): boolean => {
      const cards = el.querySelectorAll<HTMLElement>('[data-figure-card]');
      if (cards.length < N * COPIES) return false;
      const a = cards[0].offsetLeft;
      copyBStart = cards[N].offsetLeft;
      copyCStart = cards[2 * N].offsetLeft;
      setWidth = copyBStart - a;
      return setWidth > 0;
    };

    const startAtZero = () => {
      const cards = el.querySelectorAll<HTMLElement>('[data-figure-card]');
      // First card of the middle (B) copy = item 0 in the data array.
      // Array order is the priority, so the lead photo is what the user
      // sees first; subsequent items extend right.
      const card = cards[N];
      if (!card) return;
      el.scrollLeft = card.offsetLeft;
    };

    // Tag cards whose center sits inside the masked edge zone with
    // `data-edge="true"`. Edge cards advance the strip on click instead
    // of opening the lightbox — so the hover-zoom (which signals "click
    // to open") is suppressed on them via CSS keyed off this attribute.
    let edgeFrame = 0;
    const classifyEdges = () => {
      const cards = el.querySelectorAll<HTMLElement>('[data-figure-card]');
      const elRect = el.getBoundingClientRect();
      cards.forEach((card) => {
        const cardRect = card.getBoundingClientRect();
        const cardCenter = cardRect.left + cardRect.width / 2;
        const fromLeft = (cardCenter - elRect.left) / elRect.width;
        const fromRight = 1 - fromLeft;
        const onEdge = fromLeft < EDGE_RATIO || fromRight < EDGE_RATIO;
        if (onEdge) card.setAttribute('data-edge', 'true');
        else card.removeAttribute('data-edge');
      });
    };
    const scheduleClassifyEdges = () => {
      if (edgeFrame) return;
      edgeFrame = requestAnimationFrame(() => {
        edgeFrame = 0;
        classifyEdges();
      });
    };

    const normalize = () => {
      if (jumping || !setWidth) {
        scheduleClassifyEdges();
        return;
      }
      // Don't fight an in-flight smooth scroll: the synchronous
      // scrollLeft reassignment below would cancel the animation and
      // leave the clicked card off-center.
      if (performance.now() < smoothUntil) {
        scheduleClassifyEdges();
        return;
      }
      const left = el.scrollLeft;
      let next = left;
      if (left >= copyCStart) next = left - setWidth;
      else if (left < copyBStart) next = left + setWidth;
      if (next === left) {
        scheduleClassifyEdges();
        return;
      }
      jumping = true;
      // Disable snap during the jump so mandatory scroll-snap doesn't
      // try to re-snap to the position we just left.
      const prevSnap = el.style.scrollSnapType;
      el.style.scrollSnapType = 'none';
      el.scrollLeft = next;
      requestAnimationFrame(() => {
        el.style.scrollSnapType = prevSnap;
        jumping = false;
        classifyEdges();
      });
    };

    // Capture-phase click: when the user clicks a figure-card whose
    // center sits inside the masked edge zone, intercept the event before
    // FigureCard's onClick fires and scroll the clicked card into the
    // center of the viewport instead of opening the lightbox. Cards in
    // the visible interior pass through to their default behavior.
    const SMOOTH_MS = 700;
    let smoothEndTimer: ReturnType<typeof setTimeout> | null = null;
    const onClickCapture = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const card = target?.closest('[data-figure-card]') as HTMLElement | null;
      if (!card || !el.contains(card)) return;
      const elRect = el.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const cardCenter = cardRect.left + cardRect.width / 2;
      const fromLeft = (cardCenter - elRect.left) / elRect.width;
      const fromRight = 1 - fromLeft;
      const onEdge = fromLeft < EDGE_RATIO || fromRight < EDGE_RATIO;
      if (!onEdge) return;
      e.preventDefault();
      e.stopPropagation();
      // Compute the scrollLeft that centers the clicked card. cardRect is
      // viewport-relative, so we add the carousel's current scrollLeft to
      // get the card's position inside the scrollable content, then back
      // off by half the leftover space so the card lands centered. The
      // target may sit outside [copyBStart, copyCStart); the 3-copy track
      // makes that visually invisible, and normalize() is paused via
      // `smoothUntil` so it doesn't interrupt the animation.
      const cardLeftInContent = cardRect.left - elRect.left + el.scrollLeft;
      const targetScrollLeft = cardLeftInContent - (el.clientWidth - cardRect.width) / 2;
      smoothUntil = performance.now() + SMOOTH_MS;
      el.scrollTo({ left: targetScrollLeft, behavior: 'smooth' });
      // After the smooth scroll settles, manually normalize scrollLeft
      // back into the safe window so subsequent loops keep working.
      // Using a timer (not scrollend) because scrollend support is
      // uneven and a small fixed budget is plenty for this animation.
      if (smoothEndTimer) clearTimeout(smoothEndTimer);
      smoothEndTimer = setTimeout(() => {
        smoothEndTimer = null;
        smoothUntil = 0;
        const left = el.scrollLeft;
        if (left >= copyCStart || left < copyBStart) {
          jumping = true;
          const prevSnap = el.style.scrollSnapType;
          el.style.scrollSnapType = 'none';
          el.scrollLeft = left >= copyCStart ? left - setWidth : left + setWidth;
          requestAnimationFrame(() => {
            el.style.scrollSnapType = prevSnap;
            jumping = false;
            classifyEdges();
          });
        } else {
          classifyEdges();
        }
      }, SMOOTH_MS);
    };

    const id = requestAnimationFrame(() => {
      if (!measure()) return;
      startAtZero();
      classifyEdges();
      el.addEventListener('scroll', normalize, { passive: true });
    });

    el.addEventListener('click', onClickCapture, true);

    const ro = new ResizeObserver(() => {
      if (measure()) {
        normalize();
        classifyEdges();
      }
    });
    ro.observe(el);

    return () => {
      cancelAnimationFrame(id);
      if (edgeFrame) cancelAnimationFrame(edgeFrame);
      if (smoothEndTimer) clearTimeout(smoothEndTimer);
      el.removeEventListener('scroll', normalize);
      el.removeEventListener('click', onClickCapture, true);
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
            // Copy 1 (the middle copy the strip anchors on) is the
            // primary; the flanking loop clones are decorative so
            // keyboard/AT users traverse each card exactly once.
            matches.map((p) => (
              <FigureCard
                key={`${c}-${p.id}`}
                p={p}
                scope={matches}
                hideTag={hideTags}
                decorative={c !== 1}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
