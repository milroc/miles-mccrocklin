// Top-level job entry. Branches into SabbaticalEntry/InlineEntry for the
// two special cases; otherwise renders the standard entry chrome with
// summary + bullets/eras/tracks/figure.
import { useContext } from 'react';
import { Bullets } from '../primitives/Bullets';
import { Era } from './Era';
import { Track } from './Track';
import { Figure } from '../media/Figure';
import { SabbaticalEntry } from './SabbaticalEntry';
import { InlineEntry } from './InlineEntry';
import { ModeContext, visible, isArchived as isArchivedItem } from '../utils/mode';
import {
  EDIT_ENABLED, NoteBubble, VisibilityChip, joinPath, useEdit,
} from '../edit';
import editStyles from '../edit/edit.module.css';
import type { Job } from '../types';

interface ExperienceEntryProps {
  job: Job;
  path?: string;
  archived?: boolean;
}

export function ExperienceEntry({ job, path, archived }: ExperienceEntryProps) {
  const mode = useContext(ModeContext);
  const edit = useEdit();
  const editActive = EDIT_ENABLED && edit.active;
  if (!editActive && !visible(job, mode)) return null;
  if (job.company === 'Sabbatical') return <SabbaticalEntry job={job} path={path} archived={archived} />;
  if (job.inline) return <InlineEntry job={job} path={path} archived={archived} />;
  const dateRange = `${job.start_date} – ${job.end_date}`;
  const isInteractive = mode === 'interactive';

  // Per-child filter helper that mirrors App-level renderable() so eras
  // and tracks honor the edit-shows-all rule too. ARCHIVED treatment is
  // reserved for explicit `visibility: "archived"`.
  const childRenderable = (item: unknown): boolean =>
    editActive || visible(item, mode);
  const childArchived = (item: unknown): boolean =>
    editActive && isArchivedItem(item);

  const cls = `entry ${archived ? editStyles.archived : ''}`.trim();
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
      {job.summary && <div className="entry-summary">{job.summary}</div>}
      {(job.achievements || editActive) && (
        // In edit mode render Bullets even when `achievements` is
        // empty/missing so the "+ add bullet" affordance is always
        // available on the section.
        <Bullets
          items={job.achievements ?? []}
          path={path ? joinPath(path, 'achievements') : undefined}
        />
      )}
      {job.eras && job.eras.map((e, i) => childRenderable(e) && (
        <Era
          key={i}
          era={e}
          path={path ? joinPath(path, 'eras', i) : undefined}
          archived={childArchived(e)}
        />
      ))}
      {job.tracks && job.tracks.map((t, i) => childRenderable(t) && (
        <Track
          key={i}
          track={t}
          path={path ? joinPath(path, 'tracks', i) : undefined}
          archived={childArchived(t)}
        />
      ))}
      {job.media && isInteractive && <Figure media={job.media} />}
    </div>
  );
}
