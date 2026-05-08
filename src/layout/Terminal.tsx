import { useEffect, useState, type JSX } from 'react';
import { Highlight, Prism } from 'prism-react-renderer';
import s from './Terminal.module.css';

// Custom Prism language for the Claude Code terminal session. Mirrors
// the pattern CodeChips (deleted) used to register Clojure inline:
// the renderer's `Highlight` component reuses this same Prism instance,
// so anything we attach here gets tokenized normally.
//
// Tokens:
//   command  — /ship, /help, /init, /status (Claude slash commands)
//   path     — ~/Developer/milroc and similar
//   label    — leading "cwd:" / "org:" / "Tips:" tags
//   border   — box-drawing characters used for horizontal rules
Prism.languages.claudeterm = {
  command: /\/[a-z][\w-]*/,
  path: /~?\/[\w/.-]+/,
  label: { pattern: /^\s*[A-Za-z][\w ]*:(?=\s|$)/m, greedy: true },
  border: /[─╭╮╰╯│]+/,
};

// Editorial dark theme tuned for the Claude palette. Colors are
// hex-literal because prism-react-renderer's theme object can't read
// CSS variables — values mirror the --guest-claude-* tokens in
// src/styles/globals.css. If the palette tokens shift, update both.
const claudeTermTheme = {
  plain: { color: '#ece9e2', backgroundColor: 'transparent' },
  styles: [
    { types: ['command'], style: { color: '#d97757', fontWeight: '500' as const } },
    { types: ['path'],    style: { color: '#ece9e2' } },
    { types: ['label'],   style: { color: '#7a7770' } },
    { types: ['border'],  style: { color: 'rgba(217, 119, 87, 0.45)' } },
  ],
};

// Boot sequence —  shell prompt, paste `claude`, the welcome banner
// renders, prompt types itself out. Same vocabulary a developer would
// see launching a real Claude Code session.
const SHIP_CMD = '/ship anything on any stack...';
const PHASES = ['shell', 'pasted', 'session', 'typing', 'done'] as const;
type Phase = (typeof PHASES)[number];
const PHASE_INDEX: Record<Phase, number> = { shell: 0, pasted: 1, session: 2, typing: 3, done: 4 };
const atLeast = (phase: Phase, target: Phase): boolean =>
  PHASE_INDEX[phase] >= PHASE_INDEX[target];

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const WELCOME_BANNER = `
✻ Welcome back, Miles!

   Claude Code vLATEST · Claude Max
   /help for help, /status for your current setup

   cwd:  ~/Developer/milroc
   org:  milroc's Org

──────────────────────────────────────────────────────
Tips for getting started
   • Run /init to create a CLAUDE.md file with ins…

Recent activity
   • …
──────────────────────────────────────────────────────`.trimStart();

const STATUS_LINE = 'LATEST (MAX context) | hi | milroc | ContextQ:--';

// Shared render helper for any block of claudeterm source. Keeps the
// JSX flat in the component below.
function renderTokens(code: string, className?: string): JSX.Element {
  return (
    <Highlight code={code} language="claudeterm" theme={claudeTermTheme}>
      {({ tokens, getTokenProps }) => (
        <pre className={`${s.line} ${className ?? ''}`}>
          {tokens.map((lineTokens, lineIdx) => (
            <span key={lineIdx} className={s.row}>
              {lineTokens.map((token, tokenIdx) => {
                const { key: _k, className: _c, ...rest } = getTokenProps({ token });
                return <span key={tokenIdx} {...rest} />;
              })}
              {lineIdx < tokens.length - 1 && '\n'}
            </span>
          ))}
        </pre>
      )}
    </Highlight>
  );
}

/**
 * Terminal — animated Claude Code session. Boots from a bare shell
 * prompt, "pastes" `claude`, the welcome banner renders, the prompt
 * types itself out. All text rendered through prism-react-renderer
 * with a custom claudeterm grammar so /ship, paths, labels, and box-
 * drawing chars all get consistent tokenized coloring instead of
 * one-off CSS classes.
 *
 * Animation runs on mount; consumers control mount timing via reveal
 * state (see TerminalDock). Reduced-motion skips to the end state.
 */
export function Terminal(): JSX.Element {
  const reduced = prefersReducedMotion();
  const [phase, setPhase] = useState<Phase>(reduced ? 'done' : 'shell');
  const [typed, setTyped] = useState<string>(reduced ? SHIP_CMD : '');

  useEffect(() => {
    if (reduced) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => setPhase('pasted'), 1000));
    timers.push(setTimeout(() => setPhase('session'), 1300));
    timers.push(setTimeout(() => setPhase('typing'), 1700));
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
  const showClaudeText = atLeast(phase, 'pasted');
  const showShellCursor = phase === 'shell';
  const showPromptCursor = sessionVisible;

  const shellCode = showClaudeText
    ? '~/Developer/milroc: claude'
    : '~/Developer/milroc:';

  return (
    <aside className={s.panel} aria-hidden="true">
      <div className={s.shellLine}>
        {renderTokens(shellCode)}
        {showShellCursor && <span className={s.cursor} aria-hidden="true" />}
      </div>

      <div className={`${s.session} ${sessionVisible ? s.sessionVisible : ''}`}>
        {renderTokens(WELCOME_BANNER, s.welcome)}

        <div className={s.promptLine}>
          {renderTokens(`› ${typed}`, s.prompt)}
          {showPromptCursor && <span className={s.cursor} aria-hidden="true" />}
        </div>

        {renderTokens(STATUS_LINE, s.status)}
      </div>
    </aside>
  );
}
