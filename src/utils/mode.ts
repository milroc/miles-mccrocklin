// Mode plumbing for the resume's three views (interactive / text / 1pager).
import { createContext } from 'react';
import type { Mode, RichText, Visibility } from '../types';

export const ModeContext = createContext<Mode>('interactive');
// `true` while the browser is preparing a print snapshot. KPText reads
// this and substitutes the canonical print column width for whatever the
// on-screen ResizeObserver measured — otherwise a narrow window would
// produce KP lines that don't fill the 816px printed letter page.
export const PrintContext = createContext<boolean>(false);

// Default visibility when the field is missing — matches the legacy
// numeric-priority default of 2 (renders in interactive + text, hides
// from 1-pager). Existing items without a visibility field keep working.
const DEFAULT_VISIBILITY: Visibility = 'not_1pager';

function getVisibility(item: unknown): Visibility {
  if (typeof item !== 'string' && item != null && typeof item === 'object') {
    const v = (item as { visibility?: Visibility }).visibility;
    if (v === 'all' || v === 'not_1pager' || v === '1pager_only' || v === 'archived') {
      return v;
    }
  }
  return DEFAULT_VISIBILITY;
}

// True only for items the user explicitly marked archived. Distinct
// from "fails visible() in this mode" — a `1pager_only` item viewed in
// text mode is hidden by visible() but isn't *archived*; it's just a
// mode mismatch. In edit mode we render everything but the archived
// styling (faded + "ARCHIVED" tag) is reserved for the explicit case.
export function isArchived(item: unknown): boolean {
  return getVisibility(item) === 'archived';
}

export function visible(item: unknown, mode: Mode): boolean {
  const v = getVisibility(item);
  if (v === 'archived') return false;
  if (v === 'all') return true;
  if (v === '1pager_only') return mode === '1pager';
  // 'not_1pager' — interactive + text
  return mode !== '1pager';
}

// Returns the right text variant for the current mode. Strings pass through.
// Objects expose `short` (used in 1pager when present) and `text` (everywhere
// else). Falls back to `text` if `short` is missing.
export function pickText(item: RichText | null | undefined, mode: Mode): string {
  if (item == null) return '';
  if (typeof item === 'string') return item;
  if (mode === '1pager' && item.short) return item.short;
  return item.text ?? '';
}
