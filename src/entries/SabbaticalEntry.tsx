// Sabbatical entry — special-cased because tracks (Real Estate, AI, Travel)
// only render in interactive/text modes; in the 1-pager we collapse to a
// short summary plus one bullet per track.
import { useContext, type ReactNode } from 'react';
import { KPText } from '../primitives/KPText';
import { Track } from './Track';
import { ModeContext, visible, isArchived as isArchivedItem } from '../utils/mode';
import {
  EDIT_ENABLED, NoteBubble, VisibilityChip, joinPath, useEdit,
} from '../edit';
import editStyles from '../edit/edit.module.css';
import type { Job, Track as TrackData } from '../types';

interface SabbaticalEntryProps {
  job: Job;
  path?: string;
  archived?: boolean;
}

export function SabbaticalEntry({ job, path, archived }: SabbaticalEntryProps) {
  const mode = useContext(ModeContext);
  const edit = useEdit();
  const editActive = EDIT_ENABLED && edit.active;
  const dateRange = `${job.start_date} – ${job.end_date}`;
  const cls = `entry sabbatical ${archived ? editStyles.archived : ''}`.trim();

  if (mode === '1pager' && !editActive) {
    const trackBullets = (job.tracks || [])
      .filter((t): t is TrackData & { summary_1pager: string } =>
        visible(t, mode) && !!t.summary_1pager);
    const renderTrackBullet = (text: string): ReactNode => {
      const idx = text.indexOf(':');
      if (idx === -1) return <KPText text={text} />;
      const after = text.slice(idx + 1).replace(/^ /, '');
      return <KPText text={after} prefix={text.slice(0, idx + 1) + ' '} />;
    };
    return (
      <div className={cls}>
        <div className="entry-head">
          <div className="l">{job.company}</div>
          <div className="r">{dateRange}</div>
        </div>
        <div className="entry-sub">
          <div className="l">{job.role}</div>
          <div className="r">{job.location}</div>
        </div>
        {job.summary && (
          <div className="entry-summary lead">{job.summary}</div>
        )}
        {trackBullets.length > 0 && (
          <ul className="bullets">
            {trackBullets.map((t, i) => (
              <li key={i}>{renderTrackBullet(t.summary_1pager)}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const trackRenderable = (t: TrackData): boolean =>
    editActive || visible(t, mode);
  const trackArchived = (t: TrackData): boolean =>
    editActive && isArchivedItem(t);

  return (
    <div className={cls}>
      <div className="entry-head">
        <div className="l">
          {job.company}
          {editActive && path && (
            <>
              <VisibilityChip path={path} />
              <NoteBubble path={path} />
            </>
          )}
        </div>
        <div className="r">{dateRange}</div>
      </div>
      <div className="entry-sub">
        <div className="l">{job.role}</div>
        <div className="r">{job.location}</div>
      </div>
      {job.summary && (
        <div className="entry-summary lead">{job.summary}</div>
      )}
      {(job.tracks || []).map((t, i) => trackRenderable(t) && (
        <Track
          key={i}
          track={t}
          path={path ? joinPath(path, 'tracks', i) : undefined}
          archived={trackArchived(t)}
        />
      ))}
    </div>
  );
}
