// Photography masonry wall. Reads filtered photos from the parent
// (Photography.tsx owns the chip filter state), packs them with the
// Flickr-justified algorithm, and renders each tile with the existing
// DESIGN.md photography filter (grayscale at rest, snap to color on
// hover). Clicking a tile opens the MediaProvider lightbox.
//
// Re-measures container width on resize. Uses ResizeObserver instead of
// window resize so a CSS-driven layout shift (sidebar open, devtools
// dock change, font swap) also triggers re-packing.
//
// Filter transitions: full-wall fade out → swap → fade in. When the
// filtered photo set changes, the wall fades to opacity 0 over
// FADE_MS, the displayed photo list is then swapped in place, and the
// wall fades back to 1. No per-tile choreography — simpler than a
// sort animation and avoids object-constancy edge cases on mobile.
// Respects prefers-reduced-motion: skips the fade.

import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { MediaCtx, prefersReducedMotion } from '../utils/media';
import { layoutMasonry, type LayoutRow } from '../utils/masonry-layout';
import type { MediaItem, PhotographyEntry } from '../types';
import { buildCategoryDescendants } from './categories';
import s from './MasonryWall.module.css';

// Top-level → descendant ids, built once. Hovering "Wildlife" in the
// hero highlights any tile tagged with a wildlife sub-cat too, even
// when the classifier didn't emit the parent on that photo.
const CATEGORY_DESCENDANTS = buildCategoryDescendants();

interface MasonryWallProps {
  photos: PhotographyEntry[];
  // When non-empty, tiles whose `theme` list doesn't include this value
  // render dimmed (opacity + desaturate). Driven by the
  // EditorialTopFold hero-category hover, so the user gets a live "what
  // would 'wildlife' filter look like" preview without committing to
  // the filter. Empty string = no dim.
  previewTheme?: string;
}

// Curator review mode: when the page URL has ?meta=1, every tile renders
// a panel below it with the classifier output (themes / entities /
// species / story / caption / alt / country) plus the raw JSON. Lets
// the curator eyeball the auto-tagging without leaving the page.
function metaModeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URL(window.location.href).searchParams.get('meta') === '1';
}

// Convert a manifest entry into a MediaItem for the lightbox. Skip
// the graphic flag for photos the viewer has already revealed in the
// masonry so the lightbox doesn't re-gate something they've already
// opted to see this session.
function toMediaItem(p: PhotographyEntry, revealed: Set<string>): MediaItem {
  return {
    id: p.id,
    type: 'image',
    // Lightbox loads the full variant when present, else the original.
    src: p.src_full ?? p.src,
    caption: p.caption,
    alt: p.alt ?? p.caption,
    aspect: p.aspect,
    album_url: p.album_url,
    graphic: p.graphic && !revealed.has(p.id),
    prose_provenance: p.prose_provenance,
  };
}

// Per-viewport target row height. Sized so the wall reads as a
// gallery — large enough that individual frames feel substantive
// rather than thumbnailed, but small enough that 2–3 photos still
// share each row on desktop.
function targetRowHeight(width: number): number {
  if (width < 480)  return 300;
  if (width < 768)  return 360;
  if (width < 1024) return 420;
  if (width < 1440) return 480;
  return 540;
}

function tileSrcset(p: PhotographyEntry): string | undefined {
  const tile = p.src_tile;
  const medium = p.src_medium;
  const full = p.src_full;
  if (!tile) return undefined;
  // Include the 1280w `full` variant so retina + large rows on wide
  // viewports don't fall back to upscaled medium.
  const parts = [`/${tile} 480w`];
  if (medium) parts.push(`/${medium} 960w`);
  if (full) parts.push(`/${full} 1280w`);
  return parts.join(', ');
}

// Duration of one half of the fade cycle (fade out OR fade in). Total
// time the user perceives is ~2x this. 160ms feels snappy without
// erasing the cue that something just changed.
const FADE_MS = 160;

