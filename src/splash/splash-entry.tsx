// Splash entry — bundle entrypoint for splash.html.
//
// Hydrates (prod) or fresh-renders (dev) the Splash chrome. The reveal
// effects are kicked off from inside Splash via useEffect, so they run
// after React commits the DOM in both modes.

import { hydrateRoot, createRoot } from 'react-dom/client';
import { Splash } from './Splash';

bootSplash();

function bootSplash(): void {
  const rootEl = document.getElementById('root');
  if (!rootEl) return;

  // In production builds, build.ts injects SSR'd markup into #root before
  // shipping. In dev (bun run dev), no SSR runs, so #root is empty.
  // Pick hydrateRoot when SSR'd content is present, createRoot otherwise.
  // Using hydrateRoot on an empty #root throws a hydration mismatch.
  const ssrPresent = rootEl.firstElementChild !== null;
  if (ssrPresent) {
    hydrateRoot(rootEl, <Splash />);
  } else {
    createRoot(rootEl).render(<Splash />);
  }
}
