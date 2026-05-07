// Masonry — justified-rows image grid that fills its container in both
// width and height. Drops trailing items that don't fit so the
// remaining set tiles cleanly; native aspects preserved (no crop, no
// distortion).
//
// Initial aspects come from each item's optional `aspect` field
// (estimates) so first paint can lay something out before image
// network requests resolve. As each image loads, its real aspect from
// `naturalWidth/naturalHeight` replaces the estimate and the layout
// recomputes — eliminating the crop/clip artifacts that come from
// estimate-vs-real mismatch.

import { useEffect, useMemo, useRef, useState } from 'react';
import { computeJustifiedLayout, DEFAULT_SIZE_PROFILE } from './justified-layout';
import s from './Masonry.module.css';

export interface MasonryItem {
  src: string;
  alt: string;
  /**
   * Optional aspect ratio estimate (width / height). If missing or
   * stale, the real aspect is measured on image load and the layout
   * recomputes. Providing a good estimate avoids the brief
   * estimate-based first paint.
   */
  aspect?: number;
}

interface MasonryProps {
  items: ReadonlyArray<MasonryItem>;
  /**
   * Per-row height multipliers. Earlier rows get larger multipliers
   * so leading items render bigger. Pass `[1]` for uniform row
   * heights. Default = `DEFAULT_SIZE_PROFILE` (gentle decay so the
   * first row dominates, subsequent rows step down).
   *
   * Declare this constant at module level if you override — passing
   * an inline `[...]` literal each render breaks the useMemo cache
   * and forces the layout to recompute on every render.
   */
  sizeProfile?: ReadonlyArray<number>;
  /**
   * Optional className applied to the outer container. Use to layer
   * additional styling (background, border, etc) without touching
   * this module's structural rules.
   */
  className?: string;
  /**
   * Optional className applied to each rendered image. Use to layer
   * styling (e.g. parent-driven hover filters, transitions) without
   * touching the inline positioning.
   */
  imageClassName?: string;
}

const FALLBACK_ASPECT = 1;

export function Masonry({
  items,
  sizeProfile = DEFAULT_SIZE_PROFILE,
  className,
  imageClassName,
}: MasonryProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [aspects, setAspects] = useState<number[]>(() =>
    items.map((it) => it.aspect ?? FALLBACK_ASPECT),
  );

  // Re-seed aspects when the items prop changes (length or src list).
  // Skip the seed when the list is the same — would clobber measured
  // aspects with estimates on every render.
  useEffect(() => {
    setAspects((prev) => {
      if (prev.length === items.length) {
        // Same length — keep measured values, only fill in any
        // newly-missing ones from new estimates.
        return prev;
      }
      return items.map((it) => it.aspect ?? FALLBACK_ASPECT);
    });
  }, [items]);

  // Track container size — initial measurement + resize. ResizeObserver
  // can fire many times per layout step during a drag, and each fire
  // triggers `computeJustifiedLayout` over every item. Coalesce all
  // observations within one animation frame so the layout recomputes at
  // most once per paint, with the latest contentRect winning.
  //
  // Width-gated: skip the setState when only height changed. iOS Safari's
  // URL-bar show/hide, late image loads, and content reflow blip the
  // container's height by a few px without changing the column width —
  // and every blip used to re-justify the rows, producing a visible
  // mobile "shuffle." Width is what justified-layout actually needs to
  // re-pack; height changes get picked up implicitly the next time width
  // changes (e.g. real rotation, breakpoint flip).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setSize({ w: rect.width, h: rect.height });
    let lastW = rect.width;

    let rafId: number | null = null;
    let pending: { w: number; h: number } | null = null;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      pending = { w: entry.contentRect.width, h: entry.contentRect.height };
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (!pending) return;
        if (Math.abs(pending.w - lastW) < 0.5) return;
        lastW = pending.w;
        setSize(pending);
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  // Preload every image and replace its estimated aspect with the
  // real one as it resolves. After this completes, layout cells match
  // image native aspects exactly — `object-fit: contain` becomes a
  // no-op (no letterbox, no crop).
  useEffect(() => {
    let cancelled = false;
    items.forEach((item, idx) => {
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        if (img.naturalWidth === 0 || img.naturalHeight === 0) return;
        const real = img.naturalWidth / img.naturalHeight;
        setAspects((prev) => {
          const current = prev[idx];
          if (current !== undefined && Math.abs(current - real) < 0.005) return prev;
          const next = prev.slice();
          next[idx] = real;
          return next;
        });
      };
      img.src = item.src;
    });
    return () => {
      cancelled = true;
    };
  }, [items]);

  const layout = useMemo(
    () => computeJustifiedLayout(aspects, size.w, size.h, sizeProfile),
    [aspects, size.w, size.h, sizeProfile],
  );

  const rootClass = className ? `${s.root} ${className}` : s.root;
  const imgClass = imageClassName ? `${s.image} ${imageClassName}` : s.image;

  return (
    <div className={rootClass} ref={containerRef}>
      {items.map((item, i) => {
        const pos = layout.positions[i];
        if (!pos || !pos.visible) return null;
        return (
          <img
            key={item.src}
            className={imgClass}
            src={item.src}
            alt={item.alt}
            loading="eager"
            decoding="async"
            data-masonry-image="true"
            style={{
              left: pos.x,
              top: pos.y,
              width: pos.w,
              height: pos.h,
            }}
          />
        );
      })}
    </div>
  );
}
