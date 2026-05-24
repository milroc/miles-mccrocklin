import { useContext, type JSX } from 'react';
import { ModeContext } from '../utils/mode';
import { TERMINAL_DOCK_REVEAL_EVENT } from '../layout/TerminalDock';
import s from './SkillsCaption.module.css';

/**
 * Editorial caption that frames the Skills list. Sets up the contrast
 * the TerminalDock then demonstrates: stacks rotate, the craft doesn't,
 * and the cost of picking up a new one has collapsed.
 *
 * In interactive mode "almost free" is a button — clicking it summons
 * the dock so the claim has visible evidence (a Claude Code session
 * mid-flight). In text and 1-pager modes it renders as plain prose.
 */
export function SkillsCaption(): JSX.Element {
  const mode = useContext(ModeContext);
  const isInteractive = mode === 'interactive';

  const handleClick = (): void => {
    window.dispatchEvent(new CustomEvent(TERMINAL_DOCK_REVEAL_EVENT));
  };

  const tail = isInteractive ? (
    <button
      type="button"
      className={s.trigger}
      onClick={handleClick}
      aria-label="Show Claude Code terminal"
    >
      almost free
    </button>
  ) : (
    <>almost free</>
  );

  return (
    <p className={s.caption}>
      Stacks rotate. The craft doesn&rsquo;t. I used to change stacks with
      ease; now it&rsquo;s {tail}.
    </p>
  );
}
