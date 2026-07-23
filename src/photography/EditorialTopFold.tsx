// EditorialTopFold — the page header above the chip row. One short
// Georgia italic intro that names the work and 3 hero categories
// inline. Hovering a hero category dims non-matching tiles in the
// masonry below (controlled via the lifted previewTheme state);
// tapping/clicking applies the matching category filter.
//
// The intro copy + hero categories are hardcoded on purpose: the copy
// is curator-final, and the heroes are the complete set of top-level
// categories in CATEGORY_TREE (there are exactly three). Keep this
// component shallow so copy edits stay obvious.

import { useMemo } from 'react';
import type { PhotographyManifest } from '../types';
import s from './EditorialTopFold.module.css';

interface EditorialTopFoldProps {
  manifest: PhotographyManifest;
  // Selected categories from Photography.tsx — used to render a hero
  // category as "active" when its top-level tag is in the chip selection.
  selectedCategories: Set<string>;
  onApplyCategory: (id: string) => void;
  // Controlled hover-preview state lifted to Photography.tsx so the
  // MasonryWall can dim non-matching tiles when a hero category is
  // hovered. Empty string = no preview active.
  previewTheme: string;
  onPreviewTheme: (theme: string) => void;
}

const INTRO_LEAD = "I shoot ";
// Split the trailing punctuation off so we can glue the period to the
// last hero button (via a nowrap span) — otherwise the browser breaks
// the line between "culture" and "." on narrow mobile widths.
const INTRO_AFTER = " Countless experiences, thousands held in a frame, hundreds to explore below.";

// All three top-level ids from CATEGORY_TREE, in reading order.
const HERO_CATEGORIES = ['wildlife', 'landscape', 'culture'] as const;

export function EditorialTopFold({
  manifest: _manifest,
  selectedCategories,
  onApplyCategory,
  previewTheme,
  onPreviewTheme,
}: EditorialTopFoldProps): JSX.Element {
  // Hover-to-preview is a desktop affordance only. Touch devices fire
  // mouseenter + focus on tap, which would briefly dim the wall before
  // the click actually applies the filter — a flicker the user reads
  // as broken. Skip all preview wiring on (hover: none) devices.
  // Memoized at mount; viewport rotation doesn't change pointer kind.
  const canHover = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(hover: hover)').matches,
    [],
  );
  const enter = (theme: string): void => onPreviewTheme(theme);
  const leave = (theme: string): void => {
    if (previewTheme === theme) onPreviewTheme('');
  };

  return (
    <div className={s.root}>
      <p className={s.intro}>
        {INTRO_LEAD}
        {HERO_CATEGORIES.map((theme, i) => {
          const active = selectedCategories.has(theme);
          const isLast = i === HERO_CATEGORIES.length - 1;
          // On hover-capable devices, mouseenter/leave + focus/blur
          // drive the preview dim. On touch devices, every handler
          // here is undefined so React doesn't even attach them — tap
          // → onClick only.
          const previewProps = canHover
            ? {
                onMouseEnter: () => enter(theme),
                onMouseLeave: () => leave(theme),
                onFocus: () => enter(theme),
                onBlur: () => leave(theme),
              }
            : undefined;
          const heroButton = (
            <button
              type="button"
              className={`${s.hero} ${active ? s.heroActive : ''}`}
              onClick={() => onApplyCategory(theme)}
              aria-pressed={active}
              {...previewProps}
            >
              {theme}
            </button>
          );
          return (
            <span key={theme}>
              {i > 0 && (isLast ? ', and ' : ', ')}
              {isLast ? (
                // Bind the trailing period to the last hero button so
                // the line never breaks between "culture" and ".".
                <span className={s.noWrap}>
                  {heroButton}.
                </span>
              ) : (
                heroButton
              )}
            </span>
          );
        })}
        {INTRO_AFTER}
      </p>
    </div>
  );
}
