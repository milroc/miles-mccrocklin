// BuilderFooter — where-to-next doors on the dark mat below the paper,
// so /builder/ no longer dead-ends at the 2010 education entry. Uses
// the splash door vocabulary (DESIGN.md "Door row"): compact rows with
// a tight 96×64 thumbnail, mono caps label, italic sublabel, and an
// always-visible mono CTA. Door copy + the photographer thumb come
// from the generated splash-content module (single source of truth:
// data/splash.json). The explorer door carries the live photo-textured
// globe (splash tile mode: tile topology + tile texture variants), with
// the WireGlobe as the pre-mount base state — but only after the
// window load event plus an idle slot, so the document, its images,
// and the carousels always win the bandwidth race. mountGlobe's own
// perf fallback keeps low-end devices on the wireframe.

import { useEffect, useRef } from 'react';
import { WireGlobe } from '../globe/WireGlobe';
import { DOORS, EXPLORER_DOOR } from '../generated/splash-content';
import { stripMd } from '../utils/markdown';
import s from './BuilderFooter.module.css';

interface BuilderFooterProps {
  email: string;
}

export function BuilderFooter({ email }: BuilderFooterProps): JSX.Element {
  const photographer = DOORS.find((d) => d.id === 'photographer');
  const emailLabel = stripMd(email);
  const globeMountRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    const mount = (): void => {
      const idle: (cb: () => void) => void =
        'requestIdleCallback' in window
          ? (cb) => window.requestIdleCallback(cb)
          : (cb) => window.setTimeout(cb, 250);
      idle(() => {
        const el = globeMountRef.current;
        if (cancelled || !el) return;
        import('../splash/Globe')
          .then(({ mountGlobe }) => mountGlobe(el))
          .then((c) => {
            if (cancelled) c();
            else cleanup = c;
          })
          .catch(() => { /* wireframe stays — same fallback as splash */ });
      });
    };
    if (document.readyState === 'complete') mount();
    else window.addEventListener('load', mount, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener('load', mount);
      cleanup?.();
    };
  }, []);
  return (
    <footer className={s.root}>
      {photographer && (
        <a className={s.door} href={photographer.href} aria-label={photographer.aria}>
          <img className={s.thumb} src={photographer.thumb} alt="" loading="lazy" />
          <span className={s.label}>{photographer.label}</span>
          <span className={s.sublabel}>{photographer.sublabel}</span>
          <span className={s.cta}>{photographer.cta}</span>
        </a>
      )}
      <a className={s.door} href={EXPLORER_DOOR.href} aria-label={EXPLORER_DOOR.aria}>
        <span className={s.globeTile}>
          <span className={s.globeBox}>
            <WireGlobe />
            <span className={s.globeMount} ref={globeMountRef} />
          </span>
        </span>
        <span className={s.label}>{EXPLORER_DOOR.label}</span>
        <span className={s.sublabel}>{EXPLORER_DOOR.sublabel}</span>
        <span className={s.cta}>{EXPLORER_DOOR.cta}</span>
      </a>
      <p className={s.hello}>
        or just say hello: <a href={`mailto:${emailLabel}`}>{emailLabel}</a>
      </p>
    </footer>
  );
}
