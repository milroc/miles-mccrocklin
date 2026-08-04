import { useEffect, useState, type JSX } from 'react';
import { Terminal } from './Terminal';
import s from './TerminalDock.module.css';

// Custom-event channel that SkillsCaption (and any other consumer)
// uses to reveal the dock. Plain DOM event keeps coupling to zero —
// no provider, no context — at the cost of one global event name.
export const TERMINAL_DOCK_REVEAL_EVENT = 'terminal-dock:reveal';

/**
 * TerminalDock — fixed-bottom dock that holds the Claude Code Terminal
 * artifact. Toggles open via TERMINAL_DOCK_REVEAL_EVENT, closes via the
 * × button, can be reopened from the same trigger any number of times.
 * Each reveal remounts the Terminal so the boot animation replays from
 * scratch every time.
 *
 * Hidden in print. Slide animation respects prefers-reduced-motion.
 */
export function TerminalDock(): JSX.Element {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const handler = (): void => setRevealed(true);
    window.addEventListener(TERMINAL_DOCK_REVEAL_EVENT, handler);
    return () => window.removeEventListener(TERMINAL_DOCK_REVEAL_EVENT, handler);
  }, []);

  // Escape closes the dock while revealed — same dismiss path as the
  // × button. Listener only exists while the dock is open.
  useEffect(() => {
    if (!revealed) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setRevealed(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealed]);

  const stateClass = revealed ? s.revealed : s.hidden;

  return (
    <div
      className={`${s.dock} ${stateClass}`}
      role="complementary"
      aria-label="Claude Code terminal preview"
      aria-hidden={!revealed}
    >
      <button
        type="button"
        className={s.dismiss}
        onClick={() => setRevealed(false)}
        aria-label="Close"
        title="Close"
      >
        <span aria-hidden="true" className={s.dismissGlyph}>×</span>
        <span className={s.dismissLabel}>close</span>
      </button>
      {/* Terminal mounts only while revealed. Dismissing unmounts it;
          re-revealing remounts a fresh instance so the boot animation
          (shell prompt → cycle through CLIs → claude → session render
          → /ship typing) plays from scratch each time. */}
      {revealed && <Terminal />}
    </div>
  );
}
