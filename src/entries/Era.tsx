// An "Era" is a phase within a job — a focus area + period + bullets.
import { useContext } from 'react';
import { Bullets } from '../primitives/Bullets';
import { Figure } from '../media/Figure';
import { ModeContext, visible } from '../utils/mode';
import {
  EDIT_ENABLED, NoteBubble, VisibilityChip, joinPath, useEdit,
} from '../edit';
import editStyles from '../edit/edit.module.css';
import type { Era as EraData } from '../types';
import s from './Era.module.css';

interface EraProps {
  era: EraData;
  path?: string;
  archived?: boolean;
}

export function Era({ era, path, archived }: EraProps) {
  const mode = useContext(ModeContext);
  const edit = useEdit();
  const editActive = EDIT_ENABLED && edit.active;
  if (!editActive && !visible(era, mode)) return null;
  const isInteractive = mode === 'interactive';

  const cls = `${s.era} ${archived ? editStyles.archived : ''}`.trim();
  return (
    <div className={cls}>
      <div className={s.eraHead}>
        <span className={s.focus}>{era.focus}</span>
        <span className={s.period}>{era.period}</span>
        {editActive && path && (
          <>
            <VisibilityChip path={path} />
            <NoteBubble path={path} />
          </>
        )}
      </div>
      <Bullets items={era.achievements} path={path ? joinPath(path, 'achievements') : undefined} />
      {era.media && isInteractive && <Figure media={era.media} />}
    </div>
  );
}
