// An "Era" is a phase within a job — a focus area + period + bullets.
import { useContext } from 'react';
import { Bullets } from '../primitives/Bullets';
import { Figure } from '../media/Figure';
import { ModeContext, visible } from '../utils/mode';
import {
  EDIT_ENABLED, NoteBubble, VisibilityChip, joinPath, useEdit,
} from '../edit';
import { EraChrome } from './EraChrome';
import type { Era as EraData } from '../types';

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

  return (
    <EraChrome
      focus={era.focus}
      period={era.period}
      archived={archived}
      headExtra={
        editActive && path ? (
          <>
            <VisibilityChip path={path} />
            <NoteBubble path={path} />
          </>
        ) : null
      }
    >
      <Bullets items={era.achievements} path={path ? joinPath(path, 'achievements') : undefined} />
      {era.media && isInteractive && <Figure media={era.media} />}
    </EraChrome>
  );
}
