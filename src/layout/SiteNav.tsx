// SiteNav — shared top navigation for canvas-context pages (sit on the
// dark mat, not the cream paper). Used by /photography today; /explorer
// and any future canvas surface should adopt the same component for one
// consistent cross-surface nav.
//
// Three-pillar labels match the splash tile labels (BUILDER /
// PHOTOGRAPHER / EXPLORER) so the visual identity stays continuous from
// the splash entry through any pillar page.
//
// Brand is the favicon (cream "M" on dark mat — see favicon.svg) plus
// the spelled-out name. The favicon and the canvas share the same
// #1c1f1a background, so the M reads as floating on the page rather
// than enclosed in a chip.
//
// Long-form has its own document-context header (src/layout/Header.tsx)
// with the full Georgia display-name treatment and contact stack. This
// component is intentionally lighter — chrome, not document.

import s from './SiteNav.module.css';

type SitePillar = 'builder' | 'photographer' | 'explorer';

interface SiteNavProps {
  current: SitePillar;
}

const PILLARS: ReadonlyArray<{
  id: SitePillar;
  href: string;
  label: string;
}> = [
  { id: 'builder',      href: '/builder/',      label: 'builder' },
  { id: 'photographer', href: '/photographer/', label: 'photographer' },
  { id: 'explorer',     href: '/explorer/',     label: 'explorer' },
];

export function SiteNav({ current }: SiteNavProps): JSX.Element {
  return (
    <header className={s.nav}>
      <a className={s.brand} href="/" aria-label="Miles McCrocklin — home">
        <img
          src="/favicon.svg"
          alt=""
          aria-hidden="true"
          className={s.brandIcon}
          draggable={false}
        />
        <span className={s.brandName}>Miles McCrocklin</span>
      </a>
      <nav className={s.links} aria-label="Site sections">
        {PILLARS.map((p) =>
          p.id === current ? (
            <span key={p.id} className={s.current} aria-current="page">
              {p.label}
            </span>
          ) : (
            <a key={p.id} href={p.href}>
              {p.label}
            </a>
          ),
        )}
      </nav>
    </header>
  );
}
