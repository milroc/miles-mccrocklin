// Inline chip: 4 mutually-exclusive visibility buttons + a real delete X.
// Visibility buttons push a `visibility` change record. The X pushes a
// `delete` record (the item disappears from the rendered preview
// immediately, and the agent will remove it from data/me.json on
// the next pass).
//
// Conditional-assignment on the literal EDIT_ENABLED constant →
// `Stub` in prod, `Chip` declaration unreferenced and DCE'd.
import { EDIT_ENABLED } from './edit';
import { useEdit } from './EditContext';
import { getAtPath } from './path';
import { isJsonObject } from '../utils/json';
import { isVisibility } from '../utils/mode';
import type { Visibility } from '../types';
import s from './edit.module.css';

interface VisibilityChipProps {
  // Path to the *item* (not the field) — chip mutates the item's
  // visibility key, or pushes a delete on the item itself.
  path: string;
}

const LEVELS: Array<{ value: Visibility; label: string; title: string }> = [
  { value: 'all',         label: 'ALL',  title: 'Show in all modes (full · text · 1-pager)' },
  { value: 'not_1pager',  label: '!1P',  title: 'Hide from 1-pager (full · text only)' },
  { value: '1pager_only', label: '1P',   title: 'Show only in 1-pager' },
  { value: 'archived',    label: 'ARCH', title: 'Archived — kept in JSON, never rendered' },
];

const Stub = (_: VisibilityChipProps): null => null;

function Chip({ path }: VisibilityChipProps) {
  const { active, displayResume, pushVisibility, pushDelete } = useEdit();
  if (!active) return null;

  // Read the live (post-changes) item to reflect the user's pending
  // visibility/visibility edit immediately. Default (no field) reads
  // as 'not_1pager' to match visible()'s default.
  const item = getAtPath(displayResume, path);
  const current: Visibility =
    isJsonObject(item) && isVisibility(item.visibility) ? item.visibility : 'not_1pager';

  return (
    <span className={s.chip} aria-label="Visibility">
      {LEVELS.map(({ value, label, title }) => (
        <button
          key={value}
          type="button"
          className={value === current ? s.on : ''}
          onClick={() => pushVisibility(path, value)}
          title={title}
        >
          {label}
        </button>
      ))}
      <button
        type="button"
        className={s.delete}
        onClick={() => {
          if (typeof window !== 'undefined' && !window.confirm('Delete this item from the resume?')) return;
          pushDelete(path);
        }}
        title="Delete this item from data/me.json"
        aria-label="Delete"
      >
        ✕
      </button>
    </span>
  );
}

export const VisibilityChip = EDIT_ENABLED ? Chip : Stub;
