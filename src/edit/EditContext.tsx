// Edit-mode state container. The user's edits never mutate the resume
// tree directly — they're appended to a list of `ChangeRecord`s held
// purely in client memory (with a localStorage backup for crash
// safety). The dev server is no longer involved; the only way out of
// this list is the "Copy LLM" prompt, which the user pastes to an
// agent that applies the records to `data/resume.json` directly.
//
// Built-time gated by EDIT_ENABLED — the import boundary stays, the
// runtime body no-ops in prod via the `EDIT_ENABLED ? Real : Stub`
// export pattern.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Resume, Visibility } from '../types';
import { EDIT_ENABLED } from './edit';
import {
  applyChanges,
  dropChange,
  hasResumeChanges,
  pushChange,
  type ChangeRecord,
} from './changes';

const STORAGE_KEY = 'edit-changes';

interface EditApi {
  // True only when the build flag AND the user has flipped the toggle.
  active: boolean;
  setActive: (v: boolean) => void;

  // Source of truth for renderers. Equals `applyChanges(rawResume,
  // changes)` when active, or the raw imported JSON when inactive.
  displayResume: Resume;

  // The pending change log. Lives in-memory + localStorage; never
  // touches the server.
  changes: ChangeRecord[];
  // True when there are any pending changes (any of the four kinds).
  dirty: boolean;
  // True when the user has made any resume-mutating change (text edit,
  // visibility, delete) — used to color archive treatments etc.
  hasResumeChanges: boolean;

  // Edit primitives — each appends one change-record (with smart collapse).
  pushEdit: (path: string, value: unknown) => void;
  pushVisibility: (path: string, value: Visibility) => void;
  pushDelete: (path: string) => void;
  pushAdd: (path: string, value: unknown) => void;
  pushFeedback: (path: string, value: string) => void;
  clearFeedback: (path: string) => void;

  // Toolbar actions.
  discard: () => void;
  copyPrompt: () => Promise<void>;
}

const noop = () => {};
const noopAsync = async () => {};

const EditContext = createContext<EditApi | null>(null);

interface EditProviderProps {
  initialResume: Resume;
  children: ReactNode;
}

const StubProvider = ({ children }: EditProviderProps): ReactNode => children;

