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
import { SiteNav } from '../layout/SiteNav';
import { CountryPanel } from './CountryPanel';
import { LoadingGlobe } from './LoadingGlobe';
import { Toolbar } from './Toolbar';
import { VISITED_COUNTRY_COUNT, CONTINENT_COUNT } from '../generated/splash-content';

// Idle delay (ms) before the SiteNav fades out. Matches the
// MediaProvider lightbox chrome-hide cadence so the globe and the
// lightbox share one motion vocabulary.
const NAV_IDLE_MS = 3000;

export function Explorer(): JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<GlobeControls | null>(null);
  const [selected, setSelected] = useState<CountrySelection | null>(null);
  // User-level rotation toggle, separate from the click/drag idle pause.
  // When false, rotation stays off until the user re-enables it via the
  // toolbar button — clicks and drags will pause but never resume.
  const [rotationOn, setRotationOn] = useState(true);
  // SiteNav idle-hide. Nav fades after NAV_IDLE_MS of cursor + keyboard
  // stillness, comes back on any movement. Always visible while the
  // CountryPanel is open (so the visitor doesn't lose nav while reading)
  // and on initial paint (so the visitor sees the nav at least once).
  const [navVisible, setNavVisible] = useState(true);
  const navIdleTimerRef = useRef<number | null>(null);

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

  // Idle-hide for the SiteNav overlay. Any cursor or keyboard activity
  // brings the nav back and re-arms a NAV_IDLE_MS countdown to hide it
  // again. The CountryPanel-open path bypasses the timer (see below)
  // so the visitor doesn't lose nav while reading a country detail.
  useEffect(() => {
    if (selected) {
      // Country panel open — show nav unconditionally, no hide timer.
      setNavVisible(true);
      if (navIdleTimerRef.current != null) {
        window.clearTimeout(navIdleTimerRef.current);
        navIdleTimerRef.current = null;
      }
      return;
    }
    const arm = (): void => {
      if (navIdleTimerRef.current != null) {
        window.clearTimeout(navIdleTimerRef.current);
      }
      navIdleTimerRef.current = window.setTimeout(() => {
        setNavVisible(false);
      }, NAV_IDLE_MS);
    };
    const onActivity = (): void => {
      setNavVisible(true);
      arm();
    };
    window.addEventListener('mousemove', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity);
    window.addEventListener('touchstart', onActivity, { passive: true });
    arm();
    return () => {
      window.removeEventListener('mousemove', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('touchstart', onActivity);
      if (navIdleTimerRef.current != null) {
        window.clearTimeout(navIdleTimerRef.current);
        navIdleTimerRef.current = null;
      }
    };
  }, [selected]);

  return (
    <div className={s.root}>
      {/* Top nav floats over the globe in a frosted plate so the brand
          + pillar links stay readable when a bright photo polygon
          drifts under them. Same treatment as the bottom title plate
          and the Toolbar buttons. */}
      <div
        className={`${s.siteNavOverlay} ${navVisible ? '' : s.siteNavOverlayHidden}`}
        aria-hidden={!navVisible}
      >
        <SiteNav current="explorer" />
      </div>
      <Toolbar
        rotationOn={rotationOn}
        onToggleRotation={toggleRotation}
        visible={navVisible}
      />
      <div className={s.mount} ref={mountRef}>
        {/* Loading state — CSS 3D wireframe globe. mountGlobe fades
            the WebGL canvas in over this once polygons paint, then
            strips it from the DOM, so no React state machine needed. */}
        <LoadingGlobe />
      </div>
      {/* Title plate joins the same idle-hide as the nav and toolbar so
          an untouched globe spins with zero chrome. Counts share the
          splash placard's derivation (generated module) so the two
          surfaces can't drift. */}
      <p
        className={`${s.title} ${navVisible ? '' : s.titleHidden}`}
        aria-hidden={!navVisible}
      >
        Explorer · {VISITED_COUNTRY_COUNT} countries · {CONTINENT_COUNT} continents
        <em>every country I've been to, the routes I took & some example photos for each.</em>
      </p>
      {selected ? <CountryPanel selection={selected} onClose={closeModal} /> : null}
    </div>
  );
}
