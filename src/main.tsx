// Browser entry: import global styles + side-effect modules, then mount
// the resume app. The actual <App> component lives in src/App.tsx.
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { EDIT_ENABLED, EditProvider } from './edit';
import { RESUME_DATA } from './resume-data';
import './styles/globals.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found in DOM');
const root = createRoot(rootEl);

// In production EDIT_ENABLED is `false`, the EditProvider import is dead
// code, and the bundler tree-shakes it. App reads its own resume import
// directly in that path — provider is purely a dev-time wrapper.
if (EDIT_ENABLED) {
  root.render(
    <EditProvider initialResume={RESUME_DATA}>
      <App />
    </EditProvider>,
  );
} else {
  root.render(<App />);
}
