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

  // Prod ships #root prerendered (build.ts injects the ssr-entry.tsx
  // markup) → hydrate. Dev serves the source HTML's empty #root
  // (dev.ts does no prerender pass) → fresh render.
  const ssrPresent = rootEl.firstElementChild !== null;
  if (ssrPresent) {
    hydrateRoot(rootEl, <Splash />);
  } else {
    createRoot(rootEl).render(<Splash />);
  }
}
