// Collapsible Airbnb testimonial block. Rendered inside the Real Estate
// sabbatical track. The `<details>` chrome is shared with AI experiments
// (see `.aiProjects` in Reviews.module.css) — Reviews adds the laurel-gold
// star + Bélo CTA on top.
import { useEffect, useRef, type MouseEvent } from 'react';
import { FaAirbnb } from 'react-icons/fa6';
import { ReviewCard } from './ReviewCard';
import { AIRBNB_LISTING_FALLBACK } from '../me';
import type { ReviewsData } from '../types';
import s from './Reviews.module.css';

interface ReviewsProps {
  data: ReviewsData & { listing_url?: string };
  max?: number;
}

const cleanLocation = (loc: string): string => {
  if (!loc) return '';
  const m = loc.match(/^Airbnb member\s+(.+)$/i);
  if (m) return `${m[1]} on Airbnb`;
  return loc;
};

const TRANSITION_MS = 240;
const TRANSITION_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

export function Reviews({ data, max = 4 }: ReviewsProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<Animation | null>(null);

  useEffect(() => {
    return () => {
      animRef.current?.cancel();
    };
  }, []);

  if (!data || !data.best_host_reviews) return null;
  const picks = data.best_host_reviews.slice(0, max);
  const listingHref = data.listing_url || AIRBNB_LISTING_FALLBACK;

  const reducedMotion = (): boolean =>
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const animateOpen = (): void => {
    const details = detailsRef.current;
    const content = contentRef.current;
    if (!details || !content) return;
    animRef.current?.cancel();
    details.open = true;
    if (reducedMotion()) return;
    requestAnimationFrame(() => {
      const targetHeight = content.scrollHeight;
      const anim = content.animate(
        [
          { height: '0px', opacity: 0 },
          { height: `${targetHeight}px`, opacity: 1 },
        ],
        { duration: TRANSITION_MS, easing: TRANSITION_EASING },
      );
      animRef.current = anim;
      anim.onfinish = (): void => {
        animRef.current = null;
      };
    });
  };

  const animateClose = (): void => {
    const details = detailsRef.current;
    const content = contentRef.current;
    if (!details || !content || !details.open) return;
    animRef.current?.cancel();
    if (reducedMotion()) {
      details.open = false;
      return;
    }
    const startHeight = content.getBoundingClientRect().height;
    const anim = content.animate(
      [
        { height: `${startHeight}px`, opacity: 1 },
        { height: '0px', opacity: 0 },
      ],
      { duration: TRANSITION_MS, easing: TRANSITION_EASING, fill: 'forwards' },
    );
    animRef.current = anim;
    anim.onfinish = (): void => {
      details.open = false;
      anim.cancel();
      animRef.current = null;
    };
  };

  const handleSummaryClick = (e: MouseEvent<HTMLElement>): void => {
    const details = detailsRef.current;
    if (!details) return;
    e.preventDefault();
    if (details.open) animateClose();
    else animateOpen();
  };

  return (
    <details ref={detailsRef} className={`${s.aiProjects} ${s.reviewsToggle}`}>
      <summary onClick={handleSummaryClick}>
        <span className={s.summaryLabel}>
          <FaAirbnb className={s.summaryBelo} aria-hidden="true" />
          <span className={s.star} aria-hidden="true">★</span>
          {data.overall_rating} · {data.total_reviews} guest reviews
        </span>
        <span className={s.summaryHint}>click to expand</span>
      </summary>
      <div ref={contentRef} className={s.reviewsAnim}>
        <section className={`${s.reviews} ${s.compact}`}>
          <div className={s.cards}>
            {picks.map((r, i) => (
              <ReviewCard
                key={i}
                r={r}
                cleanLocation={cleanLocation}
              />
            ))}
          </div>
          <div className={s.outro}>
            <div className={s.outroLeft}>
              <a
                className={s.link}
                href={listingHref}
                target="_blank"
                rel="noreferrer"
                aria-label={`See all ${data.total_reviews} reviews on Airbnb`}
                title={`See all ${data.total_reviews} reviews on Airbnb`}
              >
                <FaAirbnb className={s.belo} aria-hidden="true" />
              </a>
              <span className={s.outroRating}>
                <span className={s.outroStar} aria-hidden="true">★</span>
                {data.overall_rating} · {data.total_reviews} reviews
              </span>
            </div>
            <button
              type="button"
              className={s.collapseBtn}
              onClick={animateClose}
            >
              click to collapse
            </button>
          </div>
        </section>
      </div>
    </details>
  );
}
