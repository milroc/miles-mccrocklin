// One-line entry for older roles. Company + role read inline (separated by
// a midline dot) when there's room. Below the container threshold, the
// role drops to its own line as a complete unit and the separator
// disappears — see InlineEntry.module.css.
import { EDIT_ENABLED, NoteBubble, VisibilityChip, useEdit } from '../edit';
import type { Job } from '../types';
import s from './InlineEntry.module.css';

interface InlineEntryProps {
  job: Job;
  path?: string;
  archived?: boolean;
}

export function InlineEntry({ job, path, archived }: InlineEntryProps) {
  const edit = useEdit();
  const editActive = EDIT_ENABLED && edit.active;
  const company = job.shortened_title || job.company;
  return (
    <div className={`entry ${s.entryInline}`} data-archived={archived || undefined}>
      <div className="entry-head">
        <div className="l">
          {company}
          <span className={s.role}>{job.role}</span>
          {editActive && path && (
            <>
              <VisibilityChip path={path} />
              <NoteBubble path={path} />
            </>
          )}
        </div>
        <div className="r">{job.start_date} – {job.end_date}</div>
      </div>
    </div>
  );
}
