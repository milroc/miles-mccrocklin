// A "Track" is a sub-block under a sabbatical entry — a thread of work
// (Real Estate, AI experiments, Travel photography). Renders as an Era
// chrome (focus + period + tagline/summary) with optional reviews/figure/
// AI-project list.
import { useContext } from 'react';
import { Bullets } from '../primitives/Bullets';
import { AIProjectBullet } from '../primitives/AIProjectBullet';
import { Reviews } from '../reviews/Reviews';
import { Figure } from '../media/Figure';
import { ModeContext, visible } from '../utils/mode';
import {
  AddButton, EDIT_ENABLED, NoteBubble, VisibilityChip, joinPath, useEdit,
} from '../edit';
import { EraChrome } from './EraChrome';
import type { Track as TrackData } from '../types';
import s from './Track.module.css';

interface TrackProps {
  track: TrackData;
  path?: string;
  archived?: boolean;
}

export function Track({ track, path, archived }: TrackProps) {
  const mode = useContext(ModeContext);
  const edit = useEdit();
  const editActive = EDIT_ENABLED && edit.active;
  if (!editActive && !visible(track, mode)) return null;
  const isInteractive = mode === 'interactive';

  // 1-pager hides tracks entirely; in edit mode we still want to see/move
  // them, so the early-return is gated on edit-inactive.
  if (mode === '1pager' && !editActive) return null;

  const projectsToShow = (track.projects || [])
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => editActive || visible(p, mode));

  return (
    <EraChrome
      focus={track.focus}
      period={track.period}
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
      {track.tagline && <div className={s.tagline}>{track.tagline}</div>}
      {track.summary && <div className={s.summary}>{track.summary}</div>}
      {(track.achievements || editActive) && (
        <Bullets
          items={track.achievements ?? []}
          path={path ? joinPath(path, 'achievements') : undefined}
        />
      )}
      {(projectsToShow.length > 0 || editActive) && (
        <>
          {projectsToShow.length > 0 && (
            <ul className="bullets">
              {projectsToShow.map(({ p, i }) => (
                <AIProjectBullet
                  key={i}
                  p={p}
                  path={path ? joinPath(path, 'projects', i) : undefined}
                />
              ))}
            </ul>
          )}
          {editActive && path && (
            <AddButton
              path={joinPath(path, 'projects')}
              template={{ name: 'New project', description: { text: 'short description' } }}
              label="+ add project"
            />
          )}
        </>
      )}
      {track.reviews && isInteractive && <Reviews data={track.reviews} max={5} />}
      {track.media && isInteractive && <Figure media={track.media} />}
    </EraChrome>
  );
}
