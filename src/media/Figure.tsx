// Inline figure container. Picks one of: stack (marginalia float), justified
// strip, equal-column grid, full-width carousel. On mobile, strip layouts
// with portrait screenshots split into a phone-gallery row so screenshots
// keep their natural aspect inside a phone-bezel frame.
import type { ReactNode } from 'react';
import { FigureCard } from './FigureCard';
import { FigureCarousel } from './FigureCarousel';
import { useMediaQuery } from '../utils/hooks';
import type { MediaGroup, MediaItem } from '../types';
import s from './Figure.module.css';

interface FigureProps {
  media?: MediaGroup;
}

function renderItems(items: MediaItem[], scope: MediaItem[]): ReactNode {
  return items.map((p) => <FigureCard key={p.id} p={p} scope={scope} />);
}

export function Figure({ media }: FigureProps) {
  // Class lookups live inside the component so the CSS-module import is
  // resolved by the time we read from it (Bun --hot evaluates module-level
  // initializers before the import wiring is complete).
  const sizeClass = (size: 'sm' | 'md' | 'lg'): string =>
    size === 'sm' ? s.sm! : size === 'lg' ? s.lg! : s.md!;
  const nClass = (n: number): string => {
    const map: Record<number, string | undefined> = {
      1: s.n1, 2: s.n2, 3: s.n3, 4: s.n4, 5: s.n5, 6: s.n6,
    };
    return map[n] ?? '';
  };
  // 720px matches the desktop/tablet boundary used elsewhere (figure-grid,
  // lightbox peek mode). On mobile we split portraits into a phone-gallery
  // row; on desktop the justified strip handles mixed aspects fine.
  const isMobile = useMediaQuery('(max-width: 720px)');
  if (!media || !media.items.length) return null;
  const items = media.items;
  const layout = media.layout;
  const align = media.align ?? 'right';
  const size = media.size ?? 'md';

  if (layout === 'carousel') {
    return <FigureCarousel matches={items} />;
  }

  // Phone-row split (mobile only): when a strip layout has portrait-aspect
  // items (mobile screenshots, < 1:1), pull them into their own horizontal
  // scroll-snap row with phone-bezel framing, and let landscape items
  // render in the standard strip below.
  if (layout === 'strip' && isMobile) {
    const portraits = items.filter((p) => (p.aspect ?? 1) < 1);
    const landscapes = items.filter((p) => (p.aspect ?? 1) >= 1);
    if (portraits.length > 0) {
      return (
        <>
          <div className={`${s.figure} ${s.phones} ${nClass(portraits.length)}`}>
            {renderItems(portraits, portraits)}
          </div>
          {landscapes.length > 0 && (
            <div className={`${s.figure} ${s.strip} ${nClass(landscapes.length)}`}>
              {renderItems(landscapes, landscapes)}
            </div>
          )}
        </>
      );
    }
  }

  const allEmbed = items.every((p) => p.type === 'embed');
  let cls: string;
  if (layout === 'strip') {
    cls = `${s.figure} ${s.strip} ${nClass(items.length)}${allEmbed ? ` ${s.embeds}` : ''}`;
  } else if (layout === 'grid') {
    cls = `${s.figure} ${s.grid} ${nClass(items.length)}`;
  } else {
    const alignClass = align === 'left' ? s.left : s.right;
    cls = `${s.figure} ${alignClass} ${sizeClass(size)} ${nClass(items.length)}`;
  }

  return (
    <div className={cls}>
      {renderItems(items, items)}
    </div>
  );
}
