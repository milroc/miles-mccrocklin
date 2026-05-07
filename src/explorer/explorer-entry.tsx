// Explorer entry — bundle entrypoint for explorer.html.
// No SSR pass for this page (the globe is dynamic-imported anyway and
// only paints client-side); we just createRoot directly.

import { createRoot } from 'react-dom/client';
import { Explorer } from './Explorer';

const rootEl = document.getElementById('root');
if (rootEl) createRoot(rootEl).render(<Explorer />);
