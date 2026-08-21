// Mode plumbing for the resume's three views (interactive / text / 1pager).
import { createContext } from 'react';
import type { Mode, RichText, Visibility } from '../types';

export const ModeContext = createContext<Mode>('interactive');
// Default visibility when the field is missing — matches the legacy
// numeric-priority default of 2 (renders in interactive + text, hides
// from 1-pager). Existing items without a visibility field keep working.
const DEFAULT_VISIBILITY: Visibility = 'not_1pager';

// Everything these three are asked about is a node of the resume tree:
// a bare string (RichText with no metadata) or an object that may carry
// a `visibility`. That, and nothing more, is the contract.
export type Renderable = string | { visibility?: Visibility } | null | undefined;

// The object arm of Renderable — the only one that can carry metadata.
function isTaggable(item: Renderable): item is { visibility?: Visibility } {
  return item != null && typeof item !== 'string';
}

// RichText, Achievement and Project.description all read "a bare string,
// or the object form". One guard answers which for all of them.
export function isPlainText<T extends object>(value: string | T): value is string {
  return typeof value === 'string';
}

function getVisibility(item: Renderable): Visibility {
  if (isTaggable(item)) {
    const v = item.visibility;
    // The value list is re-checked at runtime because RESUME_DATA is
    // asserted from JSON rather than parsed: a typo in me.json arrives
    // here typed as a Visibility but isn't one.
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
export function isArchived(item: Renderable): boolean {
  return getVisibility(item) === 'archived';
}

export function visible(item: Renderable, mode: Mode): boolean {
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
  if (isPlainText(item)) return item;
  if (mode === '1pager' && item.short) return item.short;
  return item.text ?? '';
}
