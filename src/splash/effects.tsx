// Splash effects — the post-mount "show" layer.
//
// The chrome fade-in left this module in the prerender change: it's a
// pure-CSS entrance animation now (splash-chrome-enter, see
// Splash.module.css), so the prerendered document never waits on JS.
// What remains here is the one genuinely JS effect: mounting the live
// react-globe.gl into the hero (loads three.js dynamically) and
// crossfading the CSS WireGlobe out once a canvas actually exists.
//
// Globe-mount gate precedence:
//   1. SPLASH_CONFIG.globeReady — config kill-switch,
//   2. mountGlobe's internal perf fallback — its own concern.
// Mobile mounts the live globe too (2026-07): the CSS wireframe reads
// as a loading state that never finishes, not a designed end state.
// The wireframe remains the pre-canvas base and the perf/failure
// fallback on low-end devices.
// Reduced motion does NOT gate the mount: Globe.tsx mounts with all
// motion disabled (content is never withheld for a motion preference).
//
// This module is dynamic-imported by Splash.tsx after mount. All
// browser-API calls live here.

import { mountGlobe } from './Globe';
import { SPLASH_CONFIG } from '../me';

export async function runReveal(splashRoot: HTMLElement): Promise<void> {
  if (!SPLASH_CONFIG.globeReady) return;

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
