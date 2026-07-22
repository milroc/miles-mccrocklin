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

  // #root ships empty in both dev and prod — the SSR pass never worked
  // and was removed (build.ts, commit aa94552). Keep the hydrate branch
  // anyway so restoring SSR later doesn't require touching the entry.
  const ssrPresent = rootEl.firstElementChild !== null;
  if (ssrPresent) {
    hydrateRoot(rootEl, <Splash />);
  } else {
    createRoot(rootEl).render(<Splash />);
  }
}
