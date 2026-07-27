// One-line "<name> — <description>" bullet. Wrapped lines align under
// the bullet's hanging indent (standard list convention).
import { useContext } from 'react';
import { RedactedText } from './RedactedText';
import { ModeContext, pickText, isArchived as isArchivedItem } from '../utils/mode';
import {
  EDIT_ENABLED, EditableText, NoteBubble, VisibilityChip, joinPath, useEdit,
} from '../edit';
import type { Project, RichText } from '../types';

interface AIProjectBulletProps {
  p: Project;
  // Path to the project object, e.g. "/experience/1/tracks/2/projects/0".
  path?: string;
}

export function AIProjectBullet({ p, path }: AIProjectBulletProps) {
  const mode = useContext(ModeContext);
  const edit = useEdit();
  const editActive = EDIT_ENABLED && edit.active;
  const desc = pickText(
    typeof p.description === 'string' ? p.description : (p.description as RichText),
    mode,
  );
  const archived = editActive && isArchivedItem(p);
  const descPath = path ? (typeof p.description === 'string'
    ? joinPath(path, 'description')
    : joinPath(path, 'description', 'text')) : '';
  return (
    <li data-archived={archived || undefined}>
      {editActive && path ? (
        <>
          <span>
            <b style={{ fontWeight: 700 }}>
              <EditableText path={joinPath(path, 'name')} value={p.name} />
            </b>
            {' — '}
            <EditableText path={descPath} value={desc} />
          </span>
          <VisibilityChip path={path} />
          <NoteBubble path={path} />
        </>
      ) : (
        <>
          <b style={{ fontWeight: 700 }}>{p.name}</b>
          {' — '}
          <RedactedText text={desc} />
        </>
      )}
    </li>
  );
}
