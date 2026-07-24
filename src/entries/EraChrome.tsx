// Shared chrome for a phase sub-block: the focus + period head row over
// whatever body the caller renders. Owned here so Era, Track, and the
// builder's EraGeneric compose one primitive instead of importing each
// other's CSS modules.
import type { ReactNode } from 'react';
import s from './EraChrome.module.css';

interface EraChromeProps {
  focus: ReactNode;
  period: ReactNode;
  // Edit-mode archive treatment — styled by the document-level
  // [data-archived] rule in globals.css.
  archived?: boolean;
  // Extra head-row content (edit-mode visibility chip + note bubble).
  headExtra?: ReactNode;
  children?: ReactNode;
}

export function EraChrome({
  focus,
  period,
  archived,
  headExtra,
  children,
}: EraChromeProps): JSX.Element {
  return (
    <div className={s.root} data-archived={archived || undefined}>
      <div className={s.head}>
        <span className={s.focus}>{focus}</span>
        <span className={s.period}>{period}</span>
        {headExtra}
      </div>
      {children}
    </div>
  );
}