export function MasonryWall({
  photos,
  previewTheme,
}: MasonryWallProps): JSX.Element {
  // Expand the hovered hero category to include its sub-cats, so any
  // tile tagged with a descendant counts as "matching" the preview.
  const previewMatch = previewTheme
    ? (CATEGORY_DESCENDANTS.get(previewTheme) ?? new Set([previewTheme]))
    : null;
  const { open } = useContext(MediaCtx);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  // Per-session set of graphic-content photo IDs the user has
  // explicitly chosen to unblur. Kept in component state (not
  // persisted) so a fresh page load re-gates them — matches the
  // conservative default.
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const [showMeta] = useState<boolean>(() => metaModeEnabled());

  // Two-phase fade-cycle state:
  //   displayed = the photo list currently shown in the DOM.
  //   fading    = true while opacity is mid-transition to 0.
  // When `photos` (the incoming prop) differs from `displayed` by id
  // list, we flip `fading=true` to start the fade-out, then after
  // FADE_MS we replace `displayed` with the new list and flip `fading`
  // back to false to fade back in.
  const [displayed, setDisplayed] = useState<PhotographyEntry[]>(photos);
  const [fading, setFading] = useState(false);

  // Measure container width on mount and on resize.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Drive the fade cycle when the filtered photo set changes.
  useEffect(() => {
    const newSig = photos.map((p) => p.id).join(',');
    const oldSig = displayed.map((p) => p.id).join(',');
    if (newSig === oldSig) return;
    // Reduced-motion: snap to new list without any fade.
    if (typeof window !== 'undefined' && prefersReducedMotion()) {
      setDisplayed(photos);
      return;
    }
    setFading(true);
    const t = setTimeout(() => {
      setDisplayed(photos);
      setFading(false);
    }, FADE_MS);
    return () => clearTimeout(t);
  }, [photos, displayed]);

  const rows: LayoutRow<PhotographyEntry>[] = width
    ? layoutMasonry(displayed, {
        containerWidth: width,
        targetRowHeight: targetRowHeight(width),
        gap: 8,
      })
    : [];

  // Empty state if there are no displayed photos AND we're not mid-fade.
  // During a fade-out toward an empty result, displayed is still the
  // old (non-empty) list — we want to keep rendering those tiles while
  // they fade out rather than snap to the empty message.
  if (displayed.length === 0) {
    // Empty filter state. The "Clear filters →" link is owned by
    // ChipRow (which has the state), so this component just announces
    // the empty result. Photography.tsx handles the actual chip clear.
    return (
      <div className={s.root} ref={containerRef}>
        <p className={s.empty}>No photos match these filters.</p>
      </div>
    );
  }

  // Scope for the lightbox: every photo in the current displayed set,
  // in render order. Clicking any tile opens the lightbox into that
  // scope.
  const lightboxScope: MediaItem[] = displayed.map((p) => toMediaItem(p, revealed));

  // Right-click + drag are blocked at the root level — single handler
  // covers every tile and the row gaps. Determined visitors can still
  // grab images via DevTools or a screenshot; this only raises the bar
  // against casual save-as / drag-to-desktop.
  const blockContext = (e: ReactMouseEvent): void => e.preventDefault();
  const blockDrag = (e: ReactDragEvent): void => e.preventDefault();

  return (
    <div
      className={s.root}
      ref={containerRef}
      onContextMenu={blockContext}
      onDragStart={blockDrag}
      style={{
        opacity: fading ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
      }}
    >
      {rows.map((row, ri) => (
        <div
          className={s.row}
          key={ri}
          style={
            showMeta
              ? { height: 'auto', alignItems: 'flex-start' }
              : { height: `${row.height}px` }
          }
        >
          {row.cells.map((cell) => {
            const p = cell.item;
            const isGated = !!p.graphic && !revealed.has(p.id);
            // Hero-category hover preview: tiles whose theme list
            // doesn't include the previewed category render dimmed so
            // the matching tiles stand out. No-op when previewTheme is
            // empty (the common case).
            const isDimmed =
              !!previewMatch && !(p.theme ?? []).some((t) => previewMatch.has(t));
            return (
              <div
                key={p.id}
                className={s.tileWrap}
                style={{
                  width: `${cell.width}px`,
                  ...(showMeta && { height: 'auto' }),
                }}
              >
                <button
                  type="button"
                  className={`${s.tile} ${isGated ? s.tileGated : ''} ${isDimmed ? s.tileDimmed : ''}`}
                  style={showMeta ? { height: `${row.height}px` } : undefined}
                  onClick={() => {
                    if (isGated) return;
                    open(lightboxScope, p.id);
                  }}
                  aria-label={p.alt ?? p.caption ?? 'Photo'}
                  aria-hidden={isGated || undefined}
                  tabIndex={isGated ? -1 : 0}
                >
                  <img
                    src={`/${p.src_tile ?? p.src}`}
                    srcSet={tileSrcset(p)}
                    sizes={`${Math.round(cell.width)}px`}
                    alt={p.alt ?? p.caption ?? ''}
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                  />
                </button>
                {isGated && (
                  <button
                    type="button"
                    className={s.graphicOverlay}
                    onClick={() => {
                      setRevealed((cur) => {
                        const next = new Set(cur);
                        next.add(p.id);
                        return next;
                      });
                    }}
                    aria-label="Reveal graphic content"
                  >
                    <span className={s.graphicBadge}>Graphic content</span>
                    <span className={s.graphicHint}>Tap to reveal</span>
                  </button>
                )}
                {showMeta && <MetaPanel photo={p} />}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function MetaPanel({ photo }: { photo: PhotographyEntry }): JSX.Element {
  // Pull a curator-friendly view out of the entry. Story renders on top
  // as italic prose, then the tag/entity lines, then the raw JSON
  // dump for anything else (album_url, featured, graphic, aspect, etc.).
  const tags = (photo.theme ?? []).join(' · ');
  const entities = (photo.entities ?? []).join(' · ');
  return (
    <div className={s.metaPanel}>
      {photo.story && <p className={s.metaStory}>{photo.story}</p>}
      {photo.caption && (
        <p className={s.metaTags}>
          <span className={s.metaLabel}>caption</span>
          {photo.caption}
        </p>
      )}
      {tags && (
        <p className={s.metaTags}>
          <span className={s.metaLabel}>themes</span>
          {tags}
        </p>
      )}
      {entities && (
        <p className={s.metaTags}>
          <span className={s.metaLabel}>entities</span>
          {entities}
        </p>
      )}
      {photo.species && (
        <p className={s.metaTags}>
          <span className={s.metaLabel}>species</span>
          {photo.species}
        </p>
      )}
      {photo.country && (
        <p className={s.metaTags}>
          <span className={s.metaLabel}>country</span>
          {photo.country}
        </p>
      )}
      <pre>{JSON.stringify(photo, null, 2)}</pre>
    </div>
  );
}
