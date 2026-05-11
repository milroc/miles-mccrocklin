// Explorer — the /explorer/ page. A fullscreen globe that reuses the
// splash's mountGlobe() in fullscreen mode. The page is intentionally
// thin chrome: a back link to the splash and a small caption. The
// globe itself does all the talking.

import { useCallback, useEffect, useRef, useState } from 'react';
import s from './Explorer.module.css';
import {
  mountGlobe,
  type CountrySelection,
  type GlobeControls,
} from '../splash/Globe';
import '../splash/splash-globals.css';
import { CountryPanel } from './CountryPanel';
import { LoadingGlobe } from './LoadingGlobe';
import { Toolbar } from './Toolbar';

export function Explorer(): JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<GlobeControls | null>(null);
  const [selected, setSelected] = useState<CountrySelection | null>(null);
  // User-level rotation toggle, separate from the click/drag idle pause.
  // When false, rotation stays off until the user re-enables it via the
  // toolbar button — clicks and drags will pause but never resume.
  const [rotationOn, setRotationOn] = useState(true);

  const closeModal = useCallback(() => {
    setSelected(null);
    // Start the 5s "resume rotate" timer from dismiss, matching the
    // pan/zoom behavior wired inside mountGlobe.
    controlsRef.current?.kickIdleTimer();
  }, []);

  const toggleRotation = useCallback(() => {
    setRotationOn((on) => !on);
  }, []);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    let cleanup: (() => void) | null = null;
    let cancelled = false;
    mountGlobe(el, {
      fullscreen: true,
      onCountryClick: (selection) => {
        setSelected(selection);
      },
      onReady: (controls) => {
        controlsRef.current = controls;
      },
    })
      .then((c) => { if (cancelled) c(); else cleanup = c; })
      .catch(() => { /* non-fatal; the page just shows empty */ });
    return () => {
      cancelled = true;
      controlsRef.current = null;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, closeModal]);

  useEffect(() => {
    controlsRef.current?.setSelectedCountry(selected?.name ?? null);
  }, [selected]);

  useEffect(() => {
    controlsRef.current?.setRotationLocked(!rotationOn);
  }, [rotationOn]);

  return (
    <div className={s.root}>
      <Toolbar rotationOn={rotationOn} onToggleRotation={toggleRotation} />
      <div className={s.mount} ref={mountRef}>
        {/* Loading state — CSS 3D wireframe globe. mountGlobe fades
            the WebGL canvas in over this once polygons paint, then
            strips it from the DOM, so no React state machine needed. */}
        <LoadingGlobe />
      </div>
      <p className={s.title}>
        Explorer
        <em>every country I've been to, the routes I took & some example photos for each.</em>
      </p>
      {selected ? <CountryPanel selection={selected} onClose={closeModal} /> : null}
    </div>
  );
}
