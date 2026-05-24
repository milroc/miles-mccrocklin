// Sabbatical entry — special-cased because tracks (Building, Real Estate,
// Travel) only render in interactive/text modes; in the 1-pager we collapse
// to the entry's `summary_1pager` lead line and skip the tracks entirely.
//
// Reading flow: the Building track always renders inline so the top of the
// page leads with the professional/builder pitch. Subsequent tracks (Real
// Estate, Travel) sit behind a "learn more" toggle so visitors can opt in
// to the personal-pursuit detail without it dominating the top third.
import { useContext, useState, type ReactNode } from 'react';
import { Track } from './Track';
import { ModeContext, visible, isArchived as isArchivedItem } from '../utils/mode';
import {
  EDIT_ENABLED, NoteBubble, VisibilityChip, joinPath, useEdit,
} from '../edit';
import editStyles from '../edit/edit.module.css';
import s from './SabbaticalEntry.module.css';
import type { Job, Track as TrackData } from '../types';

interface SabbaticalEntryProps {
  job: Job;
  path?: string;
  archived?: boolean;
  // When true, no track renders inline as the primary anchor — every
  // track sits behind the "Learn more" toggle. Used by the public
  // /builder/ page where the sabbatical is a side-note, not the lede.
  collapseAll?: boolean;
}

export function SabbaticalEntry({ job, path, archived, collapseAll }: SabbaticalEntryProps) {
  const mode = useContext(ModeContext);
  const edit = useEdit();
  const editActive = EDIT_ENABLED && edit.active;
  const dateRange = `${job.start_date} – ${job.end_date}`;
  const cls = `entry sabbatical ${archived ? editStyles.archived : ''}`.trim();

  if (mode === '1pager' && !editActive) {
    // 1-pager: just the entry header, sub-line, and the standard summary.
    // Track detail lives in the interactive/text modes only.
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
      </div>
    );
  }

  const trackRenderable = (t: TrackData): boolean =>
    editActive || visible(t, mode);
  const trackArchived = (t: TrackData): boolean =>
    editActive && isArchivedItem(t);

  // Visible tracks in array order. The first one (Building) anchors the
  // entry; the rest sit behind the expand toggle. In edit mode every
  // track renders inline so the user can re-classify without hunting
  // for a hidden affordance.
  const visibleTracks = (job.tracks || []).filter(trackRenderable);
  const primary = collapseAll ? undefined : visibleTracks[0];
  const rest = collapseAll ? visibleTracks : visibleTracks.slice(1);
  const hasMore = rest.length > 0 && !editActive;

  const [expanded, setExpanded] = useState(false);
  const showRest = editActive || expanded;

  const renderTrack = (t: TrackData, i: number, offset = 0): ReactNode => (
    <Track
      key={i + offset}
      track={t}
      path={path ? joinPath(path, 'tracks', i + offset) : undefined}
      archived={trackArchived(t)}
    />
  );

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
      {primary && renderTrack(primary, 0)}
      {hasMore && !showRest && (
        <div className={s.expandRow}>
          <button
            type="button"
            className={s.expandBtn}
            onClick={() => setExpanded(true)}
            aria-expanded={false}
            aria-controls="sabbatical-more"
          >
            Learn more about my sabbatical →
          </button>
        </div>
      )}
      {showRest && (
        <div id="sabbatical-more">
          {rest.map((t, i) => renderTrack(t, i, collapseAll ? 0 : 1))}
        </div>
      )}
      {hasMore && showRest && !editActive && (
        <div className={s.collapseRow}>
          <button
            type="button"
            className={s.expandBtn}
            onClick={() => setExpanded(false)}
            aria-expanded={true}
            aria-controls="sabbatical-more"
          >
            ← Show less
          </button>
        </div>
      )}
    </div>
  );
}
