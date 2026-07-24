// Community-organization entries (talks, conferences, group involvement).
// d3.js / d3.unconf() group names get a thin mono treatment to read as
// project tokens.
import { useContext, type ReactNode } from 'react';
import { Figure } from '../media/Figure';
import { ModeContext, visible, pickText, isArchived as isArchivedItem } from '../utils/mode';
import { CODE_GROUPS } from '../me';
import {
  EDIT_ENABLED, NoteBubble, VisibilityChip, joinPath, useEdit,
} from '../edit';
import type { CommunityEntry } from '../types';
import s from './Community.module.css';

// Build the splitter + matcher from CODE_GROUPS once per module load.
// Special chars in the group names (parens, dots) are escaped before
// joining so they're matched literally, not as regex metacharacters.
const CODE_RE_SOURCE = CODE_GROUPS
  .map((g) => g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const CODE_SPLIT_RE = new RegExp(`(${CODE_RE_SOURCE})`, 'g');
const CODE_MATCH_RE = new RegExp(`^(${CODE_RE_SOURCE})$`);

interface CommunityProps {
  items?: CommunityEntry[];
  path?: string;
}

export function Community({ items, path }: CommunityProps) {
  const mode = useContext(ModeContext);
  const edit = useEdit();
  const editActive = EDIT_ENABLED && edit.active;
  const list = items || [];
  const renderable = (c: CommunityEntry): boolean =>
    editActive || visible(c, mode);
  const isArchived = (c: CommunityEntry): boolean =>
    editActive && isArchivedItem(c);
  const visibleList = list
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => renderable(c));
  if (visibleList.length === 0) return null;
  const renderGroup = (str: string): ReactNode => {
    const parts = str.split(CODE_SPLIT_RE);
    return parts.map((p, i) =>
      CODE_MATCH_RE.test(p)
        ? <span key={i} className={s.code}>{p}</span>
        : p
    );
  };
  const isInteractive = mode === 'interactive';
  return (
    <div>
      {visibleList.map(({ c, i }) => {
        const detailsText = pickText(c.details, mode);
        const itemPath = path ? joinPath(path, i) : '';
        const archived = isArchived(c);
        return (
          <div key={i} className="entry" data-archived={archived || undefined}>
            <div className="entry-head">
              <div className="l">
                {renderGroup(c.group)}
                {editActive && itemPath && (
                  <>
                    <VisibilityChip path={itemPath} />
                    <NoteBubble path={itemPath} />
                  </>
                )}
              </div>
              {(c.start_date || c.end_date) && (
                <div className="r">{c.start_date} – {c.end_date}</div>
              )}
            </div>
            {c.role && (
              <div className="entry-sub">
                <div className="l">{c.role}</div>
              </div>
            )}
            {detailsText && (
              <div className="entry-summary" style={{ fontStyle: 'normal' }}>{detailsText}</div>
            )}
            {c.media && isInteractive && <Figure media={c.media} />}
          </div>
        );
      })}
    </div>
  );
}
