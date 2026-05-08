// Browser entry: import global styles + side-effect modules, then mount
// the resume app. The actual <App> component lives in src/App.tsx.
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { EDIT_ENABLED, EditProvider } from './edit';
import RESUME from '../data/resume.json' with { type: 'json' };
import type { Resume } from './types';
import './styles/globals.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found in DOM');
const root = createRoot(rootEl);

// In production EDIT_ENABLED is `false`, the EditProvider import is dead
// code, and the bundler tree-shakes it. App reads its own resume import
// directly in that path — provider is purely a dev-time wrapper.
if (EDIT_ENABLED) {
  const initialResume = RESUME as unknown as Resume;
  root.render(
    <EditProvider initialResume={initialResume}>
      <App />
    </EditProvider>,
  );
} else {
  root.render(<App />);
}
