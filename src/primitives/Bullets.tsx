// Hanging-indent bullet list. Each <li> wraps its text through KPText so
// the resume gets Knuth-Plass paragraph breaking instead of the browser's
// greedy line wrap. The .bullets class stays a global string (Reviews
// references it via `:global(.bullets)`), so styles live in Bullets.css
// rather than a hashed CSS module.
//
// In edit mode (build-time gated) every <li> also renders a visibility
// chip, note bubble, and EditableText wrapper. Bullets with visibility
// "archived" still render here (faded) so the user can re-classify or
// delete them.
import { useContext } from 'react';
import { KPText } from './KPText';
import { ModeContext, visible, pickText, isArchived as isArchivedItem } from '../utils/mode';
import {
  AddButton, EDIT_ENABLED, EditableText, NoteBubble, VisibilityChip, joinPath, useEdit,
} from '../edit';
import editStyles from '../edit/edit.module.css';
import type { Achievement, RichText } from '../types';
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
            const isObj = typeof it === 'object' && it !== null;
            // ARCHIVED treatment is reserved for the explicit case —
            // a 1pager_only item shown in text mode (because edit
            // forces text) is a *mode mismatch*, not an archive.
            const archived = editActive && isArchivedItem(it);
            const itemPath = path ? joinPath(path, i) : '';
            const textPath = isObj ? joinPath(itemPath, 'text') : itemPath;
            const text = pickText(it as RichText, mode);
            return (
              <li key={i} className={archived ? editStyles.archived : undefined}>
                {editActive && itemPath ? (
                  <>
                    {/* Bypass KP in edit mode — contentEditable inside
                        KP's multi-span line wrappers fights the caret.
                        Plain browser wrap is fine while authoring; KP
                        returns on save+reload. */}
                    <span className="kp-wrap">
                      <EditableText path={textPath} value={text} />
                    </span>
                    <VisibilityChip path={itemPath} />
                    <NoteBubble path={itemPath} />
                  </>
                ) : (
                  <KPText text={text} />
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
