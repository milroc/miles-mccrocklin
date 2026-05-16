// Change-record log. Every UI edit becomes one entry; the rendered
// preview is `applyChanges(rawResume, changes)`. The list lives purely
// in client memory (with a localStorage backup) — the dev server is
// not involved. The only way records leave the browser is through the
// "Copy LLM" prompt, which the user pastes into an in-repo agent that
// applies them to `data/me.json`.
import type { Resume, Visibility } from '../types';
import { getAtPath, setAtPath, deleteAtPath, pathStartsWith } from './path';

export type ChangeRecord =
  // User typed in-place. `value` is whatever the field becomes.
  | { kind: 'edit'; path: string; value: unknown }
  // User changed visibility. `path` points at the *item* (not its
  // visibility key); the agent should set `visibility` on it.
  | { kind: 'visibility'; path: string; value: Visibility }
  // User clicked X. The agent removes the item from its container.
  | { kind: 'delete'; path: string }
  // User clicked "+ add" on an array. `path` points at the array;
  // `value` is the new item to append at the end. Multiple `add`
  // records at the same path coexist (they all append, in order).
  | { kind: 'add'; path: string; value: unknown }
  // Free-form instruction the agent should interpret.
  | { kind: 'feedback'; path: string; value: string };

// Apply a list of changes to a resume tree. Used at render time to
// show the user what the resume will look like AFTER the agent
// applies their pending edits.
export function applyChanges(resume: Resume, changes: ChangeRecord[]): Resume {
  let r: Resume = resume;
  for (const c of changes) {
    switch (c.kind) {
      case 'edit':
        r = setAtPath(r, c.path, c.value);
        break;
      case 'visibility':
        r = setAtPath(r, `${c.path}/visibility`, c.value);
        break;
      case 'delete':
        r = deleteAtPath(r, c.path);
        break;
      case 'add': {
        // Append the new item to the array at `path`. If the target
        // doesn't exist or isn't an array we ignore the record — it's
        // dev-time data, drop it gracefully.
        const arr = getAtPath(r, c.path);
        if (Array.isArray(arr)) {
          r = setAtPath(r, c.path, [...arr, c.value]);
        }
        break;
      }
      case 'feedback':
        // Doesn't change the rendered tree — only travels to the LLM.
        break;
    }
  }
  return r;
}

// Append a change record with smart collapse:
//   - 'edit' / 'visibility' / 'feedback' replace any prior record of
//     the SAME kind targeting the SAME path (so re-edits don't pile up).
//   - 'add' is always append-only (no collapse) — multiple adds at the
//     same array path each contribute one new item, in order.
//   - 'delete' supersedes anything targeting the deleted subtree —
//     prior edits/visibility/feedback/adds under that path are dropped,
//     and existing deletes covering this path are kept (no duplicates).
export function pushChange(
  changes: ChangeRecord[],
  next: ChangeRecord,
): ChangeRecord[] {
  if (next.kind === 'delete') {
    // Drop everything targeting the deleted path or its descendants.
    // If a prior delete already covers this path (or an ancestor),
    // keep the prior one and skip the new entry.
    const alreadyCovered = changes.some(
      (c) => c.kind === 'delete' && pathStartsWith(next.path, c.path),
    );
    const filtered = changes.filter((c) => !pathStartsWith(c.path, next.path));
    return alreadyCovered ? filtered : [...filtered, next];
  }
  // Drop the new record if a delete covers its path/ancestor.
  const supersededByDelete = changes.some(
    (c) => c.kind === 'delete' && pathStartsWith(next.path, c.path),
  );
  if (supersededByDelete) return changes;
  // 'add' is append-only — multiple adds at the same path coexist.
  if (next.kind === 'add') return [...changes, next];
  // edit / visibility / feedback: replace prior record of the same
  // kind at the same path, otherwise append.
  let replaced = false;
  const out = changes.map((c) => {
    if (c.kind === next.kind && c.path === next.path) {
      replaced = true;
      return next;
    }
    return c;
  });
  if (!replaced) out.push(next);
  return out;
}

// Drop a single change-record by index. Used to undo an individual
// pending change without nuking the whole log.
export function dropChange(changes: ChangeRecord[], index: number): ChangeRecord[] {
  return changes.filter((_, i) => i !== index);
}

// True when there are any user-applied edits (not just feedback notes).
// Used to gate "Discard" / "dirty" indicators in the toolbar.
export function hasResumeChanges(changes: ChangeRecord[]): boolean {
  return changes.some((c) => c.kind !== 'feedback');
}
