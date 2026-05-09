// Explorer — the /explorer/ page. A fullscreen globe that reuses the
// splash's mountGlobe() in fullscreen mode. The page is intentionally
// thin chrome: a back link to the splash and a small caption. The
// globe itself does all the talking.

import { useEffect, useRef } from 'react';
import s from './Explorer.module.css';
import { mountGlobe } from '../splash/Globe';
import '../splash/splash-globals.css';

export function Explorer(): JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    mountGlobe(el, { fullscreen: true })
      .then((c) => { if (cancelled) c(); else cleanup = c; })
      .catch(() => { /* non-fatal; the page just shows empty */ });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return (
    <div className={s.root}>
      <a className={s.back} href="/" aria-label="Back to home">← back</a>
      <div className={s.mount} ref={mountRef}>
        {/* Loading state — CSS 3D wireframe globe (meridians +
            parallels) spinning around a tilted polar axis.
            mountGlobe fades the WebGL canvas in over this once
            polygons paint, then strips it from the DOM, so no
            React state machine needed. */}
        <div className={s.loadingScene} aria-hidden="true">
          <div className={s.loadingGlobe}>
            <div className={s.meridian} />
            <div className={s.meridian} />
            <div className={s.meridian} />
            <div className={s.meridian} />
            <div className={s.meridian} />
            <div className={s.meridian} />
            <div className={`${s.parallel} ${s.parallelEq}`} />
            <div className={`${s.parallel} ${s.parallel30N}`} />
            <div className={`${s.parallel} ${s.parallel30S}`} />
            <div className={`${s.parallel} ${s.parallel60N}`} />
            <div className={`${s.parallel} ${s.parallel60S}`} />
          </div>
        </div>
        <span className={s.loadingLabel}>loading</span>
      </div>
      <p className={s.title}>
        Explorer
        <em>every country I've been to, the routes I took & some example photos for each.</em>
      </p>
    </div>
  );
}
