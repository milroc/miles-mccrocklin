import type { JSX } from 'react';
import s from './Terminal.module.css';

/**
 * Terminal — full-width Claude Code welcome panel that slides up from
 * the bottom of the Builder tile on hover. Quoted brand artifact, lives
 * outside the CodeChips system because it has its own layout and
 * motion register (no rotation, no scale, no fade — pure translate).
 *
 * Reveal trigger lives in Splash.module.css: when the Builder tile is
 * hovered, --terminal-ty flips from 110% to 0%, and CSS transitions
 * the translateY between the two states.
 */
export function Terminal(): JSX.Element {
  return (
    <aside className={s.panel} aria-hidden="true">
      <div className={s.frame}>
        <div className={s.col}>
          <span className={s.version}>Claude Code vLATEST</span>
          <div className={s.greetingRow}>
            <span className={s.greeting}>Welcome back Miles!</span>
          </div>
          <span className={s.metaLine}>LATEST (MAX context) · Claude Max</span>
          <span className={s.metaLine}>milroc's Org</span>
          <span className={s.metaLine}>~/Developer/milroc</span>
        </div>

        <div className={`${s.col} ${s.colDivider}`}>
          <span className={s.tipsHeading}>Tips for getting started</span>
          <span className={s.tipsBody}>
            Run /init to create a CLAUDE.md file with ins…
          </span>
          <hr className={s.tipsRule} />
          <span className={s.tipsHeading}>Recent activity</span>
          <span className={s.tipsBody}>...</span>
        </div>
      </div>

      <div className={s.prompt}>
        <span className={s.promptCarat}>{'›'}</span>
        <span className={s.promptCmd}>/ship anything...█</span>
      </div>

      <div className={s.status}>
        LATEST (MAX context) | hi | milroc | ContextQ:--
      </div>
    </aside>
  );
}
