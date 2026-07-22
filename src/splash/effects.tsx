// Splash effects — the post-mount "show" layer.
//
// Splash.tsx renders the chrome with the .revealing class hiding the
// header, hero, doors, and socials. This module:
//
//   1. Removes .revealing so the chrome fades in via the CSS
//      transitions defined in Splash.module.css.
//   2. On desktop only, mounts the live react-globe.gl into the hero
//      (loads three.js dynamically) and crossfades the CSS WireGlobe
//      out once a canvas actually exists.
//
// Globe-mount gate precedence (consolidated per 2026-07 eng review):
//   1. SPLASH_CONFIG.globeReady — config kill-switch,
//   2. SPLASH_DESKTOP_GLOBE_MQ — viewport width + hover + fine pointer
//      (landscape phones stay on the CSS wireframe: it's the shipped
//      mobile design, not a fallback),
//   3. mountGlobe's internal perf fallback — its own concern.
// Reduced motion does NOT gate the mount: Globe.tsx mounts with all
// motion disabled (content is never withheld for a motion preference).
//
// This module is dynamic-imported by Splash.tsx after mount. All
// browser-API calls live here.

import { mountGlobe } from './Globe';
import { SPLASH_CONFIG } from '../me';
import { SPLASH_DESKTOP_GLOBE_MQ } from './constants';
import s from './Splash.module.css';

export async function runReveal(splashRoot: HTMLElement): Promise<void> {
  splashRoot.classList.remove(s.revealing);

  if (!SPLASH_CONFIG.globeReady) return;
  if (!matchMedia(SPLASH_DESKTOP_GLOBE_MQ).matches) return;

  const mountEl = splashRoot.querySelector<HTMLElement>('[data-splash-globe-mount="true"]');
  const boxEl = splashRoot.querySelector<HTMLElement>('[data-splash-globe-box="true"]');
  if (!mountEl) return;

  // Failures are non-fatal: the CSS WireGlobe stays in place.
  try {
    await mountGlobe(mountEl);
  } catch {
    return;
  }

  // mountGlobe can resolve without producing a canvas (perf fallback,
  // config gate) — only fade the CSS wireframe once WebGL is really
  // there, so the hero is never empty. Poll one frame at a time with a
  // 5s cap instead of trusting the resolve.
  if (!boxEl) return;
  const start = performance.now();
  const waitForCanvas = (): void => {
    if (mountEl.querySelector('canvas')) {
      boxEl.setAttribute('data-live', 'true');
      return;
    }
    if (performance.now() - start > 5000) return;
    requestAnimationFrame(waitForCanvas);
  };
  waitForCanvas();
}
