// One-line "<name> — <description>" bullet. The hanging indent is set to
// the rendered width of the bold prefix so wrapped lines align cleanly
// under the start of the description.
import { useContext } from 'react';
import { KPText } from './KPText';
import { ModeContext, pickText, isArchived as isArchivedItem } from '../utils/mode';
import { measureKPPrefix } from '../utils/kp-font';
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
  const indent = measureKPPrefix(
    [[p.name, 'bold'], [' — ', 'normal']] as const,
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
          <span className="kp-wrap">
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
        <KPText
          text={desc}
          prefixNode={<><b style={{ fontWeight: 700 }}>{p.name}</b>{' — '}</>}
          firstLineIndent={indent}
        />
      )}
    </li>
  );
}
