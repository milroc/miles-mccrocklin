import { useEffect, useRef, useState, type JSX } from 'react';
import { Terminal } from './Terminal';
import s from './TerminalDock.module.css';

// Custom-event channel that Skills (and any other consumer) uses to
// reveal the dock on hover. Plain DOM event keeps coupling to zero —
// no provider, no context — at the cost of one global event name.
export const TERMINAL_DOCK_REVEAL_EVENT = 'terminal-dock:reveal';

/**
 * TerminalDock — fixed-bottom dock that holds the Claude Code Terminal
 * artifact. Reveals on the first skill hover (via TERMINAL_DOCK_REVEAL_EVENT),
 * sticks until the user clicks the dismiss button, then stays dismissed
 * for the session.
 *
 * Hidden on mobile and in print. Slide animation respects
 * prefers-reduced-motion.
 */
export function TerminalDock(): JSX.Element | null {
  const [revealed, setRevealed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handler = (): void => {
      setRevealed((prev) => prev || true);
    };
    window.addEventListener(TERMINAL_DOCK_REVEAL_EVENT, handler);
    return () => window.removeEventListener(TERMINAL_DOCK_REVEAL_EVENT, handler);
  }, []);

  if (dismissed) return null;

  const stateClass = revealed ? s.revealed : s.hidden;

  return (
    <div
      className={`${s.dock} ${stateClass}`}
      role="complementary"
      aria-label="Claude Code terminal preview"
      aria-hidden={!revealed}
    >
      <button
        ref={closeBtnRef}
        type="button"
        className={s.dismiss}
        onClick={() => setDismissed(true)}
        aria-label="Dismiss Claude Code terminal"
        title="Dismiss"
      >
        ×
      </button>
      {/* Mount Terminal only on first reveal so its boot animation runs
          when the dock actually slides up, not at page-load time. */}
      {revealed && <Terminal />}
    </div>
  );
}
