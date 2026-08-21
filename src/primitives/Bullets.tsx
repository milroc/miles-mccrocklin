// Hanging-indent bullet list, browser-wrapped. (A Knuth-Plass pipeline
// once chose the line breaks here; it was removed after measurement
// showed near-zero visible difference from native wrapping — see PR
// #50.) The .bullets class stays a global string (Reviews references
// it via `:global(.bullets)`), so styles live in Bullets.css rather
// than a hashed CSS module.
//
// In edit mode (build-time gated) every <li> also renders a visibility
// chip, note bubble, and EditableText wrapper. Bullets with visibility
// "archived" still render here (faded) so the user can re-classify or
// delete them.
import { useContext } from 'react';
import { RedactedText } from './RedactedText';
import { ModeContext, visible, pickText, isPlainText, isArchived as isArchivedItem } from '../utils/mode';
import {
  AddButton, EDIT_ENABLED, EditableText, NoteBubble, VisibilityChip, joinPath, useEdit,
} from '../edit';
import type { Achievement } from '../types';
import './Bullets.css';

interface BulletsProps {
  items?: ReadonlyArray<Achievement | string> | undefined;
  // Path to the items array, e.g. "/experience/0/achievements". Required
  // when edit mode is active for chips/notes/edit to know what to mutate;
  // optional otherwise so non-edit callers don't have to plumb it.
  path?: string;
}

export function Bullets({ items, path }: BulletsProps) {
  const mode = useContext(ModeContext);
  const edit = useEdit();
  const editActive = EDIT_ENABLED && edit.active;
  const list = items ?? [];
  // In edit mode show ALL bullets (faded for explicit-archived ones);
  // otherwise apply the standard mode-visibility filter.
  const renderable = list
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => editActive || visible(it, mode));
  // Render even an empty list when edit + path is present, so the
  // "+ add bullet" affordance has a place to sit.
  const showAddButton = editActive && !!path;
  if (!renderable.length && !showAddButton) return null;
  return (
    <>
      {renderable.length > 0 && (
        <ul className="bullets">
          {renderable.map(({ it, i }) => {
            const isObj = !isPlainText(it);
            // ARCHIVED treatment is reserved for the explicit case —
            // a 1pager_only item shown in text mode (because edit
            // forces text) is a *mode mismatch*, not an archive.
            const archived = editActive && isArchivedItem(it);
            const itemPath = path ? joinPath(path, i) : '';
            const textPath = isObj ? joinPath(itemPath, 'text') : itemPath;
            const text = pickText(it, mode);
            return (
              <li key={i} data-archived={archived || undefined}>
                {editActive && itemPath ? (
                  <>
                    <span>
                      <EditableText path={textPath} value={text} />
                    </span>
                    <VisibilityChip path={itemPath} />
                    <NoteBubble path={itemPath} />
                  </>
                ) : (
                  <RedactedText text={text} />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {showAddButton && path && (
        <AddButton
          path={path}
          template={{ text: 'New bullet' }}
          label="+ add bullet"
        />
      )}
    </>
  );
}
