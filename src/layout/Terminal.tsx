import { useEffect, useState, type JSX } from 'react';
import s from './Terminal.module.css';

// Boot sequence — shell prompt, the user types-and-erases through a
// few competing agent CLIs (codex, gt, hermes), settles on claude,
// the welcome banner renders, the prompt types itself out. Reads as
// agent-shopping: lots of choices, one chosen tool.
const SHIP_CMD = '/ship anything on any stack...';
const SHELL_ALTERNATIVES = ['codex', 'gt', 'hermes'] as const;
const SHELL_FINAL = 'claude';
const TYPE_MS = 60;
const DELETE_MS = 40;
const HOLD_MS = 260;
const PAUSE_MS = 110;
const INITIAL_PAUSE_MS = 700;
const SESSION_GAP_MS = 380;

const PHASES = ['shell', 'session', 'typing', 'done'] as const;
type Phase = (typeof PHASES)[number];
const PHASE_INDEX = { shell: 0, session: 1, typing: 2, done: 3 } satisfies Record<Phase, number>;
const atLeast = (phase: Phase, target: Phase): boolean =>
  PHASE_INDEX[phase] >= PHASE_INDEX[target];

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Splits "/ship anything on any stack..." into the slash command and
// the rest so the command can render in Claude orange while the rest
// stays cream. Used during the typing phase as `typed` builds up
// character by character.
function renderCommand(text: string): JSX.Element {
  const match = /^(\/[a-z][\w-]*)(.*)$/.exec(text);
  if (!match) return <span className={s.promptCmd}>{text}</span>;
  return (
    <>
      <span className={s.cmd}>{match[1]}</span>
      <span className={s.promptCmd}>{match[2]}</span>
    </>
  );
}

/**
 * Terminal — animated Claude Code session that visually matches the
 * real CLI: yellow `[host]` shell prompt, notched-border welcome box
 * with a two-column layout (greeting + mascot on the left, tips +
 * recent activity on the right), prompt line below with placeholder
 * → typed command, status footer.
 *
 * Animation runs on mount; consumers control mount timing via reveal
 * state (see TerminalDock). Reduced-motion skips to the end state.
 */
export function Terminal(): JSX.Element {
  const reduced = prefersReducedMotion();
  const [phase, setPhase] = useState<Phase>(reduced ? 'done' : 'shell');
  const [shellTyped, setShellTyped] = useState<string>(reduced ? SHELL_FINAL : '');
  const [typed, setTyped] = useState<string>(reduced ? SHIP_CMD : '');

  // Shell-phase choreography: queue every keystroke (and erase, and
  // pause) up front via setTimeout offsets so cleanup is just a
  // clearTimeout sweep.
  useEffect(() => {
    if (reduced) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let offset = INITIAL_PAUSE_MS;
    const at = (fn: () => void): void => {
      timers.push(setTimeout(fn, offset));
    };

    for (const alt of SHELL_ALTERNATIVES) {
      for (let i = 1; i <= alt.length; i++) {
        offset += TYPE_MS;
        const slice = alt.slice(0, i);
        at(() => setShellTyped(slice));
      }
      offset += HOLD_MS;
      for (let i = alt.length - 1; i >= 0; i--) {
        offset += DELETE_MS;
        const slice = alt.slice(0, i);
        at(() => setShellTyped(slice));
      }
      offset += PAUSE_MS;
    }

    for (let i = 1; i <= SHELL_FINAL.length; i++) {
      offset += TYPE_MS;
      const slice = SHELL_FINAL.slice(0, i);
      at(() => setShellTyped(slice));
    }
    offset += HOLD_MS;
    at(() => setPhase('session'));
    offset += SESSION_GAP_MS;
    at(() => setPhase('typing'));

    return () => { for (const t of timers) clearTimeout(t); };
  }, [reduced]);

  useEffect(() => {
    if (phase !== 'typing') return;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setTyped(SHIP_CMD.slice(0, i));
      if (i >= SHIP_CMD.length) {
        clearInterval(id);
        setPhase('done');
      }
    }, 50);
    return () => clearInterval(id);
  }, [phase]);

  const sessionVisible = atLeast(phase, 'session');
  const showShellCursor = phase === 'shell';
  const showPromptCursor = sessionVisible;
  const promptHasContent = atLeast(phase, 'typing');

  return (
    <aside className={s.panel} aria-hidden="true">
      <div className={s.shellLine}>
        <span className={s.shellHost}>[milroc-local]{' '}</span>
        <span className={s.shellPath}>~/Developer:</span>
        {shellTyped && <span className={s.shellCmd}> {shellTyped}</span>}
        {showShellCursor && <span className={s.cursor} aria-hidden="true" />}
      </div>

      <div className={`${s.session} ${sessionVisible ? s.sessionVisible : ''}`}>
        <fieldset className={s.welcomeBox}>
          <legend className={s.welcomeLegend}>Claude Code vLATEST</legend>
          <div className={s.welcomeGrid}>
            <div className={s.welcomeLeft}>
              <p className={s.greeting}>Welcome back Miles!</p>
              <p className={s.metaLine}>Claude &middot; Claude Max</p>
              <p className={s.metaLine}>
                milroc&rsquo;s Organization
              </p>
              <p className={s.cwdLine}>~/Developer</p>
            </div>

            <div className={s.welcomeRight}>
              <p className={s.tipHeading}>Tips for getting started</p>
              <p className={s.tipBody}>
                Run <span className={s.cmd}>/init</span> to create a CLAUDE.md
                file with instructions for Claude
              </p>
              <hr className={s.tipRule} />
              <p className={s.tipHeading}>Recent activity</p>
              <p className={s.tipBody}>No recent activity</p>
            </div>
          </div>
        </fieldset>

        <div className={s.promptLine}>
          <span className={s.promptCarat}>{'›'}</span>
          {promptHasContent ? (
            renderCommand(typed)
          ) : (
            <span className={s.promptPlaceholder}>
              Try &ldquo;write a test for &lt;filepath&gt;&rdquo;
            </span>
          )}
          {showPromptCursor && <span className={s.cursor} aria-hidden="true" />}
        </div>

        <p className={s.status}>
          Mythos (MAX context)
          <span className={s.statusSep}>|</span>hi
          <span className={s.statusSep}>|</span>milroc
          <span className={s.statusSep}>|</span>ContextQ:--
        </p>
      </div>
    </aside>
  );
}
