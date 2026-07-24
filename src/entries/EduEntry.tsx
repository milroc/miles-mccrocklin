// Education entry. Same `.entry` chrome as a job; the 1-pager swaps in
// `degree_short` when present so the program name fits on a single line.
import { useContext } from 'react';
import { Bullets } from '../primitives/Bullets';
import { ModeContext, visible } from '../utils/mode';
import {
  EDIT_ENABLED, NoteBubble, VisibilityChip, joinPath, useEdit,
} from '../edit';
import type { School } from '../types';

interface EduEntryProps {
  school: School;
  path?: string;
  archived?: boolean;
}

export function EduEntry({ school, path, archived }: EduEntryProps) {
  const mode = useContext(ModeContext);
  const edit = useEdit();
  const editActive = EDIT_ENABLED && edit.active;
  if (!editActive && !visible(school, mode)) return null;
  const degreeText = (mode === '1pager' && school.degree_short)
    ? school.degree_short
    : school.degree;
  return (
    <div className="entry" data-archived={archived || undefined}>
      <div className="entry-head">
        <div className="l">
          {school.institution}
          {editActive && path && (
            <>
              <VisibilityChip path={path} />
              <NoteBubble path={path} />
            </>
          )}
        </div>
        <div className="r">{school.start_date} – {school.end_date}</div>
      </div>
      <div className="entry-sub">
        <div className="l">{degreeText}</div>
        <div className="r">{school.location}</div>
      </div>
      <Bullets
        items={school.details}
        path={path ? joinPath(path, 'details') : undefined}
      />
    </div>
  );
}
