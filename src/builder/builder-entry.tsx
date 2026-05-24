// /builder/ entry: mounts Builder into #root. No EditProvider — the
// public page never offers in-app editing. The detailed resume at
// /resume/ keeps its EditProvider in src/main.tsx.

import { createRoot } from 'react-dom/client';
import { Builder } from './Builder';
import '../styles/globals.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found in DOM');
createRoot(rootEl).render(<Builder />);
