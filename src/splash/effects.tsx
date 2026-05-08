// Splash effects — the post-hydration "show" layer.
//
// Splash.tsx renders SSR-safe chrome with the .revealing class hiding
// the wordmark + tiles + socials + CTA. This module:
//
//   1. Removes the .revealing class so the chrome fades in via the
//      CSS transitions defined in Splash.module.css.
//   2. Mounts the live react-globe.gl into the Explorer tile (loads
//      three.js dynamically; prewarmGlobe was kicked off at hydration
//      by Splash.tsx so most of the cost has already been paid).
//
// This module is dynamic-imported by splash-entry.tsx after hydration.
// All browser-API calls (matchMedia, etc) live here, so build.ts's
// renderToString never executes them.

import { mountGlobe, prewarmGlobe } from './Globe';
import s from './Splash.module.css';

// Re-exported so Splash.tsx can fire it from its hydration useEffect
// without taking a direct dependency on Globe.tsx (which would split
// the splash entry chunk awkwardly).
export { prewarmGlobe };

export async function runReveal(splashRoot: HTMLElement): Promise<void> {
  // Single beat: flip to the revealed state, then mount the globe.
  // Reduced-motion path is identical — nothing motion-heavy left here
  // for the splash to gate on. The globe's own arc animation is
  // mountGlobe's concern (it self-checks prefers-reduced-motion).
  splashRoot.classList.remove(s.revealing);
  splashRoot.classList.add(s.revealed);

  // prewarmGlobe (kicked off at hydration by Splash.tsx) has already
  // finished the imports + JPEG decode + GPU texture upload, so this
  // call only pays the React render + scene-init cost. Failures are
  // non-fatal: the static CSS wireframe stays in place.
  const mountEl = splashRoot.querySelector<HTMLElement>('[data-splash-globe-mount="true"]');
  if (mountEl) await mountGlobe(mountEl).catch(() => {});
}