function loadInitialChanges(): ChangeRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function RealEditProvider({ initialResume, children }: EditProviderProps) {
  const [active, setActive] = useState<boolean>(() => {
    if (!EDIT_ENABLED) return false;
    try {
      return sessionStorage.getItem('edit-active') === '1';
    } catch {
      return false;
    }
  });
  const [changes, setChanges] = useState<ChangeRecord[]>(() => loadInitialChanges());

  // Persist toggle across reloads while iterating in dev.
  useEffect(() => {
    if (!EDIT_ENABLED) return;
    try {
      sessionStorage.setItem('edit-active', active ? '1' : '0');
    } catch {/* storage disabled — no-op */}
  }, [active]);

  // Persist change list to localStorage on every mutation. Cheap; keeps
  // the user's pending edits across page reloads / HMR refreshes.
  useEffect(() => {
    if (!EDIT_ENABLED) return;
    try {
      if (changes.length === 0) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(changes));
    } catch {/* storage disabled — no-op */}
  }, [changes]);

  const pushEdit = useCallback((path: string, value: unknown) => {
    setChanges((cs) => pushChange(cs, { kind: 'edit', path, value }));
  }, []);
  const pushVisibility = useCallback((path: string, value: Visibility) => {
    setChanges((cs) => pushChange(cs, { kind: 'visibility', path, value }));
  }, []);
  const pushDelete = useCallback((path: string) => {
    setChanges((cs) => pushChange(cs, { kind: 'delete', path }));
  }, []);
  const pushAdd = useCallback((path: string, value: unknown) => {
    setChanges((cs) => pushChange(cs, { kind: 'add', path, value }));
  }, []);
  const pushFeedback = useCallback((path: string, value: string) => {
    setChanges((cs) => pushChange(cs, { kind: 'feedback', path, value }));
  }, []);
  const clearFeedback = useCallback((path: string) => {
    setChanges((cs) => {
      const idx = cs.findIndex((c) => c.kind === 'feedback' && c.path === path);
      return idx === -1 ? cs : dropChange(cs, idx);
    });
  }, []);

  const discard = useCallback(() => {
    setChanges([]);
  }, []);

  const copyPrompt = useCallback(async () => {
    if (changes.length === 0) {
      // No pending changes — short prompt asking the agent to polish
      // whatever's in resume.json (e.g. recent git diffs).
      const empty = [
        "I'm editing my resume. The state is in `data/resume.json`. Review",
        "recent changes (`git diff data/resume.json` if helpful), fix anything",
        'awkward, and write the cleaned JSON back. Preserve every field. Keep',
        'the same shape and field names.',
        '',
        '## Schema',
        'TypeScript shape: `src/types.ts` (start at the `Resume` interface).',
        "Run `bun run typecheck` after writing.",
      ].join('\n');
      await navigator.clipboard.writeText(empty);
      return;
    }
    const describe = (c: ChangeRecord): string => {
      switch (c.kind) {
        case 'edit':
          return `**edit** \`${c.path}\` → ${JSON.stringify(c.value)}`;
        case 'visibility':
          return `**visibility** \`${c.path}\` → ${JSON.stringify(c.value)}`;
        case 'delete':
          return `**delete** \`${c.path}\` (remove the item at this path)`;
        case 'add':
          return `**add** \`${c.path}\` ← ${JSON.stringify(c.value)}`;
        case 'feedback':
          // Path "/" is the high-level feedback box at the top of the
          // editor — call it out explicitly so the agent treats it as
          // a holistic instruction rather than per-item prose.
          return c.path === '/'
            ? `**feedback (high-level)** — ${c.value}`
            : `**feedback** \`${c.path}\` — ${c.value}`;
      }
    };
    const recordList = changes.map((c, i) => `${i + 1}. ${describe(c)}`);

    const prompt = [
      "I'm editing my resume. The state lives in `data/resume.json`. The",
      'change records below were captured in my editor (client-side only —',
      'they were never written anywhere). Apply each record to',
      '`data/resume.json` in order. Preserve every field not affected by a',
      'record. Keep the same shape and field names.',
      '',
      '## Records to apply',
      ...recordList,
      '',
      '## Record-kind semantics',
      '- `edit`       — set the JSON-pointer `path` to the given `value`',
      '                 (replaces whatever was there).',
      '- `visibility` — set the `visibility` key on the object at `path`',
      '                 to one of: `"all"` · `"not_1pager"` · `"1pager_only"`',
      '                 · `"archived"`.',
      '- `delete`     — remove the array entry or object key at `path`.',
      '                 If the parent is an array, splice the index out',
      '                 (subsequent siblings shift down).',
      '- `add`        — append `value` to the array at `path`. Multiple',
      '                 `add` records at the same path each contribute one',
      '                 new item, in the order they appear.',
      '- `feedback`   — free-form instruction. Rewrite the prose at `path`',
      '                 to satisfy it; use your judgment on tone and length.',
      '                 If `path` is `/`, treat it as a *high-level* instruction',
      '                 about the resume as a whole (tone, structure, framing) —',
      '                 apply across whatever sections it implies.',
      '',
      '## Authoritative copy of the change list',
      '```json',
      JSON.stringify({ changes }, null, 2),
      '```',
      '',
      '## Schema',
      'TypeScript shape: `src/types.ts` (start at the `Resume` interface).',
      "Run `bun run typecheck` after writing to confirm the edit didn't",
      'break the schema.',
    ].join('\n');
    await navigator.clipboard.writeText(prompt);
  }, [changes]);

  const displayResume = useMemo(
    () => (active ? applyChanges(initialResume, changes) : initialResume),
    [active, initialResume, changes],
  );
  const dirty = changes.length > 0;
  const hasResume = useMemo(() => hasResumeChanges(changes), [changes]);

  const api = useMemo<EditApi>(
    () => ({
      active, setActive, displayResume, changes, dirty,
      hasResumeChanges: hasResume,
      pushEdit, pushVisibility, pushDelete, pushAdd, pushFeedback, clearFeedback,
      discard, copyPrompt,
    }),
    [active, displayResume, changes, dirty, hasResume,
     pushEdit, pushVisibility, pushDelete, pushAdd, pushFeedback, clearFeedback,
     discard, copyPrompt],
  );

  return <EditContext.Provider value={api}>{children}</EditContext.Provider>;
}

export const EditProvider = EDIT_ENABLED ? RealEditProvider : StubProvider;

// Read the live edit state. Returns a stub when no provider is mounted
// (production bundle has no provider) so callers don't have to null-check.
export function useEdit(): EditApi {
  const ctx = useContext(EditContext);
  if (ctx) return ctx;
  return STUB;
}

const STUB: EditApi = {
  active: false,
  displayResume: {} as Resume,
  changes: [],
  dirty: false,
  hasResumeChanges: false,
  setActive: noop,
  pushEdit: noop,
  pushVisibility: noop,
  pushDelete: noop,
  pushAdd: noop,
  pushFeedback: noop,
  clearFeedback: noop,
  discard: noop,
  copyPrompt: noopAsync,
};
